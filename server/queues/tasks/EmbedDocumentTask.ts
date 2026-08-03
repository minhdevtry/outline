import { sequelize } from "@server/storage/database";
import Logger from "@server/logging/Logger";
import { Document, DocumentChunk, Team } from "@server/models";
import { getMistralClient } from "@server/utils/embeddings/mistral";
import { chunkMarkdown, type Chunk } from "@server/utils/rag/chunker";
import { BaseTask, TaskPriority } from "./base/BaseTask";

export interface EmbedDocumentProps {
  documentId: string;
  /**
   * If true, re-embed all chunks regardless of `contentHash`. Used by the
   * full-team reindex endpoint; the nightly cron uses `false` so unchanged
   * docs are skipped.
   */
  force?: boolean;
}

/**
 * Re-embed a single document. Steps:
 *  1. Upsert `embedding_jobs` row → `in_progress`
 *  2. Chunk the doc's markdown text
 *  3. Diff against existing chunks by `contentHash` (unless `force`)
 *  4. Embed only the new/changed chunks
 *  5. Replace the document's chunks in a transaction
 *  6. Mark `embedding_jobs` → `completed` (or `failed` on error)
 *
 * Errors are logged + rethrown so Bull retries with exponential backoff. The
 * `embedding_jobs` row stays as `in_progress` between retries; the upsert
 * pattern collapses concurrent runs.
 */
export default class EmbedDocumentTask extends BaseTask<EmbedDocumentProps> {
  public get options() {
    return {
      priority: TaskPriority.Low,
      attempts: 3,
      backoff: { type: "exponential" as const, delay: 30_000 },
    };
  }

  public async perform(props: EmbedDocumentProps) {
    const { documentId, force = false } = props;
    Logger.info(
      "embedding",
      `Embedding document ${documentId} (force=${force})`
    );

    // Step 1: mark job in_progress
    await upsertJob(documentId, "in_progress", { startedAt: new Date() });

    // Step 2: load the document
    const document = await Document.findByPk(documentId, { paranoid: false });
    if (!document) {
      Logger.warn(`[embedding] Document ${documentId} not found, marking done`);
      await upsertJob(documentId, "completed", {
        chunksCount: 0,
        completedAt: new Date(),
      });
      return;
    }
    if (document.deletedAt || document.archivedAt) {
      // Don't (re-)index soft-deleted or archived docs. Chunks will be
      // wiped by the permanent_delete processor.
      Logger.info(
        "embedding",
        `Document ${documentId} soft-deleted/archived, skipping`
      );
      await upsertJob(documentId, "completed", {
        chunksCount: 0,
        completedAt: new Date(),
      });
      return;
    }
    if (!document.publishedAt) {
      // Drafts aren't searchable; skip them.
      await upsertJob(documentId, "completed", {
        chunksCount: 0,
        completedAt: new Date(),
      });
      return;
    }

    const team = await Team.findByPk(document.teamId);
    if (!team) {
      await upsertJob(documentId, "failed", {
        errorMessage: "Team not found",
        completedAt: new Date(),
      });
      return;
    }

    const chunkSize = team.embeddingChunkSize ?? 800;
    const chunkOverlap = team.embeddingChunkOverlap ?? 200;
    const model = team.embeddingModel ?? "mistral-embed";

    // Step 3: chunk
    const text = document.text ?? "";
    if (!text.trim()) {
      await wipeChunks(documentId);
      await upsertJob(documentId, "completed", {
        chunksCount: 0,
        completedAt: new Date(),
      });
      return;
    }
    const newChunks = chunkMarkdown(text, {
      maxTokens: chunkSize,
      overlapTokens: chunkOverlap,
    });

    // Step 4: diff
    const existing = await DocumentChunk.findAll({
      where: { documentId },
      attributes: ["id", "chunkIndex", "contentHash", "content", "heading"],
      order: [["chunkIndex", "ASC"]],
    });
    const existingByIndex = new Map(existing.map((c) => [c.chunkIndex, c]));
    const toEmbed: Chunk[] = [];
    const keepIds: string[] = [];
    const newByIndex = new Map(newChunks.map((c) => [c.chunkIndex, c]));
    for (const nc of newChunks) {
      const ex = existingByIndex.get(nc.chunkIndex);
      if (ex && !force && ex.contentHash === nc.contentHash) {
        keepIds.push(ex.id);
        continue;
      }
      toEmbed.push(nc);
    }
    const removedIds = existing
      .filter((e) => !newByIndex.has(e.chunkIndex))
      .map((e) => e.id);

    Logger.info(
      "embedding",
      `Document ${documentId}: ${newChunks.length} chunks, ` +
        `${toEmbed.length} to embed, ${keepIds.length} kept, ${removedIds.length} removed`
    );

    // Step 5: embed only the new/changed
    let embeddings: number[][] = [];
    if (toEmbed.length > 0) {
      try {
        const client = await getMistralClient(document.teamId);
        embeddings = await client.embed(
          toEmbed.map((c) => c.content),
          "passage"
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Logger.error(
          `Embed failed for ${documentId}: ${message}`,
          err instanceof Error ? err : new Error(message)
        );
        await upsertJob(documentId, "failed", {
          errorMessage: message,
          completedAt: new Date(),
        });
        throw err;
      }
    }

    // Step 6: write transaction
    await sequelize.transaction(async (tx) => {
      if (removedIds.length > 0) {
        await DocumentChunk.destroy({
          where: { id: removedIds },
          transaction: tx,
        });
      }
      for (let i = 0; i < toEmbed.length; i++) {
        const c = toEmbed[i];
        const embedding = embeddings[i];
        const vectorLiteral = `[${embedding.join(",")}]`;
        // We use raw SQL because Sequelize's typing for the vector column
        // is opaque; pgvector accepts the string literal of the array.
        await sequelize.query(
          `INSERT INTO document_chunks
             (id, "teamId", "documentId", "chunkIndex", content, "contentHash",
              heading, "startOffset", "endOffset", embedding, model, "createdAt", "updatedAt")
           VALUES
             (uuid_generate_v4(), :teamId, :documentId, :chunkIndex, :content, :contentHash,
              :heading, :startOffset, :endOffset, CAST(:embedding AS vector), :model, NOW(), NOW())`,
          {
            replacements: {
              teamId: document.teamId,
              documentId,
              chunkIndex: c.chunkIndex,
              content: c.content,
              contentHash: c.contentHash,
              heading: c.heading,
              startOffset: c.startOffset,
              endOffset: c.endOffset,
              embedding: vectorLiteral,
              model,
            },
            transaction: tx,
          }
        );
      }
    });

    // Step 7: mark completed
    await upsertJob(documentId, "completed", {
      chunksCount: newChunks.length,
      completedAt: new Date(),
    });
    Logger.info(
      "embedding",
      `Document ${documentId} embedded: ${newChunks.length} chunks total`
    );
  }
}

async function upsertJob(
  documentId: string,
  status: "pending" | "in_progress" | "completed" | "failed",
  extra: Partial<{
    startedAt: Date;
    completedAt: Date;
    errorMessage: string | null;
    chunksCount: number;
  }> = {}
) {
  // Look up teamId once so the upsert has the right foreign key.
  const document = await Document.findByPk(documentId, {
    attributes: ["id", "teamId"],
    paranoid: false,
  });
  if (!document) {
    return;
  }
  // Use raw SQL to avoid Sequelize validation friction on nullable optional
  // columns (the ORM upsert() builds a full row and rejects the optional
  // fields with the wrong default for our partial-update use case).
  const startedAt = extra.startedAt ?? null;
  const completedAt = extra.completedAt ?? null;
  const errorMessage = extra.errorMessage ?? null;
  const chunksCount = extra.chunksCount ?? 0;
  await sequelize.query(
    `INSERT INTO embedding_jobs
       (id, "documentId", "teamId", status, "chunksCount", "errorMessage",
        "startedAt", "completedAt", "createdAt", "updatedAt")
     VALUES
       (uuid_generate_v4(), :documentId, :teamId, :status, :chunksCount, :errorMessage,
        :startedAt, :completedAt, NOW(), NOW())
     ON CONFLICT ("documentId") DO UPDATE SET
       status = EXCLUDED.status,
       "chunksCount" = EXCLUDED."chunksCount",
       "errorMessage" = EXCLUDED."errorMessage",
       "startedAt" = EXCLUDED."startedAt",
       "completedAt" = EXCLUDED."completedAt",
       "updatedAt" = NOW()`,
    {
      replacements: {
        documentId,
        teamId: document.teamId,
        status,
        chunksCount,
        errorMessage,
        startedAt,
        completedAt,
      },
    }
  );
}

async function wipeChunks(documentId: string) {
  await DocumentChunk.destroy({ where: { documentId } });
}
