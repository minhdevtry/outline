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
 * A single embedded chunk of a document, used by the RAG hybrid search.
 * The `embedding` column is a `vector(1024)` from pgvector and is null until
 * the embedding task has run. The `contentHash` lets the task diff against
 * the previous set of chunks cheaply — only re-embed chunks whose text has
 * actually changed.
 */
@Table({ tableName: "document_chunks", modelName: "documentChunk" })
class DocumentChunk extends IdModel<
  InferAttributes<DocumentChunk>,
  Partial<InferCreationAttributes<DocumentChunk>>
> {
  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Team)
  team: Team;

  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;

  @BelongsTo(() => Document)
  document: Document;

  @Column(DataType.INTEGER)
  chunkIndex: number;

  @Column(DataType.TEXT)
  content: string;

  @Column(DataType.CHAR(64))
  contentHash: string;

  @Column(DataType.TEXT)
  heading: string | null;

  @Column(DataType.INTEGER)
  startOffset: number;

  @Column(DataType.INTEGER)
  endOffset: number;

  /**
   * Raw pgvector column. The ORM treats it as a string of "[x,y,z,...]" — we
   * never read or mutate it from app code; only the embedding task writes
   * it via raw SQL.
   */
  @Column({ type: "vector(1024)", field: "embedding" })
  embedding?: unknown;

  @Column(DataType.STRING(64))
  model: string;
}

export default DocumentChunk;
