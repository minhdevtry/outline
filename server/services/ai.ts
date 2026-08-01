import Logger from "@server/logging/Logger";
import { User, Team } from "@server/models";
import env from "@server/env";
import { teamHasEmbeddingKey } from "@server/utils/embeddings/mistral";
import { searchChunks } from "@server/utils/rag/search";

export interface AIAnswerResult {
  answer: string;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    snippet: string;
  }>;
  tokensUsed: number;
}

export interface AIConfigStatus {
  configured: boolean;
  model: string;
  teamEnabled: boolean;
  reason?: string;
}

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_CONTEXT_TOKENS = 6000;

/**
 * Returns the configured AI base URL, defaulting to the public OpenAI API.
 */
function getBaseUrl(): string {
  return (env.AI_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

/**
 * Returns the configured AI model, defaulting to gpt-4o-mini.
 */
function getDefaultModel(): string {
  return env.OPENAI_MODEL ?? DEFAULT_MODEL;
}

/**
 * Check if AI Answer is configured and available for a team. This is
 * chat-side configuration (LLM API key + team toggle); RAG configuration
 * (Mistral keys) is checked separately by `answerQuestion`.
 */
export function getAIStatus(team: Team): AIConfigStatus {
  if (!env.OPENAI_API_KEY) {
    return {
      configured: false,
      model: getDefaultModel(),
      teamEnabled: false,
      reason: "OPENAI_API_KEY not set on server",
    };
  }
  const model = team.aiModel ?? getDefaultModel();
  if (!team.aiEnabled) {
    return {
      configured: true,
      model,
      teamEnabled: false,
      reason: "AI is not enabled for this team (admin can enable in settings)",
    };
  }
  return {
    configured: true,
    model,
    teamEnabled: true,
  };
}

/**
 * Call an OpenAI/Anthropic-compatible Chat Completions endpoint to answer a
 * question using Outline documents as context. Honors AI_API_BASE_URL when set
 * so the same client works against OpenAI, an internal LLM gateway, or any
 * proxy that speaks the OpenAI Chat Completions wire format.
 */
async function callChatCompletions(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ content: string; tokensUsed: number }> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 800,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    tokensUsed: data.usage?.total_tokens ?? 0,
  };
}

/**
 * Answer a question using the team's Outline documents as context.
 *
 * Retrieval is hybrid: vector similarity (Mistral embedding) fused with
 * keyword relevance (Postgres FTS + trigram) via Reciprocal Rank Fusion.
 * See `server/utils/rag/search.ts` for the SQL.
 */
export async function answerQuestion(
  query: string,
  user: User
): Promise<AIAnswerResult> {
  const team = await Team.findByPk(user.teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  const status = getAIStatus(team);
  if (!status.configured || !status.teamEnabled) {
    throw new Error(status.reason ?? "AI not available");
  }

  // RAG pre-check: the team needs at least one valid Mistral key for the
  // hybrid search to have a query embedding. Without it, fall back to a
  // graceful "no docs" message rather than throwing a 500.
  const hasKey = await teamHasEmbeddingKey(user.teamId);
  if (!hasKey) {
    return {
      answer:
        "AI search is not configured for this workspace yet. An admin needs to add a Mistral API key under Settings → AI → Embedding keys.",
      sources: [],
      tokensUsed: 0,
    };
  }

  let chunks;
  try {
    chunks = await searchChunks(query, user.teamId, 8);
  } catch (err) {
    Logger.error(`[ai] searchChunks failed: ${(err as Error).message}`, err as Error);
    return {
      answer:
        "I couldn't search the workspace right now. Please try again in a moment.",
      sources: [],
      tokensUsed: 0,
    };
  }

  if (chunks.length === 0) {
    return {
      answer:
        "I couldn't find any relevant documents in your workspace to answer this question. Try rephrasing or creating more documents on this topic.",
      sources: [],
      tokensUsed: 0,
    };
  }

  // Cap total context to a reasonable token budget so the prompt never
  // grows unbounded. Drop the lowest-RRF chunks until under the cap.
  const maxContextTokens = env.AI_MAX_CONTEXT_TOKENS ?? DEFAULT_CONTEXT_TOKENS;
  const maxContextChars = maxContextTokens * 4;
  const MAX_CHUNK_CHARS = 1500;
  const accepted: typeof chunks = [];
  let used = 0;
  for (const c of chunks) {
    const truncated = c.content.length > MAX_CHUNK_CHARS
      ? c.content.slice(0, MAX_CHUNK_CHARS) + "…"
      : c.content;
    const cost = truncated.length + 8;
    if (used + cost > maxContextChars && accepted.length > 0) {
      break;
    }
    accepted.push({ ...c, content: truncated });
    used += cost;
  }

  // Dedupe by document so the user sees distinct docs in the source list.
  const seenDocs = new Set<string>();
  const dedupedSources: AIAnswerResult["sources"] = [];
  for (const c of accepted) {
    if (seenDocs.has(c.documentId)) {
      continue;
    }
    seenDocs.add(c.documentId);
    dedupedSources.push({
      id: c.documentId,
      title: c.documentTitle,
      url: c.documentUrl,
      snippet: c.content.slice(0, 200),
    });
  }

  const contextBlock = accepted
    .map((c, i) => {
      const headingLine = c.heading
        ? ` (heading: "${c.heading}")`
        : "";
      return `[${i + 1}]${headingLine} Title: ${c.documentTitle}\nContent: ${c.content}\n---\n`;
    })
    .join("\n");

  const systemPrompt = `You are an AI assistant for a team's knowledge base (Outline). Answer the user's question based ONLY on the provided chunk context. Each chunk is prefixed with [N] — cite sources by referencing those numbers (e.g. "see [1]"). If the answer is not in the context, say so. Be concise and direct. Respond in the same language as the user's question.`;

  const userPrompt = `Context from the team's knowledge base:\n\n${contextBlock}\n\nQuestion: ${query}`;

  const { content, tokensUsed } = await callChatCompletions(
    status.model,
    systemPrompt,
    userPrompt
  );

  return {
    answer: content,
    sources: dedupedSources,
    tokensUsed,
  };
}
