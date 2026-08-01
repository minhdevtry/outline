import Router from "koa-router";
import { z } from "zod";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { Team, User } from "@server/models";
import { APIContext } from "@server/types";
import { runAgent } from "@server/services/agent/run";
import { buildAgentSystemPrompt } from "@server/services/agent/prompts";
import { teamHasEmbeddingKey } from "@server/utils/embeddings/mistral";
import type { AgentEvent } from "@server/services/agent/types";

const router = new Router();

const AgentRunSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(20000),
      })
    )
    .min(1)
    .max(50),
  /** Optional session id; when present, the run is logged against it. */
  sessionId: z.string().uuid().optional(),
});

/**
 * Streaming agent endpoint. Returns `text/event-stream` with one
 * `data: <AgentEvent JSON>` line per agentic event. The client accumulates
 * the events into a `UIMessage[]` and renders with the agent UI.
 */
router.post(
  "ai.agent.run",
  auth(),
  rateLimiter({ requests: 30, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = AgentRunSchema.parse(ctx.request.body);

    const team = await Team.findByPk(user.teamId);
    if (!team) {
      ctx.throw(404, "Team not found");
    }
    if (!user.isAdmin && !user.isViewer) {
      // Any signed-in user can run the agent; admins control the toggle.
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
);

/**
 * Quick metadata endpoint for the agent (same shape as ai.status but
 * reports agent-specific capabilities). Lets the UI show "AI Agent enabled"
 * in the right rail.
 */
router.post("ai.agent.status", auth(), async (ctx: APIContext) => {
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
});

export default router;
