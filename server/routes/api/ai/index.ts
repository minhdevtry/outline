import Router from "koa-router";
import { z } from "zod";
import { UserRole } from "@shared/types";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { Team, User } from "@server/models";
import { answerQuestion, getAIStatus } from "@server/services/ai";
import { APIContext } from "@server/types";

const router = new Router();

const AiAnswerSchema = z.object({
  query: z.string().min(3).max(2000),
});

const AiToggleSchema = z.object({
  aiEnabled: z.boolean(),
  aiModel: z.string().nullable().optional(),
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
  ctx.body = { data: getAIStatus(team) };
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
  },
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

export default router;
