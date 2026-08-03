import { Op } from "sequelize";
import { AgentMessage, AgentSession, Team, User } from "@server/models";
import type { AgentMessage as DomainAgentMessage } from "./agentLoop";

/* -------------------------------------------------------------------------- */
/*  Session bridge                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Restore the messages of a session from Postgres, in chronological order.
 * Used by the new Cline-pattern `agentLoop` to hydrate `initialMessages`
 * when a session is resumed.
 */
export async function restoreSessionMessages(
  sessionId: string
): Promise<DomainAgentMessage[]> {
  const rows = await AgentMessage.findAll({
    where: { sessionId },
    order: [["createdAt", "ASC"]],
  });
  return rows.map(rowToDomainMessage);
}

/**
 * Persist a full agent-message stream at the end of a run. Idempotent:
 * we delete existing messages for the session first, then re-insert the
 * current in-memory state. This mirrors the Cline `ConversationStore`
 * pattern where a session's "canonical transcript" is the source of
 * truth.
 */
export async function persistSessionTranscript(
  sessionId: string,
  messages: DomainAgentMessage[]
): Promise<void> {
  await AgentMessage.destroy({ where: { sessionId } });
  if (messages.length === 0) {
    return;
  }
  const rows = messages.map((m) => messageToRow(sessionId)(m));
  await AgentMessage.bulkCreate(rows);
}

/**
 * Update the lightweight session manifest. The detail (messages) lives
 * in `agent_messages`; this row is the index + the "this session has
 * 12 messages, last active 3m ago" summary the UI shows in the history
 * pane.
 */
export async function touchSession(
  sessionId: string,
  patch: {
    title?: string;
    lastMessageAt?: Date;
    contextDocumentId?: string | null;
  } = {}
): Promise<void> {
  await AgentSession.update(patch, { where: { id: sessionId } });
}

/** Read a session by id, scoped to a team. */
export async function readSession(
  sessionId: string,
  teamId: string
): Promise<AgentSession | null> {
  return AgentSession.findOne({
    where: { id: sessionId, teamId },
  });
}

/** List recent sessions for a user (for the history pane). */
export async function listUserSessions(
  userId: string,
  limit = 25
): Promise<AgentSession[]> {
  return AgentSession.findAll({
    where: { userId },
    order: [
      ["lastMessageAt", "DESC"],
      ["updatedAt", "DESC"],
    ],
    limit,
  });
}

/* -------------------------------------------------------------------------- */
/*  Row <-> domain mappers                                                   */
/* -------------------------------------------------------------------------- */

function rowToDomainMessage(row: AgentMessage): DomainAgentMessage {
  const parts = safeJson<unknown[]>(row.parts, []);
  return {
    id: row.id,
    role: row.role as
      | "user"
      | "assistant"
      | "tool"
      | "system"
      | "status"
      | "error",
    parts: parts as DomainAgentMessage["parts"],
    createdAt: row.createdAt.getTime(),
    usage:
      (row.inputTokens !== null && row.inputTokens !== undefined) ||
      (row.outputTokens !== null && row.outputTokens !== undefined)
        ? {
            inputTokens: row.inputTokens ?? 0,
            outputTokens: row.outputTokens ?? 0,
          }
        : undefined,
  };
}

function messageToRow(sessionId: string) {
  return (m: DomainAgentMessage) => ({
    sessionId,
    role: m.role as "user" | "assistant",
    parts: JSON.stringify(m.parts),
    inputTokens: m.usage?.inputTokens ?? null,
    outputTokens: m.usage?.outputTokens ?? null,
  });
}

function safeJson<T>(s: string | null, fallback: T): T {
  if (!s) {
    return fallback;
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/**
 * Aggregate per-session token usage by summing all assistant messages.
 * Used by the UI to show "this session used 4.2k tokens" without
 * re-deriving from the message log every render.
 */
export async function sessionUsage(
  sessionId: string
): Promise<{ input: number; output: number }> {
  const row = (await AgentMessage.findOne({
    where: { sessionId, role: "assistant" },
    attributes: [
      [
        AgentMessage.sequelize!.fn(
          "COALESCE",
          AgentMessage.sequelize!.fn(
            "SUM",
            AgentMessage.sequelize!.col("inputTokens")
          ),
          AgentMessage.sequelize!.literal("0")
        ),
        "inputTotal",
      ],
      [
        AgentMessage.sequelize!.fn(
          "COALESCE",
          AgentMessage.sequelize!.fn(
            "SUM",
            AgentMessage.sequelize!.col("outputTokens")
          ),
          AgentMessage.sequelize!.literal("0")
        ),
        "outputTotal",
      ],
    ],
    raw: true,
  })) as unknown as { inputTotal: number; outputTotal: number } | null;
  if (!row) {
    return { input: 0, output: 0 };
  }
  return {
    input: Number(row.inputTotal) || 0,
    output: Number(row.outputTotal) || 0,
  };
}

// Keep `User`/`Team`/`Op` references so tree-shakers don't drop the
// imports when the file is consumed via `import type` only.
void User;
void Team;
void Op;
