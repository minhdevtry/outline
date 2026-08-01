import Router from "koa-router";
import { z } from "zod";
import { UserRole } from "@shared/types";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { sequelize } from "@server/storage/database";
import { Document, Team, User } from "@server/models";
import { answerQuestion, getAIStatus } from "@server/services/ai";
import { APIContext } from "@server/types";
import { getActiveEmbeddingModel } from "@server/utils/embeddings/mistral";
import FullReindexTeamTask from "@server/queues/tasks/FullReindexTeamTask";

const router = new Router();

const AiAnswerSchema = z.object({
  query: z.string().min(3).max(2000),
});

const AiToggleSchema = z.object({
  aiEnabled: z.boolean(),
  aiModel: z.string().nullable().optional(),
});

const AiReindexSchema = z.object({
  force: z.boolean().optional().default(true),
});

/**
 * Returns whether AI Answer is configured and enabled for the current team.
 * Available to all authenticated users so the UI can show/hide the AI button.
 */
router.post("ai.status", auth(), async (ctx: APIContext) => {
  const { user } = ctx.state.auth;
  const team = await Team.findByPk(user.teamId);
  if (!team) {
    ctx.throw(404, "Team not found");
  }
  const status = getAIStatus(team);
  ctx.body = {
    data: {
      ...status,
      embeddingModel: getActiveEmbeddingModel(),
    },
  };
});

/**
 * Ask a question to the AI. Uses the team's Outline documents as context.
 * Rate limited to avoid abuse and runaway OpenAI costs.
 */
router.post(
  "ai.answer",
  auth(),
  rateLimiter({ requests: 30, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = AiAnswerSchema.parse(ctx.request.body);

    try {
      const result = await answerQuestion(body.query, user);
      ctx.body = { data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI error";
      ctx.throw(400, message);
    }
  }
);

/**
 * Admin: enable/disable AI Answer for the team. Only team admins can call.
 */
router.post("ai.toggle", auth(), async (ctx: APIContext) => {
  const { user } = ctx.state.auth;
  if (user.role !== UserRole.Admin) {
    ctx.throw(403, "Only admins can change AI settings");
  }
  const body = AiToggleSchema.parse(ctx.request.body);

  const team = await Team.findByPk(user.teamId);
  if (!team) {
    ctx.throw(404, "Team not found");
  }

  team.aiEnabled = body.aiEnabled;
  if (body.aiModel !== undefined) {
    team.aiModel = body.aiModel;
  }
  await team.save();

  ctx.body = {
    data: {
      aiEnabled: team.aiEnabled,
      aiModel: team.aiModel,
    },
  };
});

/**
 * Admin: get embedding job statistics for the team.
 */
router.post(
  "ai.embeddingStatus",
  auth(),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const teamId = user.teamId;
    const rows = (await sequelize.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::int AS indexed,
         COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM embedding_jobs
       WHERE "teamId" = :teamId`,
      { replacements: { teamId }, type: "SELECT" }
    )) as unknown as Array<{ indexed: number; in_progress: number; pending: number; failed: number }>;

    const stats = rows[0] ?? { indexed: 0, in_progress: 0, pending: 0, failed: 0 };

    const docRows = (await sequelize.query(
      `SELECT
         (SELECT count(*) FROM documents WHERE "teamId" = :teamId AND "publishedAt" IS NOT NULL AND "deletedAt" IS NULL)::int AS total_documents,
         (SELECT count(DISTINCT "documentId") FROM document_chunks WHERE "teamId" = :teamId)::int AS indexed_documents`,
      { replacements: { teamId }, type: "SELECT" }
    )) as unknown as Array<{ total_documents: number; indexed_documents: number }>;
    const docs = docRows[0] ?? { total_documents: 0, indexed_documents: 0 };

    ctx.body = {
      data: {
        ...stats,
        totalDocuments: docs.total_documents,
        indexedDocuments: docs.indexed_documents,
        embeddingModel: getActiveEmbeddingModel(),
      },
    };
  }
);

/**
 * Admin: schedule a full reindex of the team. Background priority; safe
 * to invoke repeatedly.
 */
router.post(
  "ai.reindex",
  auth(),
  rateLimiter({ requests: 2, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    if (user.role !== UserRole.Admin) {
      ctx.throw(403, "Only admins can trigger a reindex");
    }
    const body = AiReindexSchema.parse(ctx.request.body);
    await new FullReindexTeamTask().schedule({
      teamId: user.teamId,
      force: body.force,
    });
    ctx.body = { data: { success: true } };
  }
);

export default router;
