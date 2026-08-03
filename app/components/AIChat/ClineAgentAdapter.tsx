import { observer } from "mobx-react";
import { SparklesIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  ConversationViewport,
  Message,
  MessageContent,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  ToolActivity,
  ToolActivityCode,
  ToolActivityContent,
  ToolActivityDetails,
  ToolActivityTrigger,
} from "./ClineChat";
import type { AgentApprovalAction } from "./ClineChat";
import { AgentApprovalCard } from "./ClineChat";
import type { AgentMessage, AgentMessagePart } from "~/stores/AgentStore";
import useStores from "~/hooks/useStores";

/**
 * Bridge between Outline's `AgentStore` and Cline's UI primitives.
 *
 * Cline ships the full chat surface: `<Conversation>` (viewport + scroll
 * button), `<Message>` (role-based alignment + bubble), `<Reasoning>` and
 * `<ToolActivity>` (collapsible with built-in running spinner, status
 * badge, +N/-M diff counts), and `<AgentApprovalCard>` (HITL with
 * approve/reject buttons and built-in pending spinner). We just translate
 * our message model into those primitives — no duplicated styling.
 */
export interface ClineAgentChatProps {
  messages: AgentMessage[];
  isRunning: boolean;
  /**
   * Optional hooks for the auto-scroll-to-bottom button. Not currently
   * consumed by `ClineAgentChat` itself (Cline's `<Conversation>` primitive
   * handles its own scroll state) — kept for forward compatibility with
   * a future host that wants to drive the scroll from outside.
   */
  onScrollToBottom?: () => void;
  isAtBottom?: boolean;
  hasStarted: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onAcceptToolCall?: (toolCallId: string) => void;
  onRejectToolCall?: (toolCallId: string) => void;
  requiresApproval?: (toolName: string) => boolean;
}

type ToolCallRow = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  /** When the agent proposed a structured edit (HITL). */
  pendingEdit?: {
    documentId: string;
    searchText: string;
    replaceText: string;
  };
  /** Cached user decision once Accept/Reject has been clicked. */
  decision?: "accepted" | "rejected";
  /** Approval state surfaced in `<AgentApprovalCard>`. */
  approval?: AgentApprovalAction;
};

/** Flatten a message's `parts` into a single ordered list of text + tool
 * rows so we can render them inside a single `<Message>`. */
function flatten(
  parts: AgentMessagePart[]
): Array<{ kind: "text"; text: string } | { kind: "tool"; row: ToolCallRow }> {
  const rows: Array<
    { kind: "text"; text: string } | { kind: "tool"; row: ToolCallRow }
  > = [];
  const toolById = new Map<string, ToolCallRow>();

  for (const part of parts) {
    if (part.type === "text") {
      // Coalesce consecutive text into one chunk to keep the DOM small.
      const last = rows[rows.length - 1];
      if (last && last.kind === "text") {
        last.text += part.text;
      } else {
        rows.push({ kind: "text", text: part.text });
      }
    } else if (part.type === "tool_call") {
      const row: ToolCallRow = {
        id: part.id,
        name: part.name,
        args: (part.args as Record<string, unknown>) ?? {},
      };
      toolById.set(part.id, row);
      rows.push({ kind: "tool", row });
    } else if (part.type === "tool_result") {
      const row = toolById.get(part.id);
      if (row) {
        row.result = part.result;
        row.isError = part.is_error;
      }
    }
  }

  // Backfill pendingEdit + decision from the live store.
  for (const row of toolById.values()) {
    if (row.result && typeof row.result === "object") {
      const r = row.result as {
        pending?: boolean;
        documentId?: string;
        searchText?: string;
        replaceText?: string;
      };
      if (r.pending && r.documentId) {
        row.pendingEdit = {
          documentId: r.documentId,
          searchText: r.searchText ?? "",
          replaceText: r.replaceText ?? "",
        };
      }
    }
  }

  return rows;
}

const ToolLabels: Record<string, string> = {
  search_documents: "Searching the workspace",
  read_document: "Reading document",
  edit_document: "Editing document",
  create_document: "Creating document",
  list_collections: "Listing collections",
  add_comment: "Posting comment",
  list_documents: "Listing documents",
  get_document_outline: "Reading outline",
  get_revisions: "Reading revisions",
  list_users: "Finding users",
  search_users: "Finding users",
  update_title: "Updating title",
  set_publish_state: "Setting publish state",
  move_document: "Moving document",
  archive_document: "Archiving document",
  duplicate_document: "Duplicating document",
  create_collection: "Creating collection",
  bulk_update: "Bulk updating",
  bulk_move: "Bulk moving",
  submit_plan: "Submitting plan",
};

function statusFor(row: ToolCallRow, isRunning: boolean) {
  if (row.isError) {
    return "error" as const;
  }
  if (row.result !== undefined) {
    return "success" as const;
  }
  return isRunning ? ("running" as const) : ("pending" as const);
}

export const ClineAgentChat = observer(function ClineAgentChat(
  props: ClineAgentChatProps
) {
  const {
    messages,
    isRunning,
    hasStarted,
    emptyTitle,
    emptyDescription,
    onAcceptToolCall,
    onRejectToolCall,
    requiresApproval,
  } = props;
  const { t } = useTranslation();

  if (!hasStarted) {
    return (
      <ConversationEmptyState
        icon={<SparklesIcon size={28} color="currentColor" />}
        title={emptyTitle ?? t("What can I help with?")}
        description={
          emptyDescription ??
          t(
            "I can search your workspace, read and edit documents, create new ones, and post comments."
          )
        }
      />
    );
  }

  return (
    <Conversation>
      <ConversationViewport>
        <ConversationContent>
          {messages.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              isRunning={isRunning}
              onAccept={onAcceptToolCall}
              onReject={onRejectToolCall}
              requiresApproval={requiresApproval}
            />
          ))}
        </ConversationContent>
      </ConversationViewport>
      <ConversationScrollButton />
    </Conversation>
  );
});

const MessageView = observer(function MessageView({
  message,
  isRunning,
  onAccept,
  onReject,
  requiresApproval,
}: {
  message: AgentMessage;
  isRunning: boolean;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
  requiresApproval?: (name: string) => boolean;
}) {
  const { t } = useTranslation();
  const { agent } = useStores();
  const flat = flatten(message.parts).map((entry, i) => {
    if (entry.kind === "text") {
      return (
        <MessageContent key={`t-${i}`}>
          <p>{entry.text}</p>
        </MessageContent>
      );
    }
    const row = entry.row;
    const tc = agent.pendingToolCalls.get(row.id);
    if (tc?.pendingEdit && !row.pendingEdit) {
      row.pendingEdit = tc.pendingEdit;
    }
    if (tc?.decision && !row.decision) {
      row.decision = tc.decision;
    }
    const status = statusFor(row, isRunning);
    const label = ToolLabels[row.name] ?? row.name;
    const needsApproval =
      status === "success" &&
      !row.isError &&
      requiresApproval?.(row.name) === true &&
      row.pendingEdit !== undefined &&
      !row.decision;

    return (
      <React.Fragment key={`tc-${row.id}`}>
        <ToolActivity defaultOpen>
          <ToolActivityTrigger
            label={label}
            status={status}
            showDisclosureIcon
          />
          <ToolActivityContent>
            <ToolActivityDetails>
              <div>Arguments</div>
              <ToolActivityCode>
                {JSON.stringify(row.args, null, 2)}
              </ToolActivityCode>
              {row.result !== undefined ? (
                <>
                  <div>Result</div>
                  <ToolActivityCode>
                    {JSON.stringify(row.result, null, 2)}
                  </ToolActivityCode>
                </>
              ) : null}
            </ToolActivityDetails>
          </ToolActivityContent>
        </ToolActivity>
        {needsApproval && onAccept && onReject ? (
          <AgentApprovalCard
            title={t("Apply edit?")}
            description={t(
              "The agent wants to replace the matched text in the document."
            )}
            detail={
              row.pendingEdit
                ? `− ${row.pendingEdit.searchText}\n+ ${row.pendingEdit.replaceText}`
                : undefined
            }
            onApprove={() => {
              row.approval = "approve";
              onAccept(row.id);
            }}
            onReject={() => {
              row.approval = "reject";
              onReject(row.id);
            }}
            responding={row.approval}
          />
        ) : null}
      </React.Fragment>
    );
  });

  return (
    <Message from={message.role === "user" ? "user" : "assistant"}>
      {flat}
    </Message>
  );
});

/**
 * Optional: render the agent's reasoning/thinking text inside Cline's
 * `<Reasoning>` primitive. Wire to a `thinking_delta` event in the store
 * to display a streaming label, or pass `defaultOpen` for completed
 * reasoning blocks.
 */
export const AgentReasoning = observer(function AgentReasoning({
  text,
  isStreaming,
  defaultOpen,
}: {
  text: string;
  isStreaming?: boolean;
  defaultOpen?: boolean;
}) {
  if (!text) {
    return null;
  }
  return (
    <Reasoning
      isStreaming={isStreaming}
      defaultOpen={defaultOpen ?? isStreaming ?? false}
    >
      <ReasoningTrigger />
      <ReasoningContent>
        <p>{text}</p>
      </ReasoningContent>
    </Reasoning>
  );
});
