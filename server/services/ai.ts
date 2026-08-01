import { Document, User, Team } from "@server/models";
import env from "@server/env";

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
 * Check if AI Answer is configured and available for a team.
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
 * Search Outline documents for the given query and return top results as
 * context snippets.
 */
async function getRelevantDocuments(
  query: string,
  teamId: string,
  limit: number,
): Promise<Array<{ id: string; title: string; text: string }>> {
  // Simple search: find documents whose title or text matches the query
  // For a production RAG system, use proper full-text search (Postgres tsvector).
  const Op = (await import("sequelize")).Op;

  const documents = await Document.findAll({
    where: {
      teamId,
      publishedAt: { [Op.ne]: null },
      // Use ILIKE for simple text matching. Replace with FTS in production.
      [Op.or]: [
        { title: { [Op.iLike]: `%${query}%` } },
        { text: { [Op.iLike]: `%${query}%` } },
      ],
    },
    attributes: ["id", "title", "text"],
    limit,
    order: [["updatedAt", "DESC"]],
  });

  return documents.map((d) => ({
    id: d.id,
    title: d.title,
    text: (d.text ?? "").slice(0, 4000), // truncate to avoid huge prompts
  }));
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
  userPrompt: string,
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
 */
export async function answerQuestion(
  query: string,
  user: User,
): Promise<AIAnswerResult> {
  const team = await Team.findByPk(user.teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  const status = getAIStatus(team);
  if (!status.configured || !status.teamEnabled) {
    throw new Error(status.reason ?? "AI not available");
  }

  const documents = await getRelevantDocuments(
    query,
    user.teamId,
    env.AI_MAX_CONTEXT_DOCS ?? 5,
  );

  if (documents.length === 0) {
    return {
      answer:
        "I couldn't find any relevant documents in your workspace to answer this question. Try rephrasing or creating more documents on this topic.",
      sources: [],
      tokensUsed: 0,
    };
  }

  const contextBlock = documents
    .map(
      (d, i) =>
        `[${i + 1}] Title: ${d.title}\nContent: ${d.text}\n---\n`,
    )
    .join("\n");

  const systemPrompt = `You are an AI assistant for a team's knowledge base (Outline). Answer the user's question based ONLY on the provided document context. If the answer is not in the context, say so. Be concise and direct. Cite sources using [N] notation matching the document numbers. Respond in the same language as the user's question.`;

  const userPrompt = `Context from the team's knowledge base:\n\n${contextBlock}\n\nQuestion: ${query}`;

  const { content, tokensUsed } = await callChatCompletions(
    status.model,
    systemPrompt,
    userPrompt,
  );

  return {
    answer: content,
    sources: documents.map((d) => ({
      id: d.id,
      title: d.title,
      url: `/doc/${d.id}`,
      snippet: d.text.slice(0, 200),
    })),
    tokensUsed,
  };
}
