import Router from "koa-router";
import { z } from "zod";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { AgentSkill } from "@server/models";
import type { APIContext } from "@server/types";

/**
 * REST endpoints for the AI agent's skill (persona) registry. The
 * right-rail panel uses these to list the team's skills, let the user
 * pick one as active, and (for admins) create/edit/delete. All routes
 * are scoped to the caller's `teamId` so skills from other teams are
 * never exposed.
 */
const router = new Router();

const CreateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_-]+$/, "lowercase letters, digits, _ and - only"),
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  systemPromptFragment: z.string().max(8000).default(""),
  toolNames: z.array(z.string().min(1).max(100)).max(50).default([]),
  isDefault: z.boolean().optional().default(false),
  icon: z.string().max(50).optional(),
  color: z.string().max(20).optional(),
});

const UpdateSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  systemPromptFragment: z.string().max(8000).optional(),
  toolNames: z.array(z.string().min(1).max(100)).max(50).optional(),
  isDefault: z.boolean().optional(),
  icon: z.string().max(50).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
});

function present(s: AgentSkill) {
  return {
    id: s.id,
    name: s.name,
    displayName: s.displayName,
    description: s.description,
    systemPromptFragment: s.systemPromptFragment,
    toolNames: s.toolNames,
    isDefault: s.isDefault,
    icon: s.icon,
    color: s.color,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

router.post(
  "agentSkills.list",
  auth(),
  rateLimiter({ requests: 60, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const rows = await AgentSkill.findAll({
      where: { teamId: user.teamId },
      order: [
        ["isDefault", "DESC"],
        ["displayName", "ASC"],
      ],
    });
    ctx.body = { data: rows.map(present) };
  }
);

router.post(
  "agentSkills.create",
  auth(),
  rateLimiter({ requests: 30, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = CreateSchema.parse(ctx.request.body ?? {});
    const existing = await AgentSkill.findOne({
      where: { teamId: user.teamId, name: body.name },
    });
    if (existing) {
      ctx.throw(409, `A skill named "${body.name}" already exists`);
    }
    // Only one default skill per team; clear the existing one if needed.
    if (body.isDefault) {
      await AgentSkill.update(
        { isDefault: false },
        { where: { teamId: user.teamId, isDefault: true } }
      );
    }
    const skill = await AgentSkill.create({
      teamId: user.teamId,
      createdById: user.id,
      name: body.name,
      displayName: body.displayName,
      description: body.description ?? null,
      systemPromptFragment: body.systemPromptFragment,
      toolNames: body.toolNames,
      isDefault: body.isDefault,
      icon: body.icon ?? null,
      color: body.color ?? null,
    });
    ctx.body = { data: present(skill) };
  }
);

router.post(
  "agentSkills.update",
  auth(),
  rateLimiter({ requests: 30, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = z
      .object({ id: z.string().uuid() })
      .merge(UpdateSchema)
      .parse(ctx.request.body ?? {});
    const skill = await AgentSkill.findOne({
      where: { id: body.id, teamId: user.teamId },
    });
    if (!skill) {
      ctx.throw(404, "Skill not found");
    }
    if (body.isDefault === true) {
      await AgentSkill.update(
        { isDefault: false },
        { where: { teamId: user.teamId, isDefault: true } }
      );
    }
    if (body.displayName !== undefined) {
      skill.displayName = body.displayName;
    }
    if (body.description !== undefined) {
      skill.description = body.description;
    }
    if (body.systemPromptFragment !== undefined) {
      skill.systemPromptFragment = body.systemPromptFragment;
    }
    if (body.toolNames !== undefined) {
      skill.toolNames = body.toolNames;
    }
    if (body.isDefault !== undefined) {
      skill.isDefault = body.isDefault;
    }
    if (body.icon !== undefined) {
      skill.icon = body.icon;
    }
    if (body.color !== undefined) {
      skill.color = body.color;
    }
    await skill.save();
    ctx.body = { data: present(skill) };
  }
);

router.post(
  "agentSkills.delete",
  auth(),
  rateLimiter({ requests: 30, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = z
      .object({ id: z.string().uuid() })
      .parse(ctx.request.body ?? {});
    const skill = await AgentSkill.findOne({
      where: { id: body.id, teamId: user.teamId },
    });
    if (!skill) {
      ctx.throw(404, "Skill not found");
    }
    await skill.destroy();
    ctx.body = { data: { success: true } };
  }
);

export default router;
