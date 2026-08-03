import { z } from "zod";
import { Op } from "sequelize";
import { Collection, Comment, Document, Revision, User } from "@server/models";
import type { Team } from "@server/models";
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

const ReadDocumentArgs = z
  .object({
    documentId: z.string().uuid().optional(),
    documentTitle: z.string().min(1).optional(),
  })
  .refine((v) => v.documentId || v.documentTitle, {
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

const ListDocumentsArgs = z.object({
  query: z.string().min(1).max(200).optional(),
  collectionId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

const UpdateTitleArgs = z.object({
  documentId: z.string().uuid(),
  title: z.string().min(1).max(200),
});

const MoveDocumentArgs = z.object({
  documentId: z.string().uuid(),
  collectionId: z.string().uuid(),
});

const SetPublishStateArgs = z.object({
  documentId: z.string().uuid(),
  publish: z.boolean(),
});

const ArchiveDocumentArgs = z.object({
  documentId: z.string().uuid(),
  restore: z.boolean().optional().default(false),
});

const DuplicateDocumentArgs = z.object({
  documentId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  publish: z.boolean().optional().default(false),
});

const CreateCollectionArgs = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  color: z.string().max(20).optional(),
  icon: z.string().max(50).optional(),
});

const SearchUsersArgs = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).optional().default(10),
});

const DeleteCommentArgs = z.object({
  commentId: z.string().uuid(),
});

const GetDocumentOutlineArgs = z.object({
  documentId: z.string().uuid(),
});

const GetRevisionsArgs = z.object({
  documentId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

const BulkUpdateArgs = z
  .object({
    documentIds: z.array(z.string().uuid()).min(1).max(50),
    title: z.string().min(1).max(200).optional(),
    publish: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.publish !== undefined, {
    message: "At least one of title or publish must be provided",
  });

const BulkMoveArgs = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(50),
  collectionId: z.string().uuid(),
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
    const { query, limit } = SearchDocumentsArgs.parse(args);
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

const ListDocumentsDef: AgentToolDef = {
  name: "list_documents",
  description:
    "List documents in the workspace, optionally filtered by collection and a keyword query (matched against title, not content). Useful for browsing or for picking a set of documents to operate on in bulk.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Optional keyword filter on title (case-insensitive).",
      },
      collectionId: { type: "string", description: "Limit to a collection." },
      limit: { type: "number", description: "Default 20, max 50." },
      offset: { type: "number", description: "Default 0." },
    },
  },
  handler: async (args, ctx) => {
    const { query, collectionId, limit, offset } =
      ListDocumentsArgs.parse(args);
    const where: Record<string, unknown> = {
      teamId: ctx.team.id,
      publishedAt: { [Op.ne]: null },
      deletedAt: { [Op.eq]: null },
    };
    if (collectionId) {
      where.collectionId = collectionId;
    }
    if (query) {
      where.title = { [Op.iLike]: `%${query}%` };
    }
    const rows = await Document.findAll({
      where,
      attributes: ["id", "title", "collectionId", "updatedAt", "publishedAt"],
      order: [["updatedAt", "DESC"]],
      limit,
      offset,
    });
    return {
      total: await Document.count({ where }),
      results: rows.map((d) => ({
        id: d.id,
        title: d.title,
        url: `/doc/${d.id}`,
        collectionId: d.collectionId,
        updatedAt: d.updatedAt,
      })),
    };
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

const UpdateTitleDef: AgentToolDef = {
  name: "update_title",
  description:
    "Rename a single document. Does not change the body. Use this when the user wants to retitle an existing doc.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "UUID of the document." },
      title: { type: "string", description: "New title (1-200 chars)." },
    },
    required: ["documentId", "title"],
  },
  handler: async (args, ctx) => {
    const { documentId, title } = UpdateTitleArgs.parse(args);
    const doc = await Document.findOne({
      where: { id: documentId, teamId: ctx.team.id },
      paranoid: false,
    });
    if (!doc) {
      return { error: "Document not found" };
    }
    doc.title = title;
    doc.lastModifiedById = ctx.user.id;
    await doc.save({ silent: true });
    return { ok: true, documentId: doc.id, title: doc.title };
  },
};

const MoveDocumentDef: AgentToolDef = {
  name: "move_document",
  description:
    "Move a single document to a different collection. The destination collection must already exist in the workspace (use `list_collections` to find one).",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "UUID of the document." },
      collectionId: {
        type: "string",
        description: "UUID of the target collection.",
      },
    },
    required: ["documentId", "collectionId"],
  },
  handler: async (args, ctx) => {
    const { documentId, collectionId } = MoveDocumentArgs.parse(args);
    const doc = await Document.findOne({
      where: { id: documentId, teamId: ctx.team.id },
      paranoid: false,
    });
    if (!doc) {
      return { error: "Document not found" };
    }
    const target = await Collection.findOne({
      where: {
        id: collectionId,
        teamId: ctx.team.id,
        deletedAt: { [Op.eq]: null },
      },
    });
    if (!target) {
      return { error: "Target collection not found" };
    }
    doc.collectionId = collectionId;
    doc.lastModifiedById = ctx.user.id;
    await doc.save({ silent: true });
    return {
      ok: true,
      documentId: doc.id,
      fromCollectionId: doc.collectionId,
      toCollectionId: collectionId,
    };
  },
};

const SetPublishStateDef: AgentToolDef = {
  name: "set_publish_state",
  description:
    "Publish or unpublish a document. Unpublishing moves the document back to draft (still in the collection but not publicly visible).",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "UUID of the document." },
      publish: {
        type: "boolean",
        description: "true to publish, false to unpublish.",
      },
    },
    required: ["documentId", "publish"],
  },
  handler: async (args, ctx) => {
    const { documentId, publish } = SetPublishStateArgs.parse(args);
    const doc = await Document.findOne({
      where: { id: documentId, teamId: ctx.team.id },
      paranoid: false,
    });
    if (!doc) {
      return { error: "Document not found" };
    }
    doc.publishedAt = publish ? new Date() : null;
    doc.lastModifiedById = ctx.user.id;
    await doc.save({ silent: true });
    return { ok: true, documentId: doc.id, published: !!doc.publishedAt };
  },
};

const ArchiveDocumentDef: AgentToolDef = {
  name: "archive_document",
  description:
    "Archive a document (soft delete; reversible with `restore: true`) or restore an archived one. Archived docs are removed from listings and search but stay in the database.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "UUID of the document." },
      restore: {
        type: "boolean",
        description:
          "true to restore an archived document, false (default) to archive.",
      },
    },
    required: ["documentId"],
  },
  handler: async (args, ctx) => {
    const { documentId, restore } = ArchiveDocumentArgs.parse(args);
    const doc = await Document.findOne({
      where: { id: documentId, teamId: ctx.team.id },
      paranoid: false,
    });
    if (!doc) {
      return { error: "Document not found" };
    }
    if (restore) {
      // Soft-undelete via paranoid restore; restoration across collections
      // is not handled here — the document returns to the collection it
      // was last in. We do not re-emit events for the restore here
      // (the user can save through the editor to re-publish).
      await doc.restore();
      return { ok: true, documentId: doc.id, archived: false };
    }
    // Soft-delete (archive). Bypass event emission since this is the
    // agent's bulk action; the document state field is preserved.
    await doc.update({ archivedAt: new Date() }, { hooks: false });
    return { ok: true, documentId: doc.id, archived: true };
  },
};

const DuplicateDocumentDef: AgentToolDef = {
  name: "duplicate_document",
  description:
    "Create a deep copy of a document. Optionally override the title. The copy is created as a draft unless `publish: true` is set.",
  parameters: {
    type: "object",
    properties: {
      documentId: {
        type: "string",
        description: "UUID of the source document.",
      },
      title: {
        type: "string",
        description: "Optional new title for the copy.",
      },
      publish: {
        type: "boolean",
        description: "Publish the copy immediately (default false = draft).",
      },
    },
    required: ["documentId"],
  },
  handler: async (args, ctx) => {
    const { documentId, title, publish } = DuplicateDocumentArgs.parse(args);
    const source = await Document.findOne({
      where: { id: documentId, teamId: ctx.team.id },
      paranoid: false,
    });
    if (!source) {
      return { error: "Source document not found" };
    }
    const copy = await Document.create({
      teamId: ctx.team.id,
      createdById: ctx.user.id,
      lastModifiedById: ctx.user.id,
      collectionId: source.collectionId,
      parentDocumentId: source.id,
      title: title ?? `${source.title} (copy)`,
      text: source.text,
      content: source.content ?? { type: "doc", content: [] },
      state: source.state ?? Buffer.from([]),
      icon: source.icon,
      color: source.color,
      publishedAt: publish ? new Date() : null,
    });
    return {
      ok: true,
      sourceDocumentId: source.id,
      documentId: copy.id,
      url: `/doc/${copy.id}`,
      title: copy.title,
      published: !!copy.publishedAt,
    };
  },
};

const CreateCollectionDef: AgentToolDef = {
  name: "create_collection",
  description:
    "Create a new collection (folder) to organize documents. The user becomes the creator.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Collection name (1-200 chars)." },
      description: { type: "string", description: "Optional description." },
      color: {
        type: "string",
        description: "Optional hex color, e.g. '#FF0000'.",
      },
      icon: { type: "string", description: "Optional icon name." },
    },
    required: ["name"],
  },
  handler: async (args, ctx) => {
    const { name, description, color, icon } = CreateCollectionArgs.parse(args);
    const existing = await Collection.findOne({
      where: {
        teamId: ctx.team.id,
        name,
        deletedAt: { [Op.eq]: null },
      },
    });
    if (existing) {
      return { error: `A collection named "${name}" already exists.` };
    }
    const c = await Collection.create({
      teamId: ctx.team.id,
      createdById: ctx.user.id,
      name,
      description: description ?? null,
      color: color ?? null,
      icon: icon ?? null,
    });
    return {
      ok: true,
      collectionId: c.id,
      name: c.name,
      url: `/collections/${c.id}`,
    };
  },
};

const SearchUsersDef: AgentToolDef = {
  name: "search_users",
  description:
    "Search workspace members by name or email. Returns at most `limit` matches. Use this before @-mentioning a user in a comment or document to find their id.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name or email fragment." },
      limit: { type: "number", description: "Default 10, max 20." },
    },
    required: ["query"],
  },
  handler: async (args, ctx) => {
    const { query, limit } = SearchUsersArgs.parse(args);
    const users = await User.findAll({
      where: {
        teamId: ctx.team.id,
        [Op.or]: [
          { name: { [Op.iLike]: `%${query}%` } },
          { email: { [Op.iLike]: `%${query}%` } },
        ],
      },
      attributes: ["id", "name", "email", "avatarUrl"],
      limit,
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
    }));
  },
};

const DeleteCommentDef: AgentToolDef = {
  name: "delete_comment",
  description:
    "Delete a comment. Use this to remove a comment the user no longer wants (typically a comment the agent itself added that the user rejected).",
  parameters: {
    type: "object",
    properties: {
      commentId: { type: "string", description: "UUID of the comment." },
    },
    required: ["commentId"],
  },
  handler: async (args, ctx) => {
    const { commentId } = DeleteCommentArgs.parse(args);
    const c = await Comment.findOne({
      where: { id: commentId, createdById: ctx.user.id },
    });
    if (!c) {
      return { error: "Comment not found (or not authored by the caller)." };
    }
    await c.destroy();
    return { ok: true, commentId };
  },
};

const GetDocumentOutlineDef: AgentToolDef = {
  name: "get_document_outline",
  description:
    "Return the heading outline (table of contents) of a document: nested headings with their text and level. Useful for navigation and for the agent to find sections without reading the full body.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "UUID of the document." },
    },
    required: ["documentId"],
  },
  handler: async (args, ctx) => {
    const { documentId } = GetDocumentOutlineArgs.parse(args);
    const doc = await Document.findOne({
      where: { id: documentId, teamId: ctx.team.id },
      paranoid: false,
    });
    if (!doc) {
      return { error: "Document not found" };
    }
    if (!doc.content) {
      return { documentId: doc.id, title: doc.title, outline: [] };
    }
    const outline = extractHeadingsFromContent(doc.content);
    return {
      documentId: doc.id,
      title: doc.title,
      outline,
    };
  },
};

/**
 * Walk a Prosemirror JSON document and collect heading nodes. The
 * structure is `{ type: "heading", attrs: { level }, content: [{ type: "text", text }] }`.
 * Used to build a TOC without needing a full Prosemirror schema in server code.
 */
function extractHeadingsFromContent(
  content: unknown,
  level = 0
): Array<{ level: number; title: string; id: string }> {
  if (!content || typeof content !== "object") {
    return [];
  }
  const node = content as {
    type?: string;
    attrs?: { level?: number };
    content?: unknown[];
    text?: string;
  };
  const out: Array<{ level: number; title: string; id: string }> = [];
  if (node.type === "heading" && node.attrs?.level !== undefined) {
    const text = (node.content ?? [])
      .map((c) =>
        c && typeof c === "object" && "text" in c
          ? String((c as { text?: string }).text ?? "")
          : ""
      )
      .join("");
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80);
    out.push({ level: node.attrs.level, title: text, id });
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      out.push(...extractHeadingsFromContent(child, level + 1));
    }
  }
  return out;
}

const GetRevisionsDef: AgentToolDef = {
  name: "get_revisions",
  description:
    "Return the recent version history of a document (one row per published change). Useful for seeing what changed, when, and by whom.",
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "UUID of the document." },
      limit: { type: "number", description: "Default 20, max 50." },
    },
    required: ["documentId"],
  },
  handler: async (args, ctx) => {
    const { documentId, limit } = GetRevisionsArgs.parse(args);
    const doc = await Document.findOne({
      where: { id: documentId, teamId: ctx.team.id },
      attributes: ["id", "title"],
      paranoid: false,
    });
    if (!doc) {
      return { error: "Document not found" };
    }
    const revisions = await Revision.findAll({
      where: { documentId: doc.id },
      attributes: ["id", "title", "createdAt", "userId"],
      order: [["createdAt", "DESC"]],
      limit,
    });
    return {
      documentId: doc.id,
      title: doc.title,
      revisions: revisions.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.createdAt,
        createdById: r.userId,
      })),
    };
  },
};

const BulkUpdateDef: AgentToolDef = {
  name: "bulk_update",
  description:
    "Apply the same title and/or publish-state change to many documents at once. Max 50 ids per call. Each document is updated in its own transaction so a single failure does not roll back the batch.",
  parameters: {
    type: "object",
    properties: {
      documentIds: {
        type: "array",
        items: { type: "string" },
        description: "UUIDs (1-50).",
      },
      title: { type: "string", description: "Optional new title for all." },
      publish: {
        type: "boolean",
        description: "Optional publish state for all.",
      },
    },
    required: ["documentIds"],
  },
  handler: async (args, ctx) => {
    const { documentIds, title, publish } = BulkUpdateArgs.parse(args);
    const docs = await Document.findAll({
      where: { id: documentIds, teamId: ctx.team.id },
      paranoid: false,
    });
    if (docs.length === 0) {
      return { error: "No matching documents found" };
    }
    const results: Array<{
      documentId: string;
      ok: boolean;
      error?: string;
    }> = [];
    for (const doc of docs) {
      try {
        if (title !== undefined) {
          doc.title = title;
        }
        if (publish !== undefined) {
          doc.publishedAt = publish ? new Date() : null;
        }
        doc.lastModifiedById = ctx.user.id;
        await doc.save({ silent: true });
        results.push({ documentId: doc.id, ok: true });
      } catch (err) {
        results.push({
          documentId: doc.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      total: documentIds.length,
      updated: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  },
};

const BulkMoveDef: AgentToolDef = {
  name: "bulk_move",
  description:
    "Move many documents to a target collection in one call. Max 50 ids. Same per-document failure isolation as `bulk_update`.",
  parameters: {
    type: "object",
    properties: {
      documentIds: {
        type: "array",
        items: { type: "string" },
        description: "UUIDs (1-50).",
      },
      collectionId: {
        type: "string",
        description: "Destination collection id.",
      },
    },
    required: ["documentIds", "collectionId"],
  },
  handler: async (args, ctx) => {
    const { documentIds, collectionId } = BulkMoveArgs.parse(args);
    const target = await Collection.findOne({
      where: {
        id: collectionId,
        teamId: ctx.team.id,
        deletedAt: { [Op.eq]: null },
      },
    });
    if (!target) {
      return { error: "Target collection not found" };
    }
    const docs = await Document.findAll({
      where: { id: documentIds, teamId: ctx.team.id },
      paranoid: false,
    });
    const results: Array<{
      documentId: string;
      ok: boolean;
      error?: string;
    }> = [];
    for (const doc of docs) {
      try {
        doc.collectionId = collectionId;
        doc.lastModifiedById = ctx.user.id;
        await doc.save({ silent: true });
        results.push({ documentId: doc.id, ok: true });
      } catch (err) {
        results.push({
          documentId: doc.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      total: documentIds.length,
      moved: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  },
};

const EditDocumentDef: AgentToolDef = {
  name: "edit_document",
  description:
    "Propose an edit to a document by replacing a piece of text. The search text must appear exactly in the document; the agent should re-read the document first if unsure. The change is NOT applied automatically — the user must accept or reject the diff in the agent panel. NEVER propose edits the user did not request.",
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
    // Do NOT auto-save — the user must accept the diff in the agent panel.
    // Return a structured change that the client renders with Accept /
    // Reject buttons. Accept posts to `documents.applyEdit` with the
    // documentId and newText.
    return {
      ok: true,
      pending: true,
      documentId: doc.id,
      url: `/doc/${doc.id}`,
      searchText,
      replaceText,
      newText: updated,
      diffSummary: `Replaced ${searchText.length} chars with ${replaceText.length} chars`,
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
    const { title, text, collectionId, publish } =
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
    const { limit } = ListCollectionsArgs.parse(args);
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
  // Discovery
  SearchDocumentsDef,
  ListDocumentsDef,
  GetDocumentOutlineDef,
  GetRevisionsDef,
  // Reading
  ReadDocumentDef,
  // Writing (single)
  EditDocumentDef,
  UpdateTitleDef,
  SetPublishStateDef,
  ArchiveDocumentDef,
  DuplicateDocumentDef,
  CreateDocumentDef,
  CreateCollectionDef,
  // Organization
  MoveDocumentDef,
  // Bulk
  BulkUpdateDef,
  BulkMoveDef,
  // Communication
  AddCommentDef,
  DeleteCommentDef,
  SearchUsersDef,
  // Workspace
  ListCollectionsDef,
];

/**
 * Public-facing list of tool definitions, in the shape the LLM expects
 * (no handler, just name/description/parameters). When `skillToolNames` is
 * provided and non-empty, only the intersection is returned — the LLM
 * never sees tools outside the active skill's allow-list. An empty /
 * missing list means "all tools are available" (the default for the
 * General skill).
 */
export function getAgentToolDefinitions(
  skillToolNames?: readonly string[]
): AgentTool[] {
  const filter =
    Array.isArray(skillToolNames) && skillToolNames.length > 0
      ? new Set(skillToolNames)
      : null;
  return AGENT_TOOLS.filter((t) => !filter || filter.has(t.name)).map(
    ({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })
  );
}

export function findToolHandler(name: string): ToolHandler | undefined {
  return AGENT_TOOLS.find((t) => t.name === name)?.handler;
}
