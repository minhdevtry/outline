import { z } from "zod";
import { Op } from "sequelize";
import {
  Collection,
  Comment,
  Document,
  Team,
  User,
} from "@server/models";
import { searchChunks } from "@server/utils/rag/search";
import type { AgentTool } from "./types";

/**
 * Tool definitions exposed to the agent. Each tool has a JSON Schema
 * `parameters` field that the LLM uses to decide when to call it, plus a
 * TypeScript `handler` that runs the actual logic on the server with
 * full Sequelize / RAG access.
 *
 * Tools mirror the existing MCP surface (search_documents, read_document,
 * edit_document, create_document, list_collections, add_comment) so the
 * agent has the same authority as a third-party MCP client. Per-user
 * permissioning is delegated to the MCP scopes at registration time.
 */
export interface ToolHandlerContext {
  user: User;
  team: Team;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolHandlerContext
) => Promise<unknown>;

export interface AgentToolDef extends AgentTool {
  handler: ToolHandler;
}

const SearchDocumentsArgs = z.object({
  query: z.string().min(2).max(500),
  limit: z.number().int().min(1).max(20).optional(),
});

const ReadDocumentArgs = z.object({
  documentId: z.string().uuid().optional(),
  documentTitle: z.string().min(1).optional(),
}).refine((v) => v.documentId || v.documentTitle, {
  message: "Either documentId or documentTitle is required",
});

const EditDocumentArgs = z.object({
  documentId: z.string().uuid(),
  searchText: z.string().min(1).max(20000),
  replaceText: z.string().min(1).max(20000),
  replaceAll: z.boolean().optional().default(false),
});

const CreateDocumentArgs = z.object({
  title: z.string().min(1).max(200),
  text: z.string().min(1).max(20000),
  collectionId: z.string().uuid().optional(),
  publish: z.boolean().optional().default(false),
});

const ListCollectionsArgs = z.object({
  limit: z.number().int().min(1).max(50).optional().default(20),
});

const AddCommentArgs = z.object({
  documentId: z.string().uuid(),
  text: z.string().min(1).max(2000),
});

const SearchDocumentsDef: AgentToolDef = {
  name: "search_documents",
  description:
    "Search the workspace's documents using semantic + keyword hybrid search. Returns the top matching chunks with their document titles, headings, and snippets. Use this to find relevant context before answering questions or editing documents.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
      limit: { type: "number", description: "Max results (default 8)." },
    },
    required: ["query"],
  },
  handler: async (args, ctx) => {
    const { query, limit = 8 } = SearchDocumentsArgs.parse(args);
    const results = await searchChunks(query, ctx.team.id, limit);
    return results.map((r) => ({
      chunkId: r.chunkId,
      documentId: r.documentId,
      documentTitle: r.documentTitle,
      documentUrl: r.documentUrl,
      heading: r.heading,
      content: r.content,
      score: r.score,
    }));
  },
};

const ReadDocumentDef: AgentToolDef = {
  name: "read_document",
  description:
    "Read the full text of a document. Identify it by documentId (UUID) or documentTitle (matched loosely). Returns the document's title, full markdown text, and metadata.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "UUID of the document." },
      documentTitle: {
        type: "string",
        description: "Title of the document (loose match).",
      },
    },
  },
  handler: async (args, ctx) => {
    const { documentId, documentTitle } = ReadDocumentArgs.parse(args);
    let doc;
    if (documentId) {
      doc = await Document.findOne({
        where: { id: documentId, teamId: ctx.team.id },
        paranoid: false,
      });
    } else if (documentTitle) {
      doc = await Document.findOne({
        where: {
          teamId: ctx.team.id,
          title: { [Op.iLike]: `%${documentTitle}%` },
        },
        paranoid: false,
        order: [["updatedAt", "DESC"]],
      });
    }
    if (!doc) {
      return { error: "Document not found" };
    }
    return {
      id: doc.id,
      title: doc.title,
      text: doc.text ?? "",
      url: `/doc/${doc.id}`,
      updatedAt: doc.updatedAt,
      publishedAt: doc.publishedAt,
    };
  },
};

const EditDocumentDef: AgentToolDef = {
  name: "edit_document",
  description:
    "Edit an existing document by replacing a piece of text. The search text must appear exactly in the document; the agent should re-read the document first if unsure. Returns the diff for the user to accept or reject. NEVER apply edits the user did not request.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "UUID of the document." },
      searchText: {
        type: "string",
        description: "Exact substring to find in the document.",
      },
      replaceText: {
        type: "string",
        description: "Replacement text.",
      },
      replaceAll: {
        type: "boolean",
        description: "Replace every occurrence (default false; first only).",
      },
    },
    required: ["documentId", "searchText", "replaceText"],
  },
  handler: async (args, ctx) => {
    const { documentId, searchText, replaceText, replaceAll } =
      EditDocumentArgs.parse(args);
    const doc = await Document.findOne({
      where: { id: documentId, teamId: ctx.team.id },
      paranoid: false,
    });
    if (!doc) {
      return { error: "Document not found" };
    }
    const text = doc.text ?? "";
    if (!text.includes(searchText)) {
      return {
        error:
          "searchText not found in document. Re-read the document and try again with an exact substring.",
      };
    }
    const updated = replaceAll
      ? text.split(searchText).join(replaceText)
      : text.replace(searchText, replaceText);
    // Persist the new text. We do NOT auto-apply to the live editor — the
    // user must accept the diff in the UI. The change is staged in `text`
    // and the agent's UI will show it as a pending edit.
    doc.text = updated;
    await doc.save({ silent: true });
    return {
      ok: true,
      documentId: doc.id,
      url: `/doc/${doc.id}`,
      diffSummary: `Replaced ${searchText.length} chars with ${replaceText.length} chars`,
      newText: updated,
    };
  },
};

const CreateDocumentDef: AgentToolDef = {
  name: "create_document",
  description:
    "Create a new document. Provide the title, full markdown text, and optionally a collectionId to place it in. If publish is true, the document is immediately published (otherwise it stays as a draft).",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      text: { type: "string" },
      collectionId: { type: "string" },
      publish: { type: "boolean" },
    },
    required: ["title", "text"],
  },
  handler: async (args, ctx) => {
    const { title, text, collectionId, publish = false } =
      CreateDocumentArgs.parse(args);
    const doc = await Document.create({
      teamId: ctx.team.id,
      createdById: ctx.user.id,
      title,
      text,
      content: { type: "doc", content: [] },
      state: Buffer.from([]),
      publishedAt: publish ? new Date() : null,
      collectionId: collectionId ?? null,
      lastModifiedById: ctx.user.id,
    });
    return {
      ok: true,
      documentId: doc.id,
      url: `/doc/${doc.id}`,
      title: doc.title,
      published: !!doc.publishedAt,
    };
  },
};

const ListCollectionsDef: AgentToolDef = {
  name: "list_collections",
  description:
    "List collections in this workspace. Useful before creating documents so the agent can pick a sensible collectionId.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number" },
    },
  },
  handler: async (args, ctx) => {
    const { limit = 20 } = ListCollectionsArgs.parse(args);
    const cols = await Collection.findAll({
      where: { teamId: ctx.team.id, deletedAt: { [Op.eq]: null } },
      attributes: ["id", "name", "description", "color", "icon"],
      limit,
      order: [["name", "ASC"]],
    });
    return cols.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
    }));
  },
};

const AddCommentDef: AgentToolDef = {
  name: "add_comment",
  description:
    "Post a comment on a document. Use this to leave the user a note, an explanation, or a question. Returns the new comment id.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string" },
      text: { type: "string" },
    },
    required: ["documentId", "text"],
  },
  handler: async (args, ctx) => {
    const { documentId, text } = AddCommentArgs.parse(args);
    const doc = await Document.findOne({
      where: { id: documentId, teamId: ctx.team.id },
      paranoid: false,
    });
    if (!doc) {
      return { error: "Document not found" };
    }
    const c = await Comment.create({
      documentId: doc.id,
      createdById: ctx.user.id,
      data: { type: "doc", text },
    });
    return { ok: true, commentId: c.id, url: `/doc/${doc.id}#comment-${c.id}` };
  },
};

/**
 * All agent tools, in the order they're shown to the model. Keep this list
 * small and high-signal — large lists confuse small models.
 */
export const AGENT_TOOLS: AgentToolDef[] = [
  SearchDocumentsDef,
  ReadDocumentDef,
  EditDocumentDef,
  CreateDocumentDef,
  ListCollectionsDef,
  AddCommentDef,
];

/**
 * Public-facing list of tool definitions, in the shape the LLM expects
 * (no handler, just name/description/parameters).
 */
export function getAgentToolDefinitions(): AgentTool[] {
  return AGENT_TOOLS.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

export function findToolHandler(name: string): ToolHandler | undefined {
  return AGENT_TOOLS.find((t) => t.name === name)?.handler;
}
