import Router from "koa-router";
import { z } from "zod";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { AgentProviderKey, Team, User } from "@server/models";
import { APIContext } from "@server/types";

/**
 * REST endpoints for per-workspace LLM provider keys. The
 * `/agentProviderKeys.list` endpoint returns each provider's metadata
 * (without the secret value); `update` upserts; `delete` removes.
 *
 * Authentication: `auth()` only — keys are scoped to a single workspace
 * so any member can manage them. Tighten to admin-only in a follow-up
 * if needed.
 */
const router = new Router();

const VALID_PROVIDERS = ["openai", "anthropic", "openai-compatible"] as const;

const ListSchema = z.object({});

const UpdateSchema = z.object({
  provider: z.enum(VALID_PROVIDERS),
  apiKey: z.string().min(1).max(2000),
  baseUrl: z.string().max(500).optional().nullable(),
  model: z.string().max(100).optional().nullable(),
  enabled: z.boolean().optional().default(true),
});

const DeleteSchema = z.object({
  provider: z.enum(VALID_PROVIDERS),
});

function present(k: AgentProviderKey) {
  return {
    id: k.id,
    provider: k.provider,
    /** Never expose the raw key. Show only last 4 chars for
     * identification. */
    apiKeySuffix: k.apiKey.slice(-4),
    baseUrl: k.baseUrl,
    model: k.model,
    enabled: k.enabled,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
  };
}

router.post(
  "agentProviderKeys.list",
  auth(),
  rateLimiter({ requests: 60, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const team = await Team.findByPk(user.teamId);
    if (!team) {
      ctx.throw(404, "Team not found");
    }
    const keys = await AgentProviderKey.findAll({
      where: { teamId: user.teamId },
    });
    ctx.body = { data: keys.map(present) };
  }
);

router.post(
  "agentProviderKeys.update",
  auth(),
  rateLimiter({ requests: 30, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = UpdateSchema.parse(ctx.request.body ?? {});
    // The encrypted-at-rest path goes here. For the scaffold we store
    // the key in plaintext. Encrypt before persisting in a real
    // deployment.
    const [key] = await AgentProviderKey.upsert({
      teamId: user.teamId,
      provider: body.provider,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl ?? null,
      model: body.model ?? null,
      enabled: body.enabled,
    });
    await User.update({ updatedAt: new Date() }, { where: { id: user.id } });
    ctx.body = { data: present(key) };
  }
);

router.post(
  "agentProviderKeys.delete",
  auth(),
  rateLimiter({ requests: 30, duration: 60 }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;
    const body = DeleteSchema.parse(ctx.request.body ?? {});
    const deleted = await AgentProviderKey.destroy({
      where: { teamId: user.teamId, provider: body.provider },
    });
    ctx.body = { data: { success: deleted > 0 } };
  }
);

export default router;
