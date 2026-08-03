import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  Table,
  DataType,
  ForeignKey,
  BelongsTo,
  Index,
  Length,
  Default,
} from "sequelize-typescript";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";

/**
 * A scheduled agent run — fires at a recurring interval (cron syntax) or
 * one-shot datetime. When due, the Bull `DispatchAgentSchedulesTask` reads
 * `nextRunAt` and enqueues an agent run with `prompt` as the user
 * message. The run creates a fresh `AgentSession` (or reuses the
 * `sessionId` if set) so the schedule is decoupled from any active
 * conversation.
 *
 * Mirrors the Cline `Schedule` model at
 * `packages/core/src/services/scheduling/schedule-store.ts`. Out of scope
 * for Phase 0-2; the UI lands in Phase 3.9.
 */
@Table({ tableName: "agent_schedules", modelName: "agentSchedule" })
class AgentSchedule extends IdModel<
  InferAttributes<AgentSchedule>,
  Partial<InferCreationAttributes<AgentSchedule>>
> {
  @ForeignKey(() => Team)
  @Index
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Team)
  team: Team;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  createdById: string;

  @BelongsTo(() => User)
  createdBy: User;

  @Length({ max: 100 })
  @Column(DataType.STRING)
  name: string;

  @Column(DataType.TEXT)
  description: string | null;

  /** Cron syntax (5-field: min hour dom mon dow) or one-shot ISO 8601
   * datetime. The dispatch task reads this via `cron-parser` or direct
   * `Date.parse()` depending on shape. */
  @Column(DataType.STRING(100))
  cron: string;

  /** Prompt that becomes the user message when the schedule fires. */
  @Column(DataType.TEXT)
  prompt: string;

  @Default(true)
  @Column(DataType.BOOLEAN)
  enabled: boolean;

  @Default("agent")
  @Length({ max: 32 })
  @Column(DataType.STRING)
  agentId: string;

  /** When the next invocation is due. The dispatcher polls rows where
   * `enabled && nextRunAt <= now()`. */
  @Index
  @Column(DataType.DATE)
  nextRunAt: Date;

  @Column(DataType.DATE)
  lastRunAt: Date | null;

  @Column(DataType.DATE)
  lastRunId: string | null;
}

export default AgentSchedule;
