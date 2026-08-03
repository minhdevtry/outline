import { createHash } from "node:crypto";
import { sequelize } from "@server/storage/database";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { AgentMemory } from "@server/models";
import { embedLocal } from "@server/utils/embeddings/local";

/**
 * Memory extraction + retrieval for the AI agent.
 *
 * After a conversation ends, `extractMemories` asks the LLM to distill
 * persistent facts about the user (preferences, context, decisions) from
 * the full message history. Each fact is embedded with the same local
 * ONNX model used by RAG (`Xenova/multilingual-e5-small`, 384-dim) and
 * upserted into `agent_memories`. Near-duplicates are detected via
 * SHA-256 of the normalized content; the existing row is archived and a
 * new one is inserted.
 *
 * On every new agent run, `retrieveMemories` embeds the last few
 * messages, runs a pgvector cosine-similarity search, and returns the
 * top-k as a `{content, category}` array. The agent's system prompt
 * builder appends these to the "user" block so the model can act on
 * them naturally.
 */
export interface ExtractedFact {
  /** The fact as a single sentence. */
  content: string;
  /** A short category, e.g. "preference", "context", "fact". */
  category: string;
  /** 0..1 confidence from the extractor. */
  confidence: number;
}

const EXTRACTION_SYSTEM_PROMPT = `You are an extractor for a personal knowledge base. Read the conversation and identify facts the user has revealed about themselves, their work, their preferences, or their environment that would be useful to remember in future sessions.

Output ONLY a JSON object of the form:
{
  "facts": [
    { "content": "User prefers Vietnamese responses", "category": "preference", "confidence": 0.95 },
    ...
  ]
}

Rules:
- Only persistent, specific facts. Skip ephemeral chit-chat.
- One fact per item, written as a single short sentence.
- Choose a category from: preference, context, project, person, fact, style, other.
- Confidence is your self-rated likelihood that this fact is true and useful.
- If the conversation reveals nothing worth remembering, return {"facts": []}.`;

/**
 * Run memory extraction on a finished conversation. Returns the number of
 * memories upserted (created or refreshed).
 */
export async function extractMemories(args: {
  userId: string;
  teamId: string;
  sessionId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ created: number; refreshed: number; skipped: number }> {
  const summary = args.messages
    .slice(-20)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  if (!process.env.OPENAI_API_KEY) {
    Logger.warn("memory", "OPENAI_API_KEY not set; skipping memory extraction");
    return { created: 0, refreshed: 0, skipped: 0 };
  }

  const facts = await callExtractor(summary);
  if (facts.length === 0) {
    return { created: 0, refreshed: 0, skipped: 0 };
  }

  let created = 0;
  let refreshed = 0;
  let skipped = 0;
  for (const fact of facts) {
    const trimmed = fact.content.trim();
    if (trimmed.length < 3 || trimmed.length > 500) {
      skipped++;
      continue;
    }
    const contentHash = createHash("sha256")
      .update(trimmed.toLowerCase())
      .digest("hex");

    // Archive any existing memory with the same contentHash for this user.
    await AgentMemory.update(
      { archived: true },
      { where: { userId: args.userId, contentHash, archived: false } }
    );

    const [embedding] = await embedLocal([trimmed]);
    await AgentMemory.create({
      teamId: args.teamId,
      userId: args.userId,
      category: fact.category.slice(0, 50),
      content: trimmed,
      contentHash,
      embedding: `[${embedding.join(",")}]`,
      model: process.env.EMBEDDING_MODEL ?? "Xenova/multilingual-e5-small",
      confidence: Math.max(0, Math.min(1, fact.confidence)),
      archived: false,
      sourceSessionId: args.sessionId,
    });
    if (fact.confidence < 0.5) {
      skipped++;
    } else {
      created++;
    }
  }
  return { created, refreshed, skipped };
}

/**
 * Cosine-similarity top-k memory retrieval. Returns the most relevant
 * active memories for the given query text, scoped to the user/team.
 */
export async function retrieveMemories(args: {
  userId: string;
  teamId: string;
  query: string;
  limit?: number;
}): Promise<Array<{ content: string; category: string }>> {
  const limit = Math.max(1, Math.min(20, args.limit ?? 6));
  if (args.query.trim().length < 3) {
    return [];
  }
  const [embedding] = await embedLocal([args.query], "query");

  const [rows] = (await sequelize.query(
    `
    SELECT content, category, 1 - (embedding <=> :vec) AS score
    FROM agent_memories
    WHERE "userId" = :userId
      AND "teamId" = :teamId
      AND archived = false
    ORDER BY embedding <=> :vec
    LIMIT :limit
    `,
    {
      replacements: {
        vec: `[${embedding.join(",")}]`,
        userId: args.userId,
        teamId: args.teamId,
        limit,
      },
      type: "SELECT",
    }
  )) as unknown as [
    Array<{ content: string; category: string; score: number }>,
  ];

  // Bump lastUsedAt for returned rows so the recency signal is fresh. Use
  // the content text to identify rows (the returned id is implicit in the
  // selection order). Best-effort: ignore errors so retrieval is never
  // blocked by a side effect.
  if (rows.length > 0) {
    try {
      const now = new Date();
      for (const row of rows) {
        await AgentMemory.update(
          { lastUsedAt: now },
          {
            where: {
              userId: args.userId,
              content: row.content,
              archived: false,
            },
          }
        );
      }
    } catch (err) {
      Logger.warn(
        "memory",
        `Failed to update lastUsedAt: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return rows.map((r) => ({ content: r.content, category: r.category }));
}

async function callExtractor(summary: string): Promise<ExtractedFact[]> {
  const baseUrl = env.AI_API_BASE_URL ?? "https://api.openai.com";
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const model = env.OPENAI_MODEL ?? "gpt-4o-mini";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: summary },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });
  if (!res.ok) {
    Logger.warn(
      "memory",
      `Extractor LLM call failed: ${res.status} ${res.statusText}`
    );
    return [];
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content;
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { facts?: ExtractedFact[] };
    return Array.isArray(parsed.facts) ? parsed.facts : [];
  } catch {
    return [];
  }
}
