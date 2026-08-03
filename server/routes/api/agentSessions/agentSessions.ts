import Router from "koa-router";
import { z } from "zod";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { AgentMessage, AgentSession, Team } from "@server/models";
import type { APIContext } from "@server/types";

/**
 * REST endpoints for the AI agent's persistent conversation history. The
 * right-rail panel uses these to load past sessions, create a new one on
 * the first message, and delete sessions the user no longer wants to
 * keep. All routes are scoped to the caller's `userId` so a user can
 * never read or mutate another user's sessions, even inside the same
 * team.
 */
const router = new Router();

const ListSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(50),
});

const CreateSchema = z.object({
  title: z.string().max(200).optional(),
  contextDocumentId: z.string().uuid().optional(),
});

const UpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

router.post(
  "agentSessions.list",
  auth(),
  rateLimiter({ requests: 60, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = ListSchema.parse(ctx.request.body ?? {});
    const rows = await AgentSession.findAll({
      where: { userId: user.id },
      order: [
        ["lastMessageAt", "DESC"],
        ["updatedAt", "DESC"],
      ],
      limit: body.limit,
    });
    ctx.body = {
      data: rows.map((s) => ({
        id: s.id,
        title: s.title,
        contextDocumentId: s.contextDocumentId,
        lastMessageAt: s.lastMessageAt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    };
  }
);

router.post(
  "agentSessions.create",
  auth(),
  rateLimiter({ requests: 60, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = CreateSchema.parse(ctx.request.body ?? {});
    const team = await Team.findByPk(user.teamId);
    if (!team) {
      ctx.throw(404, "Team not found");
    }
    if (!team.aiEnabled) {
      ctx.throw(403, "AI is not enabled for this team");
    }
    const session = await AgentSession.create({
      teamId: user.teamId,
      userId: user.id,
      title: body.title ?? "",
      contextDocumentId: body.contextDocumentId ?? null,
    });
    ctx.body = {
      data: {
        id: session.id,
        title: session.title,
        contextDocumentId: session.contextDocumentId,
        lastMessageAt: session.lastMessageAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    };
  }
);

router.post(
  "agentSessions.get",
  auth(),
  rateLimiter({ requests: 60, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = z
      .object({ id: z.string().uuid() })
      .parse(ctx.request.body ?? {});
    const session = await AgentSession.findOne({
      where: { id: body.id, userId: user.id },
    });
    if (!session) {
      ctx.throw(404, "Session not found");
    }
    const messages = await AgentMessage.findAll({
      where: { sessionId: session.id },
      order: [["createdAt", "ASC"]],
    });
    ctx.body = {
      data: {
        id: session.id,
        title: session.title,
        contextDocumentId: session.contextDocumentId,
        lastMessageAt: session.lastMessageAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: safeParse(m.parts, []),
          createdAt: m.createdAt,
        })),
      },
    };
  }
);

router.post(
  "agentSessions.update",
  auth(),
  rateLimiter({ requests: 60, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = z
      .object({ id: z.string().uuid() })
      .merge(UpdateSchema)
      .parse(ctx.request.body ?? {});
    const session = await AgentSession.findOne({
      where: { id: body.id, userId: user.id },
    });
    if (!session) {
      ctx.throw(404, "Session not found");
    }
    if (body.title !== undefined) {
      session.title = body.title;
    }
    await session.save();
    ctx.body = { data: { success: true } };
  }
);

router.post(
  "agentSessions.delete",
  auth(),
  rateLimiter({ requests: 60, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = z
      .object({ id: z.string().uuid() })
      .parse(ctx.request.body ?? {});
    const session = await AgentSession.findOne({
      where: { id: body.id, userId: user.id },
    });
    if (!session) {
      ctx.throw(404, "Session not found");
    }
    await session.destroy();
    ctx.body = { data: { success: true } };
  }
);

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export default router;
