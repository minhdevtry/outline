import Logger from "@server/logging/Logger";
import type {
  ChatMessage,
  OpenAIChatRequest,
  Provider,
  ProviderEvent,
  ToolDefinition,
} from "./providers";

/* -------------------------------------------------------------------------- */
/*  OpenAI + OpenAI-compatible                                                */
/* -------------------------------------------------------------------------- */

export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  headers?: Record<string, string>;
}

export class OpenAIProvider implements Provider {
  private cfg: OpenAIProviderConfig;

  constructor(cfg: OpenAIProviderConfig) {
    this.cfg = cfg;
  }

  async *stream(input: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
  }): AsyncIterable<ProviderEvent> {
    const body: OpenAIChatRequest = {
      model: this.cfg.model,
      messages: input.messages,
      stream: true,
    };
    if (input.tools?.length) {
      body.tools = input.tools.map((t) => ({
        type: "function" as const,
        function: t,
      }));
    }
    if (this.cfg.maxTokens) {
      body.max_tokens = this.cfg.maxTokens;
    }
    if (this.cfg.temperature !== undefined) {
      body.temperature = this.cfg.temperature;
    }

    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey}`,
        ...this.cfg.headers,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `OpenAI-compatible ${this.cfg.baseUrl} returned ${res.status}: ${text.slice(0, 200)}`
      );
    }
    yield* parseOpenAIStream(res.body);
  }
}

async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<ProviderEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolCalls = new Map<
    number,
    { id: string; name: string; input: string }
  >();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) {
          continue;
        }
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          break;
        }
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{
              index: number;
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const choice = chunk.choices?.[0];
          if (!choice) {
            continue;
          }
          if (choice.delta?.content) {
            text += choice.delta.content;
            yield {
              type: "text-delta",
              text: choice.delta.content,
              accumulated: text,
            };
          }
          for (const tc of choice.delta?.tool_calls ?? []) {
            const existing = toolCalls.get(tc.index) ?? {
              id: "",
              name: "",
              input: "",
            };
            if (tc.id) {
              existing.id = tc.id;
            }
            if (tc.function?.name) {
              existing.name = tc.function.name;
            }
            if (tc.function?.arguments) {
              existing.input += tc.function.arguments;
            }
            toolCalls.set(tc.index, existing);
            yield {
              type: "tool-call-delta",
              toolCallId: existing.id || String(tc.index),
              toolName: existing.name,
              inputDelta: tc.function?.arguments,
            };
          }
          if (chunk.usage) {
            const inT = chunk.usage.prompt_tokens ?? 0;
            const outT = chunk.usage.completion_tokens ?? 0;
            yield {
              type: "usage",
              usage: { inputTokens: inT, outputTokens: outT },
            };
          }
          if (choice.finish_reason) {
            yield {
              type: "finish",
              finishReason: normalizeFinish(choice.finish_reason),
            };
          }
        } catch (err) {
          Logger.warn(
            "agent.provider.openai",
            `Stream parse error: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function normalizeFinish(
  r: string
): "stop" | "tool_calls" | "max_tokens" | "error" {
  switch (r) {
    case "stop":
    case "tool_calls":
    case "length":
      return "stop";
    default:
      return "error";
  }
}
