import { observable, action, runInAction } from "mobx";
import { consumeSSE, SseHandle } from "~/utils/sse";
import RootStore from "./RootStore";

/**
 * A single message in the agent conversation. Follows the Vercel AI SDK
 * `UIMessage` shape loosely — we keep a `parts` array with typed entries so
 * the UI can switch on `type` to render text vs tool calls vs results.
 */
export type AgentMessagePart =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; result: unknown; is_error: boolean };

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  parts: AgentMessagePart[];
  createdAt: number;
}

/** Internal tool-call state while it's being assembled from deltas. */
interface PendingToolCall {
  id: string;
  name: string;
  argsPartial: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

export default class AgentStore {
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

  constructor(private root: RootStore) {}

  @action
  togglePanel() {
    this.panelOpen = !this.panelOpen;
  }

  @action
  openPanel() {
    this.panelOpen = true;
  }

  @action
  closePanel() {
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
  }

  async send(text: string) {
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

    const wireMessages = this.messages.map((m) => ({
      role: m.role,
      content: m.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join(""),
    }));

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
        { messages: wireMessages },
        (ev) => {
          runInAction(() => {
            this.handleEvent(ev, assistantMessage, (delta) => {
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
    assistantMessage: AgentMessage,
    onTextDelta: (delta: string) => void
  ) {
    const t = String(ev.type);
    switch (t) {
      case "text_delta": {
        const delta = String(ev.delta ?? "");
        if (delta) {
          const last = assistantMessage.parts[assistantMessage.parts.length - 1];
          if (last && last.type === "text") {
            last.text += delta;
          } else {
            assistantMessage.parts.push({ type: "text", text: delta });
          }
          onTextDelta(delta);
        }
        break;
      }
      case "tool_call_start": {
        const id = String(ev.id);
        const name = String(ev.name);
        this.pendingToolCalls.set(id, { id, name, argsPartial: "" });
        assistantMessage.parts.push({
          type: "tool_call",
          id,
          name,
          args: {},
        });
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
          const part = assistantMessage.parts.find(
            (p) => p.type === "tool_call" && p.id === id
          );
          if (part && part.type === "tool_call") {
            part.args = tc.args ?? {};
          }
        }
        break;
      }
      case "tool_result": {
        const id = String(ev.id);
        const tc = this.pendingToolCalls.get(id);
        if (tc) {
          tc.result = ev.result;
          tc.isError = Boolean(ev.is_error);
        }
        break;
      }
      case "done": {
        this.streaming = false;
        this.status = "idle";
        this.streamingText = "";
        this.abortHandle = null;
        break;
      }
      case "error": {
        this.streaming = false;
        this.status = "error";
        this.errorMessage = String(ev.message ?? "Unknown error");
        this.streamingText = "";
        this.abortHandle = null;
        break;
      }
      default:
        break;
    }
  }
}
