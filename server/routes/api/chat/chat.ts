import { z } from "zod";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { Team } from "@server/models";
import { APIContext } from "@server/types";
import {
  resolveDefaultProvider,
  buildProvider,
} from "@server/services/agent/providerFactory";
import type { Provider, ProviderEvent } from "@server/services/agent/providers";

/* -------------------------------------------------------------------------- */
/*  Schema                                                                    */
/* -------------------------------------------------------------------------- */

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(200000),
});

const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(100),
  system: z.string().max(8000).optional(),
  model: z.string().max(200).optional(),
});

export type ChatRequestMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/* -------------------------------------------------------------------------- */
/*  Provider resolution — Anthropic first                                     */
/* -------------------------------------------------------------------------- */

function resolveProviderForTeam(_teamId: string, model?: string): Provider {
  // 1. Anthropic compatible — preferred (per user direction)
  if (process.env.ANTHROPIC_API_KEY) {
    return buildProvider({
      providerId: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      maxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS ?? 4096),
      baseUrl: process.env.ANTHROPIC_API_BASE_URL,
    });
  }
  // 2. OpenAI-compatible (custom baseUrl)
  if (process.env.OPENAI_API_KEY && process.env.AI_API_BASE_URL) {
    return buildProvider({
      providerId: "openai-compatible",
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.AI_API_BASE_URL,
      model: model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    });
  }
  // 3. OpenAI
  if (process.env.OPENAI_API_KEY) {
    return buildProvider({
      providerId: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    });
  }
  throw new Error(
    "No AI provider configured. Set ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY."
  );
}

/* -------------------------------------------------------------------------- */
/*  Route handlers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/chat.send
 *
 * Minimal Anthropic-compatible chat endpoint. Streams text deltas back as
 * Server-Sent Events:
 *
 *   data: {"type":"text","delta":"..."}\n\n
 *   data: {"type":"usage","inputTokens":N,"outputTokens":M}\n\n
 *   data: {"type":"finish"}\n\n
 *   data: {"type":"error","message":"..."}\n\n
 *
 * No tools, no sessions, no plan mode — just chat. Designed to be wrapped
 * directly by Cline's UI primitives.
 */
export async function handleChatSend(ctx: APIContext) {
  const { user } = ctx.state.auth;
  const team = await Team.findByPk(user.teamId);
  if (!team) {
    ctx.throw(404, "Team not found");
  }

  let body: ChatRequest;
  try {
    body = ChatRequestSchema.parse(ctx.request.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      ctx.throw(
        400,
        `Invalid request body: ${err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`
      );
    }
    throw err;
  }

  let provider: Provider;
  try {
    provider = resolveProviderForTeam(team.id, body.model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.throw(503, message);
  }

  const ac = new AbortController();
  ctx.req.on("close", () => ac.abort());

  ctx.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  ctx.respond = false;
  ctx.res.flushHeaders?.();

  const write = (event: unknown) => {
    ctx.res.write(`data: ${JSON.stringify(event)}\n\n`);
    (ctx.res as { flush?: () => void }).flush?.();
  };

  const ping = setInterval(() => ctx.res.write(`: ping\n\n`), 15000);
  ctx.req.on("close", () => clearInterval(ping));

  // Build wire messages: prepend system if provided, else default.
  const systemPrompt =
    body.system ??
    "You are a helpful AI assistant embedded in Outline, a collaborative knowledge base for teams. Be concise, accurate, and friendly. Use Markdown when useful.";

  const wireMessages = [
    { role: "system" as const, content: systemPrompt },
    ...body.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  try {
    for await (const ev of provider.stream({ messages: wireMessages })) {
      if (ac.signal.aborted) {
        break;
      }
      write(translateEvent(ev));
      if (ev.type === "finish" || ev.type === "error") {
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write({ type: "error", message });
  } finally {
    clearInterval(ping);
    ctx.res.end();
  }
}

function translateEvent(ev: ProviderEvent): unknown {
  switch (ev.type) {
    case "text-delta":
      return { type: "text", delta: ev.text };
    case "reasoning-delta":
      return { type: "reasoning", delta: ev.text };
    case "tool-call-delta":
      return {
        type: "tool-call",
        id: ev.toolCallId,
        name: ev.toolName ?? "",
        inputDelta: ev.inputDelta ?? "",
      };
    case "usage":
      return {
        type: "usage",
        inputTokens: ev.usage.inputTokens,
        outputTokens: ev.usage.outputTokens,
      };
    case "finish":
      return { type: "finish", reason: ev.finishReason };
    case "error":
      return { type: "error", message: ev.message };
  }
}

/**
 * POST /api/chat.status
 * Reports whether the chat endpoint is configured.
 */
export async function handleChatStatus(ctx: APIContext) {
  const { user } = ctx.state.auth;
  const team = await Team.findByPk(user.teamId);
  if (!team) {
    ctx.throw(404, "Team not found");
  }
  const provider = resolveDefaultProvider();
  ctx.body = {
    data: {
      enabled: !!team.aiEnabled,
      configured: provider !== null,
      provider: process.env.ANTHROPIC_API_KEY
        ? "anthropic"
        : process.env.OPENAI_API_KEY
          ? "openai"
          : null,
      model:
        process.env.ANTHROPIC_MODEL ??
        process.env.OPENAI_MODEL ??
        (process.env.ANTHROPIC_API_KEY ? "claude-sonnet-4-6" : "gpt-4o-mini"),
      baseUrl:
        process.env.ANTHROPIC_API_BASE_URL ??
        process.env.AI_API_BASE_URL ??
        null,
    },
  };
}

export { ChatRequestSchema, ChatMessageSchema };
