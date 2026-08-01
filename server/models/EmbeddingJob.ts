import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  Table,
  DataType,
  ForeignKey,
  BelongsTo,
} from "sequelize-typescript";
import Document from "./Document";
import Team from "./Team";
import IdModel from "./base/IdModel";

/**
 * Per-document status of the RAG embedding pipeline. The UNIQUE(documentId)
 * constraint in the database guarantees at most one row per document; the
 * embedding task upserts.
 */
export type EmbeddingJobStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

@Table({ tableName: "embedding_jobs", modelName: "embeddingJob" })
class EmbeddingJob extends IdModel<
  InferAttributes<EmbeddingJob>,
  Partial<InferCreationAttributes<EmbeddingJob>>
> {
  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;

  @BelongsTo(() => Document)
  document: Document;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Team)
  team: Team;

  @Column(DataType.STRING)
  status: EmbeddingJobStatus;

  @Column(DataType.INTEGER)
  chunksCount: number;

  @Column(DataType.TEXT)
  errorMessage: string | null;

  @Column(DataType.DATE)
  startedAt: Date | null;

  @Column(DataType.DATE)
  completedAt: Date | null;
}

export default EmbeddingJob;
