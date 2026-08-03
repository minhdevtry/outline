import type {
  AnthropicRequest,
  ChatMessage,
  Provider,
  ProviderEvent,
  ToolDefinition,
} from "./providers";

/* -------------------------------------------------------------------------- */
/*  Anthropic Messages API                                                    */
/* -------------------------------------------------------------------------- */

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  headers?: Record<string, string>;
  baseUrl?: string;
}

export class AnthropicProvider implements Provider {
  private cfg: AnthropicProviderConfig;

  constructor(cfg: AnthropicProviderConfig) {
    this.cfg = cfg;
  }

  async *stream(input: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
  }): AsyncIterable<ProviderEvent> {
    const system = input.messages.find((m) => m.role === "system");
    const rest = input.messages.filter((m) => m.role !== "system");

    const body: AnthropicRequest = {
      model: this.cfg.model,
      stream: true,
      max_tokens: this.cfg.maxTokens ?? 4096,
      messages: rest.map((m) => ({
        role: m.role === "tool" ? "user" : (m.role as "user" | "assistant"),
        content: m.toolCalls
          ? m.toolCalls.map((tc) => ({
              type: "tool_use" as const,
              id: tc.id,
              name: tc.name,
              input: safeParseInput(tc.input),
            }))
          : (m.content ?? ""),
      })),
    };
    if (system?.content) {
      body.system = system.content;
    }
    if (input.tools?.length) {
      body.tools = input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    if (this.cfg.temperature !== undefined) {
      body.temperature = this.cfg.temperature;
    }

    const baseUrl = this.cfg.baseUrl ?? "https://api.anthropic.com";
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": "2023-06-01",
        ...this.cfg.headers,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Anthropic returned ${res.status}: ${text.slice(0, 200)}`
      );
    }
    yield* parseAnthropicStream(res.body);
  }
}

function safeParseInput(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

async function* parseAnthropicStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<ProviderEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolCalls = new Map<string, { name: string; input: string }>();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const evt of events) {
        const lines = evt.split("\n");
        let eventType = "";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            data = line.slice(6);
          }
        }
        if (!eventType || !data) {
          continue;
        }
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        switch (eventType) {
          case "content_block_start": {
            const block = (parsed.content_block ?? {}) as {
              type?: string;
              id?: string;
              name?: string;
            };
            if (block.type === "tool_use" && block.id) {
              toolCalls.set(block.id, {
                name: block.name ?? "",
                input: "",
              });
            }
            break;
          }
          case "content_block_delta": {
            const delta = (parsed.delta ?? {}) as {
              type?: string;
              text?: string;
              thinking?: string;
              partial_json?: string;
            };
            if (delta.type === "text_delta" && delta.text) {
              text += delta.text;
              yield {
                type: "text-delta",
                text: delta.text,
                accumulated: text,
              };
            } else if (
              delta.type === "input_json_delta" &&
              delta.partial_json
            ) {
              const block = (parsed.content_block ?? {}) as { id?: string };
              if (block.id) {
                const existing = toolCalls.get(block.id);
                if (existing) {
                  existing.input += delta.partial_json;
                  yield {
                    type: "tool-call-delta",
                    toolCallId: block.id,
                    toolName: existing.name,
                    inputDelta: delta.partial_json,
                  };
                }
              }
            } else if (delta.type === "thinking_delta" && delta.thinking) {
              yield {
                type: "reasoning-delta",
                text: delta.thinking,
              };
            }
            break;
          }
          case "content_block_stop": {
            const block = (parsed.content_block ?? {}) as { id?: string };
            if (block.id) {
              const existing = toolCalls.get(block.id);
              if (existing) {
                yield {
                  type: "tool-call-delta",
                  toolCallId: block.id,
                  toolName: existing.name,
                  inputDelta: existing.input,
                };
              }
            }
            break;
          }
          case "message_delta": {
            const delta = (parsed.delta ?? {}) as { stop_reason?: string };
            if (delta.stop_reason === "max_tokens") {
              yield { type: "finish", finishReason: "max_tokens" };
            } else if (delta.stop_reason === "tool_use") {
              yield { type: "finish", finishReason: "tool_calls" };
            } else if (delta.stop_reason === "end_turn") {
              yield { type: "finish", finishReason: "stop" };
            }
            break;
          }
          case "message_stop": {
            yield { type: "finish", finishReason: "stop" };
            break;
          }
          case "error": {
            const err = (parsed.error ?? {}) as { message?: string };
            yield {
              type: "error",
              message: err.message ?? "Unknown Anthropic error",
            };
            return;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
