import type { Team, User } from "@server/models";

/**
 * Build the system prompt for the agent. The team's `guidanceMCP` field
 * (already a column) is treated as the per-team "extra rules" — typically
 * things like "always respond in Vietnamese" or "use the company voice".
 *
 * @param currentDocument Optional id and title of the document the user is
 *   currently viewing. When set, a short block is added to the prompt so the
 *   model can prefer that document for ambiguous requests. The full text is
 *   not included — the model must call `read_document` to fetch it.
 * @param skill Optional active skill. When set, its `systemPromptFragment`
 *   is appended to the prompt and a one-line note tells the model which
 *   persona is active.
 */
export function buildAgentSystemPrompt(
  user: User,
  team: Team,
  hasEmbeddings: boolean,
  currentDocument?: { id: string; title: string },
  currentSelection?: { from: number; to: number; text: string },
  skill?: { name: string; displayName: string; systemPromptFragment: string }
): string {
  const base = `You are Outline's built-in AI agent. You help the user manage their
Markdown knowledge base: read documents, search the workspace using semantic + keyword
hybrid search, edit documents, create new ones, and leave comments.

You are a focused agent, not a chatbot. Default to using tools over asking questions.
If a tool fails, try a different approach — do not give up after the first error.

Behavior:
- When you need context, ALWAYS call \`search_documents\` first rather than guessing.
- When the user asks to edit a specific passage, ALWAYS call \`read_document\` first to
  see the current text, then call \`edit_document\` with an EXACT substring match.
- When the user says "summarize", "rewrite", "translate", or "improve" a document,
  read it first, then use \`edit_document\` to apply the change.
- Prefer minimal, surgical edits over wholesale rewrites.
- Cite sources inline as [N] matching the order returned by \`search_documents\`.
- If you're not sure, ask the user a clarifying question rather than guessing.
- Respond in the same language the user wrote in (default: the team's
  DEFAULT_LANGUAGE, but mirror the user's last message).`;

  const toolBlock = `

Available tools (call them in JSON via the function-calling interface):
- search_documents(query, limit) — semantic + keyword hybrid search of the workspace.
- read_document(documentId | documentTitle) — fetch the full markdown of a document.
- edit_document(documentId, searchText, replaceText, replaceAll) — replace text
  in a document. The search text must match EXACTLY.
- create_document(title, text, collectionId?, publish?) — create a new document.
- list_collections(limit) — list workspace collections.
- add_comment(documentId, text) — post a comment on a document.

When you use a tool, the result is fed back to you in the next turn. After receiving
the result, either call another tool or write the final answer to the user.`;

  const contextBlock = hasEmbeddings
    ? ""
    : `

NOTE: This workspace has not yet been indexed for AI search. The RAG pipeline
will be ready once documents are processed (typically within a few minutes of
saving). Until then, \`search_documents\` may return no results — fall back to
\`read_document\` for direct document access.`;

  const userBlock = `

You are acting on behalf of: ${user.name} (${user.email})
Team: ${team.name}`;

  const documentContext = currentDocument
    ? `

The user is currently viewing a document:
- Title: "${currentDocument.title}"
- id: ${currentDocument.id}

When the user's request is ambiguous, prefer acting on this document (e.g. summarizing
or editing it) rather than searching the workspace. Call \`read_document\` to fetch
its full text before any edit.`
    : "";

  const selectionContext = currentSelection
    ? `

The user has a text selection in the current document at positions ${currentSelection.from}-${currentSelection.to}.
The selected text is:

\`\`\`
${currentSelection.text}
\`\`\`

When the user asks to act on "this", "the selection", or otherwise references content
without naming it, treat this as the subject. To replace or remove it, call
\`edit_document\` with this exact text as the \`searchText\` argument. To leave
the surrounding prose untouched, prefer surgical edits.`
    : "";

  const teamGuidance = team.guidanceMCP
    ? `\n\nTeam-specific guidance (from admin):\n${team.guidanceMCP}`
    : "";

  const skillBlock = skill?.systemPromptFragment
    ? `\n\nActive skill: "${skill.displayName}" (id: ${skill.name}).\n\n${skill.systemPromptFragment}`
    : "";

  return (
    base +
    toolBlock +
    contextBlock +
    userBlock +
    documentContext +
    selectionContext +
    teamGuidance +
    skillBlock
  );
}
