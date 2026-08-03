import Router from "koa-router";
import { z } from "zod";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { AgentSchedule } from "@server/models";
import { APIContext } from "@server/types";

/**
 * REST endpoints for the AI agent's scheduler. Mirrors the
 * `agentSessions` shape (list / create / update / delete) plus
 * `agentSchedules.run-now` to trigger an immediate run.
 *
 * Schedule resolution (parsing `cron` into `nextRunAt`) lives in the
 * `DispatchAgentSchedulesTask` (added in Phase 3.9) — this file just
 * CRUDs the row.
 */
const router = new Router();

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  cron: z.string().min(1).max(100),
  prompt: z.string().min(1).max(20000),
  enabled: z.boolean().optional().default(true),
  agentId: z.string().min(1).max(32).optional().default("agent"),
});

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  cron: z.string().min(1).max(100).optional(),
  prompt: z.string().min(1).max(20000).optional(),
  enabled: z.boolean().optional(),
  agentId: z.string().min(1).max(32).optional(),
});

function present(s: AgentSchedule) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    cron: s.cron,
    prompt: s.prompt,
    enabled: s.enabled,
    agentId: s.agentId,
    nextRunAt: s.nextRunAt,
    lastRunAt: s.lastRunAt,
    lastRunId: s.lastRunId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

router.post(
  "agentSchedules.list",
  auth(),
  rateLimiter({ requests: 60, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const rows = await AgentSchedule.findAll({
      where: { teamId: user.teamId },
      order: [
        ["enabled", "DESC"],
        ["nextRunAt", "ASC"],
      ],
    });
    ctx.body = { data: rows.map(present) };
  }
);

router.post(
  "agentSchedules.create",
  auth(),
  rateLimiter({ requests: 30, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = CreateSchema.parse(ctx.request.body ?? {});
    const schedule = await AgentSchedule.create({
      teamId: user.teamId,
      createdById: user.id,
      name: body.name,
      description: body.description ?? null,
      cron: body.cron,
      prompt: body.prompt,
      enabled: body.enabled,
      agentId: body.agentId ?? "agent",
      nextRunAt: new Date(), // Dispatcher recomputes on first poll.
    });
    ctx.body = { data: present(schedule) };
  }
);

router.post(
  "agentSchedules.update",
  auth(),
  rateLimiter({ requests: 30, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = z
      .object({ id: z.string().uuid() })
      .merge(UpdateSchema)
      .parse(ctx.request.body ?? {});
    const schedule = await AgentSchedule.findOne({
      where: { id: body.id, teamId: user.teamId },
    });
    if (!schedule) {
      ctx.throw(404, "Schedule not found");
    }
    if (body.name !== undefined) schedule.name = body.name;
    if (body.description !== undefined) schedule.description = body.description;
    if (body.cron !== undefined) schedule.cron = body.cron;
    if (body.prompt !== undefined) schedule.prompt = body.prompt;
    if (body.enabled !== undefined) schedule.enabled = body.enabled;
    if (body.agentId !== undefined) schedule.agentId = body.agentId;
    await schedule.save();
    ctx.body = { data: present(schedule) };
  }
);

router.post(
  "agentSchedules.delete",
  auth(),
  rateLimiter({ requests: 30, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = z
      .object({ id: z.string().uuid() })
      .parse(ctx.request.body ?? {});
    const schedule = await AgentSchedule.findOne({
      where: { id: body.id, teamId: user.teamId },
    });
    if (!schedule) {
      ctx.throw(404, "Schedule not found");
    }
    await schedule.destroy();
    ctx.body = { data: { success: true } };
  }
);

/**
 * Manually trigger a schedule now. Sets `nextRunAt` to the current
 * time so the dispatcher picks it up on its next poll. The actual
 * execution is done by the dispatcher task; this endpoint is just a
 * "fire now" lever.
 */
router.post(
  "agentSchedules.run-now",
  auth(),
  rateLimiter({ requests: 10, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = z
      .object({ id: z.string().uuid() })
      .parse(ctx.request.body ?? {});
    const [count] = await AgentSchedule.update(
      { nextRunAt: new Date() },
      { where: { id: body.id, teamId: user.teamId, enabled: true } }
    );
    if (count === 0) {
      ctx.throw(404, "Schedule not found or disabled");
    }
    ctx.body = { data: { success: true } };
  }
);

export default router;
