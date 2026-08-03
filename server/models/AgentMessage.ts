import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  Table,
  DataType,
  ForeignKey,
  BelongsTo,
  Index,
} from "sequelize-typescript";
import AgentSession from "./AgentSession";
import IdModel from "./base/IdModel";

/**
 * A single message in an agent session. Stores the role and a JSON `parts`
 * blob matching the Vercel AI SDK `UIMessage` shape used by the frontend
 * (`{ type: "text" | "tool_call" | "tool_result" }`). The agent writes
 * messages at the end of a run; reads concatenate them in `createdAt`
 * order.
 */
@Table({ tableName: "agent_messages", modelName: "agentMessage" })
class AgentMessage extends IdModel<
  InferAttributes<AgentMessage>,
  Partial<InferCreationAttributes<AgentMessage>>
> {
  @ForeignKey(() => AgentSession)
  @Index
  @Column(DataType.UUID)
  sessionId: string;

  @BelongsTo(() => AgentSession)
  session: AgentSession;

  /** "user" or "assistant". */
  @Column(DataType.STRING)
  role: "user" | "assistant";

  /** JSON blob of parts: text, tool_call, tool_result. Stored as text. */
  @Column(DataType.TEXT)
  parts: string;

  /**
   * Total input+output tokens consumed by the underlying LLM for this
   * message, when the assistant produced it. Null for user messages.
   */
  @Column(DataType.INTEGER)
  inputTokens: number | null;

  @Column(DataType.INTEGER)
  outputTokens: number | null;
}

export default AgentMessage;
