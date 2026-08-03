import env from "@server/env";
import Logger from "@server/logging/Logger";
import { Team, User } from "@server/models";
import type { AgentEvent, AgentRunOptions } from "./types";
import { findToolHandler, getAgentToolDefinitions } from "./tools";

/**
 * The agentic loop. Streams the LLM response, executes any tool calls it
 * requests, and feeds the results back in until the model says `end_turn`
 * or we hit `maxSteps`. Each iteration yields one or more `AgentEvent`s
 * that the SSE route forwards to the browser.
 *
 * The LLM call uses the OpenAI Chat Completions streaming format (the
 * endpoint already in use for `ai.answer`); tool definitions follow the
 * OpenAI function-calling schema. The loop is intentionally small and
 * synchronous: we want to keep the SSE stream tight and the failure
 * surface minimal.
 *
 * The model is expected to return tool calls with a final `finish_reason`
 * of either `stop` (done) or `tool_calls` (more iterations needed). On
 * any 4xx/5xx from the upstream LLM, we yield a single `error` event and
 * terminate — the user's connection will see the error and the SSE stream
 * will close.
 */

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface UpstreamDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
}

interface UpstreamChunk {
  choices?: Array<{
    delta?: UpstreamDelta;
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const MAX_STEPS_DEFAULT = 8;

export async function* runAgent(
  opts: AgentRunOptions
): AsyncGenerator<AgentEvent> {
  const tools = getAgentToolDefinitions();
  const maxSteps = opts.maxSteps ?? MAX_STEPS_DEFAULT;

  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    ...opts.messages,
  ];

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal.aborted) {
      yield { type: "error", message: "aborted" };
      return;
    }
    yield { type: "step_start", step };

    // Stream from upstream
    const baseUrl = (env.AI_API_BASE_URL ?? "https://api.openai.com").replace(
      /\/$/,
      ""
    );
    const model = opts.model ?? env.OPENAI_MODEL ?? "MiniMax-M3";

    // Try Anthropic Messages API (/v1/messages) first as preferred by local MiniMax proxy
    const anthropicRes = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.OPENAI_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "tool" ? "user" : m.role,
            content:
              (m as { anthropicContent?: unknown }).anthropicContent ??
              m.content ??
              "",
          })),
        system: messages.find((m) => m.role === "system")?.content,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        stream: true,
        max_tokens: 2000,
        temperature: 0.3,
      }),
      signal: opts.signal,
    }).catch(() => null);

    if (anthropicRes && !anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => "");
      Logger.error(
        `Anthropic LLM step ${step} error: ${anthropicRes.status} ${errText.slice(0, 300)}`,
        new Error(`anthropic_${anthropicRes.status}`)
      );
    }

    if (anthropicRes && anthropicRes.ok && anthropicRes.body) {
      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let hasEmittedDelta = false;
      const anthropicTools = new Map<
        string,
        { name: string; inputJson: string }
      >();
      let currentBlockId = "";

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
              }
              if (line.startsWith("data: ")) {
                data = line.slice(6);
              }
            }
            if (!eventType || !data) {
              continue;
            }
            try {
              const parsed = JSON.parse(data) as {
                type?: string;
                content_block?: { type?: string; id?: string; name?: string };
                delta?: {
                  type?: string;
                  text?: string;
                  partial_json?: string;
                };
              };

              if (eventType === "content_block_start" && parsed.content_block) {
                if (
                  parsed.content_block.type === "tool_use" &&
                  parsed.content_block.id
                ) {
                  currentBlockId = parsed.content_block.id;
                  anthropicTools.set(currentBlockId, {
                    name: parsed.content_block.name ?? "",
                    inputJson: "",
                  });
                }
              } else if (eventType === "content_block_delta" && parsed.delta) {
                if (
                  parsed.delta.type === "text_delta" &&
                  parsed.delta.text
                ) {
                  hasEmittedDelta = true;
                  yield { type: "text_delta", delta: parsed.delta.text };
                } else if (
                  parsed.delta.type === "input_json_delta" &&
                  parsed.delta.partial_json &&
                  currentBlockId
                ) {
                  const existing = anthropicTools.get(currentBlockId);
                  if (existing) {
                    existing.inputJson += parsed.delta.partial_json;
                  }
                }
              }
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // stream interrupted
      }

      if (anthropicTools.size > 0) {
        const teamUser = (await User.findByPk(opts.user.id, {
          include: [{ model: Team, as: "team" }],
        })) as User & { team: Team };

        for (const [id, tc] of anthropicTools.entries()) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = tc.inputJson ? JSON.parse(tc.inputJson) : {};
          } catch {
            parsedArgs = { _raw: tc.inputJson };
          }

          yield { type: "tool_call_start", id, name: tc.name };
          yield { type: "tool_call_end", id, args: parsedArgs };

          const handler = findToolHandler(tc.name);
          if (!handler) {
            const errRes = { ok: false, error: `Unknown tool: ${tc.name}` };
            yield {
              type: "tool_result",
              id,
              result: errRes,
              is_error: true,
            };
            messages.push({
              role: "assistant",
              content: `Called tool ${tc.name} with ${JSON.stringify(parsedArgs)}`,
            });
            messages.push({
              role: "user",
              content: `Tool ${tc.name} result:\n${JSON.stringify(errRes)}`,
            });
            continue;
          }

          try {
            const result = await handler(parsedArgs, {
              user: teamUser,
              team: teamUser.team,
            });
            yield {
              type: "tool_result",
              id,
              result,
              is_error: Boolean(
                result && typeof result === "object" && "error" in result
              ),
            };
            messages.push({
              role: "assistant",
              content: `Called tool ${tc.name} with ${JSON.stringify(parsedArgs)}`,
            });
            messages.push({
              role: "user",
              content: `Tool ${tc.name} result:\n${JSON.stringify(result ?? null)}`,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const errRes = { ok: false, error: message };
            yield {
              type: "tool_result",
              id,
              result: errRes,
              is_error: true,
            };
            messages.push({
              role: "assistant",
              content: `Called tool ${tc.name} with ${JSON.stringify(parsedArgs)}`,
            });
            messages.push({
              role: "user",
              content: `Tool ${tc.name} result:\n${JSON.stringify(errRes)}`,
            });
          }
        }
        yield { type: "step_end", step, stop_reason: "tool_use" };
        continue;
      }

      if (hasEmittedDelta) {
        yield { type: "step_end", step, stop_reason: "stop" };
        yield { type: "done" };
        return;
      }
    }

    const url = `${baseUrl}/v1/chat/completions`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: step === 0 ? "auto" : "auto",
        stream: false,
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: opts.signal,
    }).catch(() => null);

    if (!upstream || !upstream.ok) {
      yield {
        type: "error",
        message: `Hệ thống AI hiện đang tạm thời gián đoạn từ nhà cung cấp model. Vui lòng thử lại sau giây lát.`,
        code: "upstream_error",
      };
      return;
    }

    const json = (await upstream.json().catch(() => ({}))) as {
      choices?: Array<{
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = json.choices?.[0];
    const assistantMsg = choice?.message;

    if (assistantMsg?.content) {
      yield { type: "text_delta", delta: assistantMsg.content };
    }

    const finalToolCalls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];

    if (assistantMsg?.tool_calls) {
      for (const tc of assistantMsg.tool_calls) {
        if (!tc.id || !tc.function?.name) {
          continue;
        }
        let parsed: Record<string, unknown> = {};
        try {
          parsed = tc.function.arguments
            ? JSON.parse(tc.function.arguments)
            : {};
        } catch {
          parsed = { _raw: tc.function.arguments };
        }
        finalToolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: parsed,
        });
      }
    }

    if (finalToolCalls.length > 0) {
      for (const tc of finalToolCalls) {
        yield { type: "tool_call_start", id: tc.id, name: tc.name };
        yield { type: "tool_call_end", id: tc.id, args: tc.args };
      }

      messages.push({
        role: "assistant",
        content: assistantMsg?.content ?? null,
        tool_calls: assistantMsg?.tool_calls,
      });

      for (const tc of finalToolCalls) {
        const handler = findToolHandler(tc.name);
        if (!handler) {
          const errRes = { ok: false, error: `Tool not found: ${tc.name}` };
          yield {
            type: "tool_result",
            id: tc.id,
            result: errRes,
            is_error: true,
          };
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify(errRes),
          });
          continue;
        }
        try {
          const teamUser = (await User.findByPk(opts.user.id, {
            include: [{ model: Team, as: "team" }],
          })) as User & { team: Team };
          const result = await handler(tc.args, {
            user: teamUser,
            team: teamUser.team,
          });
          yield {
            type: "tool_result",
            id: tc.id,
            result,
            is_error: Boolean(
              result && typeof result === "object" && "error" in result
            ),
          };
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify(result),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const errRes = { ok: false, error: msg };
          yield {
            type: "tool_result",
            id: tc.id,
            result: errRes,
            is_error: true,
          };
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify(errRes),
          });
        }
      }
    } else {
      if (assistantMsg?.content) {
        messages.push({
          role: "assistant",
          content: assistantMsg.content,
        });
      }
    }

    const usage = json.usage
      ? {
          input_tokens: json.usage.prompt_tokens ?? 0,
          output_tokens: json.usage.completion_tokens ?? 0,
        }
      : undefined;

    yield {
      type: "step_end",
      step,
      stop_reason: choice?.finish_reason ?? "stop",
      usage,
    };

  }

  // Hit max steps
  yield { type: "error", message: "max_steps_exceeded" };
}

/**
 * Fallback path: if the upstream LLM rejects the streaming request, retry
 * once with `stream: false` and return the assembled assistant content as
 * a single string. This is enough to keep the agent useful when the
 * model server's streaming parser is broken (a known issue with the
 * local MiniMax-M3 proxy that surfaces as
 * "cannot access local variable 'yielded'" on every stream=true).
 */
async function tryNonStreamingFallback(
  url: string,
  model: string,
  messages: ChatMessage[],
  tools: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>,
  signal: AbortSignal,
  budgetMs = 8_000
): Promise<string | null> {
  // Compose the caller's abort signal with our own hard budget so a
  // wedged upstream can't hold the SSE stream open past Cloudflare's
  // 60s read limit. The caller still controls cancellation; we just
  // add a fail-safe wall clock.
  const fallbackAc = new AbortController();
  const onCallerAbort = () => fallbackAc.abort();
  signal.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => fallbackAc.abort(), budgetMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: "auto",
        stream: false,
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: fallbackAc.signal,
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onCallerAbort);
  }
}
