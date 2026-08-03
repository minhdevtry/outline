import { observable, action, runInAction, computed } from "mobx";
import { consumeSSE, type SseHandle } from "~/utils/sse";
import { getFocusedSplitPane } from "~/utils/splitView";
import { client } from "~/utils/ApiClient";
import type RootStore from "./RootStore";

/**
 * A single message in the agent conversation. Follows the Vercel AI SDK
 * `UIMessage` shape loosely — we keep a `parts` array with typed entries so
 * the UI can switch on `type` to render text vs tool calls vs results.
 */
export type AgentMessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | { type: "tool_result"; id: string; result: unknown; is_error: boolean };

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  parts: AgentMessagePart[];
  createdAt: number;
}

/** User's decision on a proposed `edit_document` change. */
export type PendingEditDecision = "accepted" | "rejected";

/** Internal tool-call state while it's being assembled from deltas. */
interface PendingToolCall {
  id: string;
  name: string;
  argsPartial: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  /** Set when the agent proposed an edit that the user can accept/reject. */
  pendingEdit?: {
    documentId: string;
    searchText: string;
    replaceText: string;
    newText: string;
  };
  /** The user's decision on `pendingEdit`. */
  decision?: PendingEditDecision;
}

export interface AgentSendOptions {
  /** Id of the document the user is currently viewing. */
  currentDocumentId?: string;
  /** Range of the user's current editor text selection, if any. */
  currentSelection?: { from: number; to: number; text: string };
  /** Existing session id to continue. Omit to start a new session. */
  sessionId?: string;
  /** Active skill (persona) for this run. */
  skillId?: string;
  /** Active model name selected by user. */
  model?: string;
}

/** Minimal client-side shape of an agent skill. */
export interface AgentSkill {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  systemPromptFragment: string;
  toolNames: string[];
  isDefault: boolean;
  icon: string | null;
  color: string | null;
}

export default class AgentStore {
  /**
   * Legacy visibility flag. The source of truth is now
   * `ui.rightSidebar === "ai"` (driven by the right-rail system); this is
   * kept for backwards compatibility with the global aside on non-document
   * pages. Prefer `agent.isOpen` for new code.
   */
  @observable
  panelOpen = false;

  @observable
  messages: AgentMessage[] = [];

  @observable.shallow
  pendingToolCalls = new Map<string, PendingToolCall>();

  @observable
  streaming = false;

  @observable
  status: "idle" | "streaming" | "error" = "idle";

  @observable
  errorMessage: string | null = null;

  @observable
  streamingText = "";

  @observable
  hasStarted = false;

  @observable
  abortHandle: SseHandle | null = null;

  /**
   * Persistent conversation id, server-assigned. The agent route emits a
   * `session` SSE event on the first request of a new session; we store it
   * and forward it on subsequent calls so the server can resume the
   * conversation.
   */
  @observable
  sessionId: string | undefined;

  /** Total tokens consumed across all messages in this run. */
  @observable
  totalInputTokens = 0;

  @observable
  totalOutputTokens = 0;

  /** Skills available in the current team. Loaded on demand. */
  @observable.shallow
  skills: AgentSkill[] = [];

  /** Whether `fetchSkills` is in flight. */
  @observable
  skillsLoading = false;

  /** Active skill for new sessions. `null` = use the team default. */
  @observable
  activeSkillId: string | null = null;

  /**
   * Current plan-mode state. `"off"` (act mode) is the default — the
   * agent uses the full toolset directly. `"plan"` switches the agent into
   * plan mode (read-only tools + the `submit_plan` completion tool) and
   * the UI renders plans via `<PlanCard />`. Mirrors Cline's
   * `CoreGlobalPlanActMode` (`packages/core/src/services/global-settings.ts:43`).
   */
  @observable
  planMode: "off" | "plan" = "off";

  /** Most recent plan returned by the agent. Consumed by `<PlanCard />`
   * which renders the approval UI. Cleared when the user accepts/rejects. */
  @observable.shallow
  pendingPlan: {
    id: string;
    goal: string;
    steps: Array<{
      tool: string;
      intent: string;
      arguments?: Record<string, unknown>;
    }>;
    assumptions?: string[];
  } | null = null;

  /** Team schedules loaded on demand. Driven by the `/agentSchedules.*`
   * REST endpoints and surfaced in the panel via `<SchedulerCard />`. */
  @observable.shallow
  schedules: Array<{
    id: string;
    name: string;
    description?: string | null;
    cron: string;
    prompt: string;
    enabled: boolean;
    agentId: string;
    nextRunAt: string;
    lastRunAt?: string | null;
  }> = [];

  @observable
  schedulesLoading = false;

  constructor(private root: RootStore) {}

  /** True when the panel is visible in the right-rail system. */
  @computed
  get isOpen(): boolean {
    return this.root.ui.rightSidebar === "ai";
  }

  @action
  togglePanel() {
    if (this.isOpen) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  @action
  openPanel() {
    this.root.ui.setRightSidebar("ai", getFocusedSplitPane());
    this.panelOpen = true;
  }

  @action
  closePanel() {
    this.root.ui.setRightSidebar(null, getFocusedSplitPane());
    this.panelOpen = false;
    this.cancel();
  }

  @action
  cancel() {
    if (this.abortHandle) {
      this.abortHandle.abort();
      this.abortHandle = null;
    }
    this.streaming = false;
    this.streamingText = "";
    this.status = "idle";
  }

  @action
  reset() {
    this.cancel();
    this.messages = [];
    this.pendingToolCalls.clear();
    this.streamingText = "";
    this.errorMessage = null;
    this.hasStarted = false;
    this.sessionId = undefined;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
  }

  /** Currently active skill (resolved against the loaded skills list). */
  @computed
  get activeSkill(): AgentSkill | undefined {
    if (!this.activeSkillId) {
      return this.skills.find((s) => s.isDefault);
    }
    return this.skills.find((s) => s.id === this.activeSkillId);
  }

  /**
   * Load the team's skills from the server. Idempotent — safe to call on
   * panel mount and on demand. Picks the default skill if none has been
   * picked yet.
   */
  @action
  async fetchSkills(): Promise<void> {
    if (this.skillsLoading) {
      return;
    }
    this.skillsLoading = true;
    try {
      const res = await client.post("/agentSkills.list");
      runInAction(() => {
        this.skills = (res?.data ?? []) as AgentSkill[];
        if (!this.activeSkillId) {
          const def = this.skills.find((s) => s.isDefault);
          this.activeSkillId = def?.id ?? null;
        }
      });
    } finally {
      runInAction(() => {
        this.skillsLoading = false;
      });
    }
  }

  @action
  setActiveSkill(id: string | null) {
    this.activeSkillId = id;
  }

  /** Switch between act mode (full toolset) and plan mode (read-only +
   * `submit_plan` completion tool). The runtime uses this to filter
   * tools and pick the system-prompt fragment. */
  @action
  setPlanMode(mode: "off" | "plan") {
    this.planMode = mode;
    if (mode === "off") {
      this.pendingPlan = null;
    }
  }

  /**
   * Accept / reject / edit a pending plan. Wired to `<PlanCard />`. The
   * host's `respondToPlanTool` will pick up the answer on the next
   * agent run; this action just stores the decision locally.
   */
  @action
  decidePlan(
    decision: "approved" | "rejected" | "edit_requested",
    reason?: string
  ) {
    this.pendingPlan = null;
    // Real implementation would call `agent.send` with
    // `respondToPlanTool` here. For the scaffold we just clear the
    // plan; the next user message restarts the loop.
    void decision;
    void reason;
  }

  /** Populate `pendingPlan` from a tool result. The runtime calls this
   * when it sees a `submit_plan` tool call land in the message log. */
  @action
  setPendingPlan(plan: typeof this.pendingPlan) {
    this.pendingPlan = plan;
  }

  /* ---------------------------------------------------------------------- */
  /*  Schedules (CRUD mirror of /api/agentSchedules)                        */
  /* ---------------------------------------------------------------------- */

  /** Fetch the team's schedules. Safe to call repeatedly; idempotent. */
  @action
  async fetchSchedules(): Promise<void> {
    if (this.schedulesLoading) {
      return;
    }
    this.schedulesLoading = true;
    try {
      const res = await client.post("/agentSchedules.list");
      runInAction(() => {
        this.schedules = (res?.data ?? []) as typeof this.schedules;
      });
    } finally {
      runInAction(() => {
        this.schedulesLoading = false;
      });
    }
  }

  /** Toggle a schedule's `enabled` flag and persist. */
  @action
  async toggleSchedule(id: string, enabled: boolean): Promise<void> {
    try {
      await client.post("/agentSchedules.update", { id, enabled });
      runInAction(() => {
        const s = this.schedules.find((x) => x.id === id);
        if (s) {
          s.enabled = enabled;
        }
      });
    } catch {
      // Soft-fail: leave state as-is.
    }
  }

  /** Trigger a schedule to run immediately. */
  @action
  async runScheduleNow(id: string): Promise<void> {
    try {
      await client.post("/agentSchedules.run-now", { id });
    } catch {
      // Soft-fail.
    }
  }

  /** Create a new schedule. Returns the created id. */
  @action
  async createSchedule(args: {
    name: string;
    description?: string;
    cron: string;
    prompt: string;
    enabled?: boolean;
  }): Promise<string | null> {
    try {
      const res = await client.post("/agentSchedules.create", args);
      const data = res?.data as { id: string } | undefined;
      if (!data) {
        return null;
      }
      await this.fetchSchedules();
      return data.id;
    } catch {
      return null;
    }
  }

  /** Delete a schedule. */
  @action
  async deleteSchedule(id: string): Promise<void> {
    try {
      await client.post("/agentSchedules.delete", { id });
      runInAction(() => {
        this.schedules = this.schedules.filter((s) => s.id !== id);
      });
    } catch {
      // Soft-fail.
    }
  }

  /**
   * Apply a pending edit proposed by the agent. Calls the
   * `documents.applyEdit` endpoint and updates the document in the local
   * documents store so the editor re-renders the new text.
   */
  async acceptEdit(toolCallId: string) {
    const tc = this.pendingToolCalls.get(toolCallId);
    if (!tc?.pendingEdit || tc.decision) {
      return;
    }
    const { documentId, newText } = tc.pendingEdit;
    try {
      const res = await client.post("/documents.applyEdit", {
        id: documentId,
        text: newText,
      });
      runInAction(() => {
        tc.decision = "accepted";
        if (res?.data) {
          this.root.documents.add(res.data);
        }
      });
    } catch (err) {
      runInAction(() => {
        this.errorMessage =
          err instanceof Error ? err.message : "Failed to apply edit";
      });
    }
  }

  @action
  rejectEdit(toolCallId: string) {
    const tc = this.pendingToolCalls.get(toolCallId);
    if (!tc?.pendingEdit || tc.decision) {
      return;
    }
    tc.decision = "rejected";
  }

  async send(text: string, opts: AgentSendOptions = {}) {
    const trimmed = text.trim();
    if (!trimmed || this.streaming) {
      return;
    }
    this.errorMessage = null;
    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: trimmed }],
      createdAt: Date.now(),
    };
    runInAction(() => {
      this.messages.push(userMessage);
      this.streaming = true;
      this.status = "streaming";
      this.hasStarted = true;
      this.streamingText = "";
      this.pendingToolCalls.clear();
    });

    const wireMessages = this.messages
      .map((m) => ({
        role: m.role,
        content: m.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join(""),
      }))
      .filter((m) => m.content.trim().length > 0);

    const assistantMessage: AgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [],
      createdAt: Date.now(),
    };
    runInAction(() => {
      this.messages.push(assistantMessage);
    });

    let assistantText = "";

    try {
      const handle = await consumeSSE<Record<string, unknown>>(
        "/api/ai-agent.run",
        {
          messages: wireMessages,
          currentDocumentId: opts.currentDocumentId,
          currentSelection: opts.currentSelection,
          sessionId: opts.sessionId ?? this.sessionId,
          skillId: opts.skillId ?? this.activeSkillId ?? undefined,
          model: opts.model,
        },
        (ev) => {
          runInAction(() => {
            this.handleEvent(ev, assistantMessage.id, (delta) => {
              assistantText += delta;
              this.streamingText = assistantText;
            });
          });
        }
      );
      this.abortHandle = handle;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      runInAction(() => {
        this.streaming = false;
        this.status = "error";
        this.errorMessage = message;
        this.streamingText = "";
      });
    }
  }

  private handleEvent(
    ev: Record<string, unknown>,
    assistantMessageId: string,
    onTextDelta: (delta: string) => void
  ) {
    const msg = this.messages.find((m) => m.id === assistantMessageId);
    if (!msg) {
      return;
    }

    const t = String(ev.type);
    switch (t) {
      case "text_delta": {
        const delta = String(ev.delta ?? "");
        if (delta) {
          const last = msg.parts[msg.parts.length - 1];
          if (last && last.type === "text") {
            last.text += delta;
          } else {
            msg.parts.push({ type: "text", text: delta });
          }
          msg.parts = [...msg.parts];
          this.messages = [...this.messages];
          onTextDelta(delta);
        }
        break;
      }
      case "tool_call_start": {
        const id = String(ev.id);
        const name = String(ev.name);
        this.pendingToolCalls.set(id, { id, name, argsPartial: "" });
        msg.parts.push({
          type: "tool_call",
          id,
          name,
          args: {},
        });
        msg.parts = [...msg.parts];
        this.messages = [...this.messages];
        break;
      }
      case "tool_call_delta": {
        const id = String(ev.id);
        const tc = this.pendingToolCalls.get(id);
        if (tc) {
          tc.argsPartial += String(ev.args_partial ?? "");
        }
        break;
      }
      case "tool_call_end": {
        const id = String(ev.id);
        const tc = this.pendingToolCalls.get(id);
        if (tc) {
          try {
            tc.args = ev.args
              ? (ev.args as Record<string, unknown>)
              : tc.argsPartial
                ? JSON.parse(tc.argsPartial)
                : {};
          } catch {
            tc.args = { _raw: tc.argsPartial };
          }
          const part = msg.parts.find(
            (p) => p.type === "tool_call" && p.id === id
          );
          if (part && part.type === "tool_call") {
            part.args = tc.args ?? {};
          }
          msg.parts = [...msg.parts];
          this.messages = [...this.messages];
        }
        break;
      }
      case "tool_result": {
        const id = String(ev.id);
        const tc = this.pendingToolCalls.get(id);
        if (tc) {
          tc.result = ev.result;
          tc.isError = Boolean(ev.is_error);
          if (
            tc.name === "edit_document" &&
            ev.result &&
            typeof ev.result === "object" &&
            (ev.result as { ok?: boolean }).ok &&
            (ev.result as { pending?: boolean }).pending
          ) {
            const r = ev.result as {
              documentId: string;
              searchText: string;
              replaceText: string;
              newText: string;
            };
            tc.pendingEdit = {
              documentId: r.documentId,
              searchText: r.searchText,
              replaceText: r.replaceText,
              newText: r.newText,
            };
          }
          const part = msg.parts.find(
            (p) => p.type === "tool_call" && p.id === id
          );
          if (part && part.type === "tool_call") {
            (part as unknown as Record<string, unknown>).result = ev.result;
            (part as unknown as Record<string, unknown>).is_error = Boolean(ev.is_error);
          }
          msg.parts = [...msg.parts];
          this.messages = [...this.messages];
        }
        break;
      }
      case "session": {
        this.sessionId = String(ev.sessionId ?? "");
        break;
      }
      case "step_end": {
        const usage = ev.usage as
          | { input_tokens?: number; output_tokens?: number }
          | undefined;
        if (usage) {
          this.totalInputTokens += usage.input_tokens ?? 0;
          this.totalOutputTokens += usage.output_tokens ?? 0;
        }
        break;
      }
      case "done": {
        this.streaming = false;
        this.status = "idle";
        this.streamingText = "";
        this.abortHandle = null;
        this.messages = [...this.messages];
        break;
      }
      case "error": {
        this.streaming = false;
        this.status = "error";
        this.errorMessage = String(ev.message ?? "Unknown error");
        this.streamingText = "";
        this.abortHandle = null;
        this.messages = [...this.messages];
        break;
      }
      default:
        break;
    }
  }
}
