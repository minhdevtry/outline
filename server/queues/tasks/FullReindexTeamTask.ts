import { Op } from "sequelize";
import Logger from "@server/logging/Logger";
import { Document } from "@server/models";
import { BaseTask, TaskPriority } from "./base/BaseTask";
import EmbedDocumentTask from "./EmbedDocumentTask";

export interface FullReindexTeamProps {
  teamId: string;
  /**
   * If true, re-embed every chunk of every document (ignores contentHash
   * diff). Used by the admin "Reindex all" button.
   */
  force: boolean;
}

const BATCH_SIZE = 50;

/**
 * Manually-triggered full reindex of a team. Iterates every published,
 * non-deleted document and schedules an `EmbedDocumentTask` per document
 * with the requested `force` flag. Throttled implicitly by the embedding
 * client's token bucket; the background priority keeps interactive
 * traffic unaffected.
 */
export default class FullReindexTeamTask extends BaseTask<FullReindexTeamProps> {
  public get options() {
    return {
      priority: TaskPriority.Background,
      attempts: 1,
    };
  }

  public async perform(props: FullReindexTeamProps) {
    const { teamId, force } = props;
    Logger.info("embedding", `Full reindex for team ${teamId} (force=${force})`);

    let offset = 0;
    let total = 0;
    while (true) {
      const docs = await Document.findAll({
        where: {
          teamId,
          publishedAt: { [Op.ne]: null },
          deletedAt: { [Op.eq]: null },
        },
        attributes: ["id"],
        limit: BATCH_SIZE,
        offset,
        order: [["updatedAt", "ASC"]],
      });
      if (docs.length === 0) {
        break;
      }
      for (const doc of docs) {
        await new EmbedDocumentTask().schedule({
          documentId: doc.id,
          force,
        });
        total++;
      }
      offset += docs.length;
      if (docs.length < BATCH_SIZE) {
        break;
      }
    }
    Logger.info("embedding", `Full reindex scheduled ${total} documents`);
  }
}
