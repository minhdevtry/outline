import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  Table,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
  Length,
} from "sequelize-typescript";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";

/**
 * A persisted conversation between a user and the AI agent. Owned by a
 * single user within a team. Messages are stored separately in
 * `AgentMessage` and joined on `sessionId`. The session is the unit of
 * history shown in the right-rail panel and on the (future) session list.
 */
@Table({ tableName: "agent_sessions", modelName: "agentSession" })
class AgentSession extends IdModel<
  InferAttributes<AgentSession>,
  Partial<InferCreationAttributes<AgentSession>>
> {
  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Team)
  team: Team;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string;

  @BelongsTo(() => User)
  user: User;

  @Length({ max: 200 })
  @Default("")
  @Column(DataType.STRING)
  title: string;

  /** The id of the document the user was viewing when the session was created. */
  @Column(DataType.UUID)
  contextDocumentId: string | null;

  @Column(DataType.DATE)
  lastMessageAt: Date | null;
}

export default AgentSession;
