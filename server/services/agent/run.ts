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
    const url = `${(env.AI_API_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "")}/v1/chat/completions`;
    const model = env.OPENAI_MODEL ?? "gpt-4o-mini";

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
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: opts.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      Logger.error(
        `Upstream LLM error: ${upstream.status} ${errText.slice(0, 200)}`,
        new Error(`upstream ${upstream.status}`)
      );
      yield {
        type: "error",
        message: `LLM upstream returned ${upstream.status}`,
        code: "upstream_error",
      };
      return;
    }

    // Parse SSE: each event is "data: {json}\n\n"
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finishReason: string | null = null;
    const assistantToolCalls: Array<{
      id: string;
      name: string;
      arguments: string;
    }> = [];
    const toolCallAccum = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let usage: { input_tokens: number; output_tokens: number } | undefined;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) {
            continue;
          }
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            continue;
          }
          let chunk: UpstreamChunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }
          if (chunk.usage) {
            usage = {
              input_tokens: chunk.usage.prompt_tokens ?? 0,
              output_tokens: chunk.usage.completion_tokens ?? 0,
            };
          }
          const choice = chunk.choices?.[0];
          if (!choice) {
            continue;
          }
          const delta = choice.delta;
          if (delta?.content) {
            yield { type: "text_delta", delta: delta.content };
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              const acc = toolCallAccum.get(idx) ?? {
                id: "",
                name: "",
                arguments: "",
              };
              if (tc.id) {
                acc.id = tc.id;
              }
              if (tc.function?.name) {
                acc.name = tc.function.name;
              }
              if (tc.function?.arguments) {
                acc.arguments += tc.function.arguments;
              }
              toolCallAccum.set(idx, acc);
            }
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(`Stream read failed: ${msg}`, err as Error);
      yield { type: "error", message: "stream interrupted" };
      return;
    }

    // Collect tool calls and emit start/end events
    const finalToolCalls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    for (const acc of toolCallAccum.values()) {
      if (!acc.id || !acc.name) {
        continue;
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = acc.arguments ? JSON.parse(acc.arguments) : {};
      } catch {
        parsed = { _parseError: "malformed JSON", _raw: acc.arguments };
      }
      finalToolCalls.push({ id: acc.id, name: acc.name, args: parsed });
    }
    for (const tc of finalToolCalls) {
      yield { type: "tool_call_start", id: tc.id, name: tc.name };
      yield { type: "tool_call_end", id: tc.id, args: tc.args };
    }

    // Push assistant message to the conversation for the next step
    const assistantMsg: ChatMessage = { role: "assistant", content: null };
    if (finalToolCalls.length > 0) {
      assistantMsg.tool_calls = finalToolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      }));
    }
    messages.push(assistantMsg);

    yield {
      type: "step_end",
      step,
      stop_reason: finishReason ?? "stop",
      usage,
    };

    // If no tool calls, the agent is done.
    if (finalToolCalls.length === 0 || finishReason === "stop") {
      yield { type: "done" };
      return;
    }

    // Execute the tool calls (in parallel) and append results.
    const team = (await User.findByPk(opts.user.id, {
      include: [{ model: Team, as: "team" }],
    })) as User & { team: Team };

    const toolResults = await Promise.all(
      finalToolCalls.map(async (tc) => {
        const handler = findToolHandler(tc.name);
        if (!handler) {
          return {
            id: tc.id,
            content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
            is_error: true,
          };
        }
        try {
          const result = await handler(tc.args, {
            user: team,
            team: team.team,
          });
          return {
            id: tc.id,
            content: JSON.stringify(result ?? null),
            is_error: false,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            id: tc.id,
            content: JSON.stringify({ error: message }),
            is_error: true,
          };
        }
      })
    );

    // Yield each tool result to the client, then append to the
    // conversation for the next LLM turn.
    for (const r of toolResults) {
      let parsed: unknown = r.content;
      try {
        parsed = JSON.parse(r.content);
      } catch {
        // keep as string
      }
      yield {
        type: "tool_result",
        id: r.id,
        result: parsed,
        is_error: r.is_error,
      };
    }
    for (const r of toolResults) {
      messages.push({
        role: "tool",
        tool_call_id: r.id,
        content: r.content,
      });
    }
  }

  // Hit max steps
  yield { type: "error", message: "max_steps_exceeded" };
}
