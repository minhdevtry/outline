import { z } from "zod";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { Team } from "@server/models";
import { APIContext } from "@server/types";
import { runAgent } from "@server/services/agent/run";
import { buildAgentSystemPrompt } from "@server/services/agent/prompts";
import { teamHasEmbeddingKey } from "@server/utils/embeddings/mistral";
import type { AgentEvent } from "@server/services/agent/types";

/**
 * Exported route definitions consumed by `routes/api/ai/index.ts` and
 * registered inline. The original design mounted a sub-router but Koa-router
 * 12 has issues with sub-routers mounted at "/" inside another router when
 * any of the inner route names share a prefix; the inner routes get
 * shadowed by the parent's catch-all and Koa answers with 405 Method Not
 * Allowed. Inlining avoids that.
 */
export const AgentRunSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(20000),
      })
    )
    .min(1)
    .max(50),
  sessionId: z.string().uuid().optional(),
});

export async function handleAgentRun(ctx: APIContext) {
  const { user } = ctx.state.auth;
  const body = AgentRunSchema.parse(ctx.request.body);

  const team = await Team.findByPk(user.teamId);
  if (!team) {
    ctx.throw(404, "Team not found");
  }
  if (!team.aiEnabled) {
    ctx.throw(403, "AI is not enabled for this team");
  }
  if (!process.env.OPENAI_API_KEY) {
    ctx.throw(503, "AI is not configured on this server");
  }

  const hasEmbeddings = await teamHasEmbeddingKey(team.id);
  const systemPrompt = buildAgentSystemPrompt(user, team, hasEmbeddings);

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

  const write = (event: AgentEvent) => {
    ctx.res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const ping = setInterval(() => ctx.res.write(`: ping\n\n`), 15000);
  ctx.req.on("close", () => clearInterval(ping));

  try {
    for await (const ev of runAgent({
      user,
      systemPrompt,
      messages: body.messages,
      tools: [],
      signal: ac.signal,
    })) {
      if (ac.signal.aborted) {
        break;
      }
      write(ev);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write({ type: "error", message });
  } finally {
    clearInterval(ping);
    ctx.res.end();
  }
}

export async function handleAgentStatus(ctx: APIContext) {
  const { user } = ctx.state.auth;
  const team = await Team.findByPk(user.teamId);
  if (!team) {
    ctx.throw(404, "Team not found");
  }
  const hasEmbeddings = await teamHasEmbeddingKey(team.id);
  const hasLLM = !!process.env.OPENAI_API_KEY;
  ctx.body = {
    data: {
      enabled: !!team.aiEnabled,
      hasLLM,
      hasEmbeddings,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    },
  };
}
