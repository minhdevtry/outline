import { randomUUID } from "node:crypto";
import type { ChatMessage, Provider, ToolDefinition } from "./providers";

/* -------------------------------------------------------------------------- */
/*  Tool system (mirrors Cline's createTool factory)                          */
/* -------------------------------------------------------------------------- */

export type ToolInputSchema = unknown;

export interface ToolLifecycle {
  /** A successful run of this tool ends the agent loop. */
  completesRun?: boolean;
}

export interface ToolPolicy {
  enabled?: boolean;
  autoApprove?: boolean;
}

export type ToolPolicies = Record<string, ToolPolicy>;

export interface ToolApprovalRequest {
  sessionId: string;
  agentId: string;
  conversationId: string;
  iteration: number;
  toolCallId: string;
  toolName: string;
  input: unknown;
  policy: ToolPolicy;
}

export interface ToolApprovalResult {
  approved: boolean;
  reason?: string;
}

export interface AgentToolContext {
  agentId: string;
  conversationId: string;
  iteration: number;
  abortSignal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export type ToolResult =
  | { isError?: false; output: unknown }
  | { isError: true; output: { error: string } };

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute: (input: unknown, context: AgentToolContext) => Promise<ToolResult>;
  lifecycle?: ToolLifecycle;
  timeoutMs?: number;
}

export interface AgentToolDef extends AgentTool {
  /** Read-only policy default for this tool. */
  policy?: ToolPolicy;
}

export function createTool(config: {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute: AgentTool["execute"];
  lifecycle?: ToolLifecycle;
  timeoutMs?: number;
  policy?: ToolPolicy;
}): AgentToolDef {
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    execute: config.execute,
    lifecycle: config.lifecycle,
    timeoutMs: config.timeoutMs,
    retryable: config.retryable,
    maxRetries: config.maxRetries,
    policy: config.policy,
  };
}

/* -------------------------------------------------------------------------- */
/*  Agent runtime events (mirrors Cline's AgentRuntimeEvent)                   */
/* -------------------------------------------------------------------------- */

export interface AgentMessagePart {
  type: "text" | "reasoning" | "tool_call" | "tool_result";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  result?: unknown;
  isError?: boolean;
  redacted?: boolean;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "status" | "error";
  parts: AgentMessagePart[];
  createdAt: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalCost?: number;
  };
  finishReason?: "stop" | "tool_calls" | "max_tokens" | "error";
}

export interface AgentRuntimeStateSnapshot {
  sessionId: string;
  conversationId: string;
  agentId: string;
  status: "running" | "streaming" | "idle" | "error" | "aborted";
  messages: AgentMessage[];
  pendingToolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalCost?: number;
  };
}

export type AgentRuntimeEvent =
  | { type: "run-started"; snapshot: AgentRuntimeStateSnapshot }
  | {
      type: "run-finished";
      snapshot: AgentRuntimeStateSnapshot;
      result: AgentRunResult;
    }
  | { type: "run-failed"; snapshot: AgentRuntimeStateSnapshot; error: Error }
  | {
      type: "turn-started";
      snapshot: AgentRuntimeStateSnapshot;
      iteration: number;
    }
  | {
      type: "turn-finished";
      snapshot: AgentRuntimeStateSnapshot;
      iteration: number;
      toolCallCount: number;
    }
  | {
      type: "message-added";
      snapshot: AgentRuntimeStateSnapshot;
      message: AgentMessage;
    }
  | {
      type: "assistant-text-delta";
      snapshot: AgentRuntimeStateSnapshot;
      iteration: number;
      text: string;
      accumulatedText: string;
    }
  | {
      type: "assistant-reasoning-delta";
      snapshot: AgentRuntimeStateSnapshot;
      iteration: number;
      text: string;
      redacted?: boolean;
    }
  | {
      type: "assistant-message";
      snapshot: AgentRuntimeStateSnapshot;
      iteration: number;
      message: AgentMessage;
      finishReason: "stop" | "tool_calls" | "max_tokens" | "error";
    }
  | {
      type: "tool-started";
      snapshot: AgentRuntimeStateSnapshot;
      iteration: number;
      toolCall: { toolCallId: string; toolName: string; input: unknown };
    }
  | {
      type: "tool-updated";
      snapshot: AgentRuntimeStateSnapshot;
      iteration: number;
      toolCall: { toolCallId: string; toolName: string };
      update: string;
    }
  | {
      type: "tool-finished";
      snapshot: AgentRuntimeStateSnapshot;
      iteration: number;
      toolCall: { toolCallId: string; toolName: string };
      message: AgentMessage;
    }
  | {
      type: "usage-updated";
      snapshot: AgentRuntimeStateSnapshot;
      usage: AgentRuntimeStateSnapshot["usage"];
    }
  | {
      type: "status-notice";
      snapshot: AgentRuntimeStateSnapshot;
      message: string;
      metadata?: Record<string, unknown>;
    };

export interface AgentRunResult {
  status: "completed" | "aborted" | "error";
  outputText: string;
  messages: AgentMessage[];
  toolCalls: Array<{ toolName: string; toolCallId: string }>;
  usage: AgentRuntimeStateSnapshot["usage"];
  error?: Error;
}

/* -------------------------------------------------------------------------- */
/*  Agent loop (mirrors Cline's `while`-loop with 3 exit vectors)             */
/* -------------------------------------------------------------------------- */

export interface AgentLoopConfig {
  provider: Provider;
  tools: AgentToolDef[];
  systemPrompt: string;
  initialMessages: AgentMessage[];
  maxIterations?: number;
  /** Called when a tool has `autoApprove: false`. Resolves with
   * `{ approved: true }` to run, `{ approved: false, reason }` to skip. */
  requestToolApproval?: (
    request: ToolApprovalRequest
  ) => Promise<ToolApprovalResult>;
  /** Per-tool policy overrides; merged with each tool's own `policy`. */
  toolPolicies?: ToolPolicies;
  /** Called for every event. Subscribe once before calling `run`. */
  onEvent: (event: AgentRuntimeEvent) => void;
  sessionId: string;
  conversationId: string;
  agentId: string;
  abortSignal?: AbortSignal;
  /** Optional extra context (user, team, currentDocumentId, etc). */
  metadata?: Record<string, unknown>;
}

/** Run the agent loop. Returns the final `AgentRunResult`. */
export async function runAgentLoop(
  config: AgentLoopConfig
): Promise<AgentRunResult> {
  const maxIter = config.maxIterations ?? 12;
  const messages: AgentMessage[] = [...config.initialMessages];
  let status: AgentRuntimeStateSnapshot["status"] = "idle";
  let usage: AgentRuntimeStateSnapshot["usage"] = {
    inputTokens: 0,
    outputTokens: 0,
  };
  let pendingToolCalls: AgentRuntimeStateSnapshot["pendingToolCalls"] = [];
  let assistantText = "";
  let completionToolOutput: unknown = null;

  const snapshot = (): AgentRuntimeStateSnapshot => ({
    sessionId: config.sessionId,
    conversationId: config.conversationId,
    agentId: config.agentId,
    status,
    messages,
    pendingToolCalls,
    usage,
  });

  const emit = (e: AgentRuntimeEvent) => {
    try {
      config.onEvent(e);
    } catch {
      // Listener errors must not crash the agent loop.
    }
  };

  emit({ type: "run-started", snapshot: snapshot() });
  status = "running";

  try {
    for (let iteration = 0; iteration < maxIter; iteration++) {
      if (config.abortSignal?.aborted) {
        status = "aborted";
        return finish("aborted");
      }
      emit({ type: "turn-started", snapshot: snapshot(), iteration });

      // Build wire messages from the message log.
      const wireMessages: ChatMessage[] = buildWireMessages(
        config.systemPrompt,
        messages
      );
      const tools: ToolDefinition[] = config.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters:
          (t.inputSchema as Record<string, unknown> | undefined) ??
          defaultEmptySchema(),
      }));

      // Run a single LLM turn.
      const turn = await runTurn(config.provider, wireMessages, tools);
      let toolCallCount = 0;

      if (turn.error) {
        status = "error";
        emit({
          type: "run-failed",
          snapshot: snapshot(),
          error: turn.error,
        });
        return finish("error", turn.error);
      }

      // Apply deltas to assistant text + tool calls.
      assistantText = turn.text;

      // Emit text delta event if we got any text.
      if (turn.text) {
        emit({
          type: "assistant-text-delta",
          snapshot: snapshot(),
          iteration,
          text: turn.text,
          accumulatedText: turn.text,
        });
      }

      // Update usage accumulator.
      if (turn.usage) {
        usage = {
          inputTokens: usage.inputTokens + turn.usage.inputTokens,
          outputTokens: usage.outputTokens + turn.usage.outputTokens,
          totalCost: usage.totalCost,
        };
        emit({
          type: "usage-updated",
          snapshot: snapshot(),
          usage,
        });
      }

      // Emit final assistant message if we got anything.
      if (turn.text || turn.toolCalls.length > 0) {
        const assistantMsg: AgentMessage = {
          id: randomUUID(),
          role: "assistant",
          parts: [
            ...(turn.text ? [{ type: "text" as const, text: turn.text }] : []),
            ...turn.toolCalls.map((tc) => ({
              type: "tool_call" as const,
              toolCallId: tc.id,
              toolName: tc.name,
              input: safeParseInput(tc.input),
            })),
          ],
          createdAt: Date.now(),
          usage: turn.usage,
          finishReason: turn.finishReason ?? "stop",
        };
        messages.push(assistantMsg);
        emit({
          type: "message-added",
          snapshot: snapshot(),
          message: assistantMsg,
        });
        emit({
          type: "assistant-message",
          snapshot: snapshot(),
          iteration,
          message: assistantMsg,
          finishReason: turn.finishReason ?? "stop",
        });
      }

      // Exit vector 1: no tool-calls + no completion tool = done.
      if (turn.toolCalls.length === 0) {
        emit({
          type: "turn-finished",
          snapshot: snapshot(),
          iteration,
          toolCallCount: 0,
        });
        break;
      }
      const completing = turn.toolCalls.find((tc) => {
        const def = config.tools.find((t) => t.name === tc.name);
        return def?.lifecycle?.completesRun === true;
      });
      if (completing) {
        const def = config.tools.find((t) => t.name === completing.name);
        if (def) {
          const executed = await runTool(
            def,
            completing,
            iteration,
            config,
            snapshot
          );
          if (!executed.isError) {
            completionToolOutput = executed.output;
            toolCallCount = 1;
            // Don't loop — this tool terminates the run.
            emit({
              type: "turn-finished",
              snapshot: snapshot(),
              iteration,
              toolCallCount,
            });
            status = "running";
            break;
          }
        }
      }

      // Otherwise: execute all tool calls in parallel.
      toolCallCount = turn.toolCalls.length;
      const results = await Promise.all(
        turn.toolCalls.map((tc) => {
          const def = config.tools.find((t) => t.name === tc.name);
          if (!def) {
            return {
              tc,
              result: {
                isError: true as const,
                output: { error: `Tool "${tc.name}" not registered` },
              },
            };
          }
          return runTool(def, tc, iteration, config, snapshot).then(
            (result) => ({ tc, result })
          );
        })
      );
      for (const { tc, result } of results) {
        const resultPart: AgentMessagePart = {
          type: "tool_result",
          toolCallId: tc.id,
          result: result.output,
          isError: result.isError === true,
        };
        const resultMsg: AgentMessage = {
          id: randomUUID(),
          role: "tool",
          parts: [resultPart],
          createdAt: Date.now(),
        };
        messages.push(resultMsg);
        emit({
          type: "message-added",
          snapshot: snapshot(),
          message: resultMsg,
        });
      }
      emit({
        type: "turn-finished",
        snapshot: snapshot(),
        iteration,
        toolCallCount,
      });
    }
    status = "running";
    return finish("completed");
  } catch (err) {
    status = "error";
    const error = err instanceof Error ? err : new Error(String(err));
    emit({ type: "run-failed", snapshot: snapshot(), error });
    return finish("error", error);
  }

  function finish(
    status: AgentRunResult["status"],
    error?: Error
  ): AgentRunResult {
    const result: AgentRunResult = {
      status,
      outputText: completionToolOutput
        ? typeof completionToolOutput === "string"
          ? completionToolOutput
          : JSON.stringify(completionToolOutput)
        : assistantText,
      messages,
      toolCalls: messages.flatMap((m) =>
        m.parts
          .filter((p) => p.type === "tool_call")
          .map((p) => ({
            toolName: p.toolName ?? "unknown",
            toolCallId: p.toolCallId ?? "",
          }))
      ),
      usage,
      error,
    };
    emit({ type: "run-finished", snapshot: snapshot(), result });
    return result;
  }
}

/* -------------------------------------------------------------------------- */
/*  Single-turn LLM call                                                     */
/* -------------------------------------------------------------------------- */

interface TurnResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: string }>;
  finishReason: AgentMessage["finishReason"];
  usage?: AgentMessage["usage"];
  error?: Error;
}

async function runTurn(
  provider: Provider,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<TurnResult> {
  const text: string[] = [];
  const toolCalls = new Map<
    number,
    { id: string; name: string; input: string }
  >();
  let finishReason: AgentMessage["finishReason"] = "stop";
  let usage: AgentMessage["usage"] | undefined;
  let error: Error | undefined;

  try {
    for await (const ev of provider.stream({ messages, tools })) {
      switch (ev.type) {
        case "text-delta":
          text.push(ev.text);
          break;
        case "tool-call-delta":
          toolCalls.set(toolCalls.size, {
            id: ev.toolCallId,
            name: ev.toolName ?? "",
            input: ev.inputDelta ?? "",
          });
          break;
        case "usage":
          usage = {
            inputTokens: ev.usage.inputTokens,
            outputTokens: ev.usage.outputTokens,
            cacheReadTokens: ev.usage.cacheReadTokens,
            cacheWriteTokens: ev.usage.cacheWriteTokens,
          };
          break;
        case "finish":
          finishReason = ev.finishReason;
          break;
        case "error":
          error = new Error(ev.message);
          break;
        case "reasoning-delta":
          // For now, fold reasoning into text. (Future: separate part.)
          break;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }

  return {
    text: text.join(""),
    toolCalls: Array.from(toolCalls.values()),
    finishReason,
    usage,
    error,
  };
}

/* -------------------------------------------------------------------------- */
/*  Tool execution                                                            */
/* -------------------------------------------------------------------------- */

async function runTool(
  def: AgentToolDef,
  tc: { id: string; name: string; input: string },
  iteration: number,
  config: AgentLoopConfig,
  snapshot: () => AgentRuntimeStateSnapshot
): Promise<ToolResult> {
  // Resolve the effective policy: wildcard + tool-specific + per-call override.
  const policy: ToolPolicy = {
    ...resolveWildcardPolicy(config.toolPolicies),
    ...def.policy,
    ...config.toolPolicies?.[tc.name],
  };

  if (policy.enabled === false) {
    return {
      isError: true,
      output: { error: `Tool "${tc.name}" is disabled by policy` },
    };
  }

  emitStarted(def, tc, iteration, config, snapshot);
  const input = safeParseInput(tc.input);

  if (policy.autoApprove === false && config.requestToolApproval) {
    try {
      const approval = await config.requestToolApproval({
        sessionId: config.sessionId,
        agentId: config.agentId,
        conversationId: config.conversationId,
        iteration,
        toolCallId: tc.id,
        toolName: tc.name,
        input,
        policy,
      });
      if (!approval.approved) {
        emitFinished(def, tc, iteration, config, snapshot, {
          isError: true,
          output: { error: approval.reason ?? "Tool call not approved" },
        });
        return {
          isError: true,
          output: { error: approval.reason ?? "Tool call not approved" },
        };
      }
    } catch (err) {
      // Approval callback threw — treat as denial, never crash the loop.
      const reason =
        err instanceof Error ? err.message : "Approval callback error";
      return {
        isError: true,
        output: { error: `Approval failed: ${reason}` },
      };
    }
  }

  // Execute with timeout.
  const timeoutMs = def.timeoutMs ?? 30_000;
  let result: ToolResult;
  try {
    result = await withTimeout(
      def.execute(input, {
        agentId: config.agentId,
        conversationId: config.conversationId,
        iteration,
        abortSignal: config.abortSignal,
        metadata: config.metadata,
      }),
      timeoutMs
    );
  } catch (err) {
    result = {
      isError: true,
      output: {
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
  emitFinished(def, tc, iteration, config, snapshot, result);
  return result;
}

function emitStarted(
  def: AgentToolDef,
  tc: { id: string; name: string; input: string },
  iteration: number,
  config: AgentLoopConfig,
  snapshot: () => AgentRuntimeStateSnapshot
) {
  config.onEvent({
    type: "tool-started",
    snapshot: snapshot(),
    iteration,
    toolCall: {
      toolCallId: tc.id,
      toolName: tc.name,
      input: safeParseInput(tc.input),
    },
  });
}

function emitFinished(
  def: AgentToolDef,
  tc: { id: string; name: string; input: string },
  iteration: number,
  config: AgentLoopConfig,
  snapshot: () => AgentRuntimeStateSnapshot,
  result: ToolResult
) {
  // We emit a synthetic `tool` role message via message-added below;
  // here we only emit the lifecycle event with the result payload.
  config.onEvent({
    type: "tool-updated",
    snapshot: snapshot(),
    iteration,
    toolCall: { toolCallId: tc.id, toolName: tc.name },
    update: typeof result.output === "string" ? result.output : "",
  });
}

function resolveWildcardPolicy(policies: ToolPolicies | undefined): ToolPolicy {
  if (!policies) {
    return {};
  }
  const w = policies["*"];
  return w ? { ...w } : {};
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Tool timeout after ${ms}ms`)),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function buildWireMessages(
  systemPrompt: string,
  history: AgentMessage[]
): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  for (const m of history) {
    if (m.role === "user") {
      out.push({ role: "user", content: textOf(m) });
    } else if (m.role === "assistant") {
      const tcs = m.parts
        .filter((p) => p.type === "tool_call")
        .map((p) => ({
          id: p.toolCallId ?? "",
          name: p.toolName ?? "",
          input: JSON.stringify(p.input ?? {}),
        }));
      if (tcs.length > 0) {
        out.push({
          role: "assistant",
          content: textOf(m) || null,
          toolCalls: tcs,
        });
      } else {
        out.push({ role: "assistant", content: textOf(m) });
      }
    } else if (m.role === "tool") {
      for (const p of m.parts) {
        if (p.type === "tool_result") {
          out.push({
            role: "tool",
            toolCallId: p.toolCallId,
            content: JSON.stringify(p.result ?? null),
          });
        }
      }
    }
    // Skip status / error / system messages.
  }
  return out;
}

function textOf(m: AgentMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

function safeParseInput(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function defaultEmptySchema(): Record<string, unknown> {
  return { type: "object", properties: {}, additionalProperties: true };
}
