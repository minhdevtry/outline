import "./Cline/agent-chat.css";
import "./Cline/agent-approval-card.css";
import "./Cline/cline-theme-bridge.css";

/**
 * Re-export the Cline UI primitives so consumers don't have to know about
 * the `Cline/` subdirectory. These are the components pulled directly from
 * `/home/lucas/Documents/code/.ref/cline/sdk/packages/ui/components/` —
 * the actual Cline source, with Outline's React 18 + styled-components
 * runtime around them.
 *
 * CSS files above apply Cline's defaults and then our
 * `cline-theme-bridge.css` re-points Cline's `--foreground`,
 * `--primary`, etc. to Outline's `theme.*` palette.
 */
export {
  Conversation,
  ConversationViewport,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
  ToolActivity,
  ToolActivityTrigger,
  ToolActivityContent,
  ToolActivityDetails,
  ToolActivityCode,
} from "./Cline/agent-chat";

export { AgentApprovalCard } from "./Cline/agent-approval-card";

export type {
  AgentApprovalAction,
  AgentApprovalCardProps,
} from "./Cline/agent-approval-card";
