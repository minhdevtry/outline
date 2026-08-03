/* -------------------------------------------------------------------------- */
/*  Provider system (mirrors Cline's two-layer handler)                       */
/* -------------------------------------------------------------------------- */

export type ProviderId = "openai" | "anthropic" | "openai-compatible";

/** Common Provider interface — the minimal contract a stream-capable
 * provider must satisfy. */
export interface Provider {
  stream(input: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
  }): AsyncIterable<ProviderEvent>;
}

export interface ProviderConfig {
  providerId: ProviderId;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  headers?: Record<string, string>;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCost?: number;
}

export type ProviderEvent =
  | { type: "text-delta"; text: string; accumulated: string }
  | { type: "reasoning-delta"; text: string; redacted?: boolean }
  | {
      type: "tool-call-delta";
      toolCallId: string;
      toolName?: string;
      inputDelta?: string;
    }
  | { type: "usage"; usage: ProviderUsage }
  | {
      type: "finish";
      finishReason: "stop" | "tool_calls" | "max_tokens" | "error";
    }
  | { type: "error"; message: string };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: string;
  }>;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface OpenAIChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{
    type: "function";
    function: ToolDefinition;
  }>;
  tool_choice?:
    | "auto"
    | "none"
    | { type: "function"; function: { name: string } };
  stream: true;
  max_tokens?: number;
  temperature?: number;
  reasoning_effort?: "low" | "medium" | "high";
  [key: string]: unknown;
}

export interface AnthropicRequest {
  model: string;
  system?: string;
  messages: Array<{
    role: "user" | "assistant";
    content:
      | string
      | Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: unknown }
          | {
              type: "tool_result";
              tool_use_id: string;
              content: string | unknown[];
              is_error?: boolean;
            }
          | { type: "thinking"; thinking: string }
        >;
  }>;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  max_tokens: number;
  temperature?: number;
  thinking?: { type: "enabled"; budget_tokens: number };
  stream: true;
}
