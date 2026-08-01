import { sequelize } from "@server/storage/database";
import Logger from "@server/logging/Logger";
import { DocumentChunk, EmbeddingJob } from "@server/models";
import BaseProcessor from "@server/queues/processors/BaseProcessor";
import EmbedDocumentTask from "@server/queues/tasks/EmbedDocumentTask";
import type { DocumentEvent, Event } from "@server/types";

/**
 * Keeps the RAG embedding table in sync with the document lifecycle.
 *
 * Subscribed events:
 *  - documents.create / .publish / .update.debounced → embed
 *  - documents.permanent_delete                      → wipe chunks + job row
 *  - documents.delete (soft)                         → no-op (chunks kept
 *                                                     for restored docs)
 */
export default class EmbeddingsProcessor extends BaseProcessor {
  static applicableEvents: Event["name"][] = [
    "documents.create",
    "documents.publish",
    "documents.update.debounced",
    "documents.permanent_delete",
  ];

  async shouldQueue(event: Event): Promise<boolean> {
    const de = event as DocumentEvent;
    if (!de.documentId || !de.teamId) {
      return false;
    }
    return true;
  }

  async perform(event: Event): Promise<void> {
    const de = event as DocumentEvent;
    if (!de.documentId) {
      return;
    }

    if (event.name === "documents.permanent_delete") {
      await this.handlePermanentDelete(de.documentId);
      return;
    }

    await new EmbedDocumentTask().schedule({
      documentId: de.documentId,
      force: false,
    });
  }

  private async handlePermanentDelete(documentId: string) {
    Logger.info("embedding", `Wiping chunks for permanently-deleted ${documentId}`);
    await sequelize.transaction(async (tx) => {
      await DocumentChunk.destroy({ where: { documentId }, transaction: tx });
      await EmbeddingJob.destroy({ where: { documentId }, transaction: tx });
    });
  }
}
