import { Op } from "sequelize";
import Logger from "@server/logging/Logger";
import { Document, EmbeddingKey } from "@server/models";
import { CronTask, TaskInterval } from "./base/CronTask";
import EmbedDocumentTask from "./EmbedDocumentTask";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Nightly cron task that re-embeds recently-changed documents for every
 * team that has at least one valid Mistral key. Uses a clock-gate because
 * Outline's cron only supports interval scheduling (no fixed times): we run
 * daily and self-skip outside the 01:00-01:30 UTC window.
 *
 * Documents are re-embedded with `force: false` so unchanged docs are
 * detected by `contentHash` and skipped — only the docs that were updated
 * since the last run actually hit Mistral.
 */
export default class ReindexTeamEmbeddingsTask extends CronTask {
  public get cron() {
    return {
      interval: TaskInterval.Day,
    };
  }

  public async perform() {
    // Clock gate: only run between 01:00 and 01:30 UTC. The cron framework
    // runs us every 24h starting ~5s after server boot, so without this
    // gate we'd index at whatever time the server happened to start.
    const hour = new Date().getUTCHours();
    if (hour !== 1) {
      Logger.debug(
        "embedding-cron",
        `Skipping — current hour is ${hour}, want 1`
      );
      return;
    }

    Logger.info("embedding-cron", "Starting nightly reindex");

    const teamsWithKeys = await EmbeddingKey.findAll({
      attributes: ["teamId"],
      where: { isValid: true },
      group: ["teamId"],
    });

    const cutoff = new Date(Date.now() - ONE_WEEK_MS);

    for (const { teamId } of teamsWithKeys) {
      // Find published, non-deleted, recently-changed documents.
      const docs = await Document.findAll({
        where: {
          teamId,
          publishedAt: { [Op.ne]: null },
          deletedAt: { [Op.eq]: null },
          updatedAt: { [Op.gte]: cutoff },
        },
        attributes: ["id"],
        limit: 1000,
      });
      Logger.info(
        "embedding-cron",
        `Team ${teamId}: scheduling ${docs.length} reindex tasks`
      );
      for (const doc of docs) {
        await new EmbedDocumentTask().schedule({
          documentId: doc.id,
          force: false,
        });
      }
    }
  }
}
