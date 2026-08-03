import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  Table,
  DataType,
  ForeignKey,
  BelongsTo,
  Index,
  Default,
  Length,
} from "sequelize-typescript";
import AgentSession from "./AgentSession";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";

/**
 * A persistent fact the agent has learned about a user. Memories are
 * extracted after a conversation by an LLM call, then embedded with the
 * same `Xenova/multilingual-e5-small` model used by RAG so they can be
 * retrieved semantically on the next run.
 *
 * Memories are user-scoped: every row is owned by a single user inside a
 * team, scoped by `teamId` for cross-user safety. The `sourceSessionId`
 * links back to the conversation the memory was extracted from, so a user
 * can later inspect "where did the agent learn this?". The `archived` flag
 * marks stale facts the user can no longer see but we keep for audit.
 */
@Table({ tableName: "agent_memories", modelName: "agentMemory" })
class AgentMemory extends IdModel<
  InferAttributes<AgentMemory>,
  Partial<InferCreationAttributes<AgentMemory>>
> {
  @ForeignKey(() => Team)
  @Index
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Team)
  team: Team;

  @ForeignKey(() => User)
  @Index
  @Column(DataType.UUID)
  userId: string;

  @BelongsTo(() => User)
  user: User;

  /** Short category label, e.g. "preference", "context", "fact". Free-text so the
   * LLM extraction can invent its own taxonomy. */
  @Length({ max: 50 })
  @Default("fact")
  @Column(DataType.STRING)
  category: string;

  /** The fact as a single sentence, plain text. */
  @Column(DataType.TEXT)
  content: string;

  /** SHA-256 of `content`; used to dedupe near-duplicates during extraction. */
  @Column(DataType.CHAR(64))
  contentHash: string;

  /**
   * Raw pgvector column. The ORM treats it as a string of "[x,y,z,...]" —
   * we never read or mutate it from app code; only the embedding task
   * writes it via raw SQL.
   */
  @Column({ type: "vector(384)", field: "embedding" })
  embedding?: unknown;

  /** Name of the embedding model that produced `embedding`. */
  @Column(DataType.STRING(64))
  model: string;

  /** Confidence score 0..1 from the extractor LLM. */
  @Default(1)
  @Column(DataType.FLOAT)
  confidence: number;

  /** When the user has hidden this memory. Soft-delete flag. */
  @Default(false)
  @Column(DataType.BOOLEAN)
  archived: boolean;

  @ForeignKey(() => AgentSession)
  @Column(DataType.UUID)
  sourceSessionId: string | null;

  @BelongsTo(() => AgentSession)
  sourceSession: AgentSession;

  /** Last time retrieval returned this memory (recency signal). */
  @Column(DataType.DATE)
  lastUsedAt: Date | null;
}

export default AgentMemory;
