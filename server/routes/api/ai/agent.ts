import { z } from "zod";
import {
  AgentMessage,
  AgentSession,
  AgentSkill,
  Document,
  Team,
} from "@server/models";
import type { APIContext } from "@server/types";
import { runAgent } from "@server/services/agent/run";
import { buildAgentSystemPrompt } from "@server/services/agent/prompts";
import { getAgentToolDefinitions } from "@server/services/agent/tools";
import { teamHasEmbeddingKey } from "@server/utils/embeddings/mistral";

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
        // Allow empty assistant placeholders (the client streams a new
        // assistant message that has no content yet). User messages still
        // require content to keep callers honest.
        content: z.string().max(20000),
      })
    )
    .min(1)
    .max(50)
    .refine(
      (msgs) =>
        msgs.every((m) => m.role !== "user" || m.content.trim().length > 0),
      { message: "User messages must have non-empty content" }
    ),
  sessionId: z.string().uuid().optional(),
  currentDocumentId: z.string().uuid().optional(),
  currentSelection: z
    .object({
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
      text: z.string().min(1).max(8000),
    })
    .optional(),
  skillId: z.string().uuid().optional(),
  model: z.string().optional(),
});

export async function handleAgentRun(ctx: APIContext) {
  const { user } = ctx.state.auth;
  let body;
  try {
    body = AgentRunSchema.parse(ctx.request.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      ctx.throw(
        400,
        `Invalid request body: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
      );
    }
    throw err;
  }

  const team = await Team.findByPk(user.teamId);
  if (!team) {
    ctx.throw(404, "Team not found");
  }
  if (!team.aiEnabled) {
    team.aiEnabled = true;
    await team.save();
  }

  const hasEmbeddings = await teamHasEmbeddingKey(team.id);

  // Resolve the current document (if any) for the system prompt context.
  // The team filter is the authorization boundary: users from other teams
  // who pass another team's doc id will get nothing.
  let currentDocument: { id: string; title: string } | undefined;
  if (body.currentDocumentId) {
    const doc = await Document.findOne({
      where: { id: body.currentDocumentId, teamId: team.id },
      attributes: ["id", "title"],
    });
    if (doc) {
      currentDocument = { id: doc.id, title: doc.title };
    }
  }

  // Resolve the persistent session. If the client passed a sessionId, we
  // load it (and its prior messages); otherwise we create a new one. If the
  // requested sessionId is not found, we create a fresh session instead of
  // throwing 404.
  let session: AgentSession;
  if (body.sessionId) {
    const found = await AgentSession.findOne({
      where: { id: body.sessionId, userId: user.id },
    });
    if (found) {
      session = found;
    } else {
      session = await AgentSession.create({
        teamId: user.teamId,
        userId: user.id,
        title: "",
        contextDocumentId: body.currentDocumentId ?? null,
      });
    }
  } else {
    session = await AgentSession.create({
      teamId: user.teamId,
      userId: user.id,
      title: "",
      contextDocumentId: body.currentDocumentId ?? null,
    });
  }

  // Resolve the active skill (persona). When set, the system prompt gets
  // the skill's `systemPromptFragment` and the tool list is filtered to
  // the skill's `toolNames`. A skillId that doesn't exist or isn't owned
  // by the team is silently ignored (same pattern as currentDocument).
  let activeSkill:
    | {
        name: string;
        displayName: string;
        systemPromptFragment: string;
        toolNames: string[];
      }
    | undefined;
  if (body.skillId) {
    const skill = await AgentSkill.findOne({
      where: { id: body.skillId, teamId: team.id },
    });
    if (skill) {
      activeSkill = {
        name: skill.name,
        displayName: skill.displayName,
        systemPromptFragment: skill.systemPromptFragment,
        toolNames: skill.toolNames,
      };
    }
  }

  const systemPrompt = buildAgentSystemPrompt(
    user,
    team,
    hasEmbeddings,
    currentDocument,
    body.currentSelection,
    activeSkill
  );

  const tools = getAgentToolDefinitions(activeSkill?.toolNames);

  ctx.compress = false;
  ctx.status = 200;
  ctx.res.statusCode = 200;
  ctx.res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Content-Encoding": "identity",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  ctx.respond = false;
  ctx.res.flushHeaders?.();

  const write = (event: unknown) => {
    try {
      ctx.res.write(`data: ${JSON.stringify(event)}\n\n`);
      (ctx.res as { flush?: () => void }).flush?.();
    } catch {
      // ignore
    }
  };

  const isTerminal = (ev: unknown): boolean => {
    if (!ev || typeof ev !== "object") {
      return false;
    }
    const t = (ev as { type?: string }).type;
    return t === "done" || t === "error";
  };

  write({ type: "session", sessionId: session.id });
  write({ type: "thinking" });

  const ping = setInterval(() => {
    try {
      ctx.res.write(`: ping\n\n`);
      (ctx.res as { flush?: () => void }).flush?.();
    } catch {
      // ignore
    }
  }, 3000);
  ctx.req.on("close", () => clearInterval(ping));

  // Persist the new user message at the start so even an aborted run
  // leaves a record of what was asked.
  const userText = body.messages
    .map((m) => m.content)
    .join("\n")
    .slice(0, 20000);
  await AgentMessage.create({
    sessionId: session.id,
    role: "user",
    parts: JSON.stringify([{ type: "text", text: userText }]),
  });
  await session.update({ lastMessageAt: new Date() });

  // Track the assistant parts as the SSE stream emits them so we can
  // persist the full message at the end (including tool calls).
  const ac = new AbortController();
  ctx.req.on("close", () => ac.abort());

  const assistantParts: Array<Record<string, unknown>> = [];
  let lastUsage: { input_tokens?: number; output_tokens?: number } | undefined;

  try {
    for await (const ev of runAgent({
      user,
      systemPrompt,
      messages: body.messages,
      tools,
      signal: ac.signal,
      currentDocumentId: body.currentDocumentId,
      currentSelection: body.currentSelection,
      model: body.model,
    })) {
      if (ac.signal.aborted) {
        break;
      }
      // Mirror the run.ts logic for accumulating parts on the server so
      // we can persist the full message. The same event flows to the
      // client; here we just track it for persistence.
      switch (ev.type) {
        case "text_delta": {
          const last = assistantParts[assistantParts.length - 1];
          if (last && last.type === "text") {
            last.text = String(last.text ?? "") + ev.delta;
          } else {
            assistantParts.push({ type: "text", text: ev.delta });
          }
          break;
        }
        case "tool_call_start": {
          assistantParts.push({
            type: "tool_call",
            id: ev.id,
            name: ev.name,
            args: {},
          });
          break;
        }
        case "tool_call_end": {
          const part = assistantParts.find(
            (p) => p.type === "tool_call" && p.id === ev.id
          );
          if (part) {
            part.args = ev.args;
          }
          break;
        }
        case "tool_result": {
          const part = assistantParts.find(
            (p) => p.type === "tool_call" && p.id === ev.id
          );
          if (part) {
            part.result = ev.result;
            part.is_error = ev.is_error;
          }
          break;
        }
        case "step_end": {
          if (ev.usage) {
            lastUsage = ev.usage;
          }
          break;
        }
        default:
          break;
      }
      if (ac.signal.aborted) {
        break;
      }
      write(ev);
      // Terminal event: stop the keep-alive ping and close the SSE
      // socket so the browser sees the stream as finished. Without
      // this, EventSource keeps the connection open until Cloudflare's
      // 60s read timeout kills it, and the user sees the spinner sit
      // for the full minute even though the error/done event already
      // arrived. Persistence still happens in `finally`.
      if (isTerminal(ev)) {
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write({ type: "error", message });
  } finally {
    clearInterval(ping);
    try {
      ctx.res.write("data: [DONE]\n\n");
      (ctx.res as { flush?: () => void }).flush?.();
    } catch {
      // ignore
    }
    // Persist the assembled assistant message.
    if (assistantParts.length > 0) {
      await AgentMessage.create({
        sessionId: session.id,
        role: "assistant",
        parts: JSON.stringify(assistantParts),
        inputTokens: lastUsage?.input_tokens ?? null,
        outputTokens: lastUsage?.output_tokens ?? null,
      });
      await session.update({ lastMessageAt: new Date() });
    }
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
