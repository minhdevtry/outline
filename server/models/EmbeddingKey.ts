import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  Table,
  DataType,
  ForeignKey,
  BelongsTo,
} from "sequelize-typescript";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";

/**
 * A Mistral API key belonging to a team. The plaintext key is stored
 * encrypted (AES-256-GCM) in `encryptedKey`; only `prefix`, `last4`, and
 * metadata are ever returned by the API. The key pool is round-robined by
 * the embedding client to stay within the free tier's 1 req/s limit.
 */
@Table({ tableName: "embedding_keys", modelName: "embeddingKey" })
class EmbeddingKey extends IdModel<
  InferAttributes<EmbeddingKey>,
  Partial<InferCreationAttributes<EmbeddingKey>>
> {
  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Team)
  team: Team;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  createdById: string | null;

  @BelongsTo(() => User, "createdById")
  createdBy: User | null;

  @Column(DataType.STRING(120))
  label: string;

  @Column(DataType.STRING(16))
  prefix: string;

  @Column(DataType.STRING(4))
  last4: string;

  /** AES-256-GCM ciphertext (IV + tag + ciphertext). Plaintext never returned. */
  @Column(DataType.BLOB)
  encryptedKey: Buffer;

  @Column(DataType.BOOLEAN)
  isValid: boolean;

  @Column(DataType.DATE)
  lastUsedAt: Date | null;

  @Column(DataType.DATE)
  lastErrorAt: Date | null;

  @Column(DataType.TEXT)
  lastError: string | null;

  @Column(DataType.BIGINT)
  requestCount: number;
}

export default EmbeddingKey;
