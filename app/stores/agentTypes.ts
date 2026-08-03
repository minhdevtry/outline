import type { ZodTypeAny } from "zod";

/* -------------------------------------------------------------------------- */
/*  Tool system                                                                */
/* -------------------------------------------------------------------------- */

export type ToolInputSchema = ZodTypeAny | Record<string, unknown>;

export interface ToolLifecycle {
  completesRun?: boolean;
}

export interface ToolPolicy {
  enabled?: boolean;
  autoApprove?: boolean;
}

export type ToolPolicies = Record<string, ToolPolicy>;

export interface AgentToolContext {
  agentId: string;
  conversationId: string;
  iteration: number;
  abortSignal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export type ToolProgressFn = (progress: string) => void;

export type ToolResult =
  | { isError?: false; output: unknown }
  | { isError: true; output: { error: string } };

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute: (
    input: unknown,
    context: AgentToolContext,
    onChange?: ToolProgressFn
  ) => Promise<ToolResult>;
  lifecycle?: ToolLifecycle;
  timeoutMs?: number;
  retryable?: boolean;
  maxRetries?: number;
}

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
  role: "user" | "assistant" | "system" | "status" | "error";
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
  status:
    | "completed"
    | "max_iterations"
    | "aborted"
    | "mistake_limit"
    | "error";
  outputText: string;
  messages: AgentMessage[];
  toolCalls: Array<{ toolName: string; toolCallId: string }>;
  usage: AgentRuntimeStateSnapshot["usage"];
  error?: Error;
}

export interface ProviderConfig {
  providerId:
    | "anthropic"
    | "openai"
    | "openai-compatible"
    | "google"
    | "vertex"
    | "bedrock"
    | "mistral";
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  options?: Record<string, unknown>;
  apiKeyEnv?: string[];
}

export interface ProviderModel {
  providerId: ProviderConfig["providerId"];
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputPrice?: number;
  outputPrice?: number;
  capabilities?: {
    toolUse?: boolean;
    vision?: boolean;
    reasoning?: boolean;
  };
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
  teamId: string;
  status: "active" | "paused" | "completed" | "aborted" | "error";
  config: ProviderConfig;
  snapshot: AgentRuntimeStateSnapshot;
  totalUsage: AgentRuntimeStateSnapshot["usage"];
  createdAt: number;
  updatedAt: number;
}

export interface AgentCapabilities {
  requestToolApproval?: (
    request: ToolApprovalRequest
  ) => Promise<ToolApprovalResult>;
}
