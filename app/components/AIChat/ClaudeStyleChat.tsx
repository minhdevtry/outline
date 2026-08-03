import { observer } from "mobx-react";
import {
  SparklesIcon,
  CopyIcon,
  CheckmarkIcon,
  RestoreIcon,
  TrashIcon,
  ArrowIcon,
  CloseIcon,
  CaretDownIcon,
  PlusIcon,
  DocumentIcon,
  SearchIcon,
  EditIcon,
  CollectionIcon,
  InfoIcon,
} from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled, { keyframes, useTheme } from "styled-components";
import { toast } from "sonner";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";
import { useCurrentDocument } from "~/hooks/useCurrentDocument";
import { PlanCard } from "./PlanCard";

/* -------------------------------------------------------------------------- */
/*  Helpers: Tool Call View & Simple Markdown Formatting                       */
/* -------------------------------------------------------------------------- */

const ToolLabels: Record<string, string> = {
  search_documents: "Tìm kiếm không gian làm việc",
  read_document: "Đọc nội dung tài liệu",
  edit_document: "Đang chỉnh sửa tài liệu",
  create_document: "Tạo tài liệu mới",
  list_collections: "Liệt kê bộ sưu tập",
  add_comment: "Thêm bình luận",
  list_documents: "Danh sách tài liệu",
  get_document_outline: "Đọc dàn ý tài liệu",
  get_revisions: "Xem lịch sử chỉnh sửa",
  list_users: "Tìm thành viên",
  search_users: "Tìm thành viên",
  update_title: "Cập nhật tiêu đề",
  set_publish_state: "Cập nhật trạng thái xuất bản",
  move_document: "Di chuyển tài liệu",
  archive_document: "Lưu trữ tài liệu",
  duplicate_document: "Nhân bản tài liệu",
  create_collection: "Tạo bộ sưu tập",
  bulk_update: "Cập nhật hàng loạt",
  bulk_move: "Di chuyển hàng loạt",
  submit_plan: "Gửi kế hoạch thực thi",
};

const ToolCallView = observer(function ToolCallView({
  toolCallId,
  name,
}: {
  toolCallId: string;
  name: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { agent } = useStores();
  const [open, setOpen] = React.useState(false);

  const tc = agent.pendingToolCalls.get(toolCallId);
  const baseLabel = ToolLabels[name] ?? name;
  const isPending = agent.streaming && !tc?.result && !tc?.isError;

  let subDetail = "";
  if (tc?.args) {
    if (typeof tc.args.query === "string") {
      subDetail = `"${tc.args.query}"`;
    } else if (typeof tc.args.documentId === "string") {
      subDetail = `#${tc.args.documentId.slice(0, 8)}`;
    } else if (typeof tc.args.text === "string") {
      subDetail = `"${tc.args.text.slice(0, 24)}..."`;
    }
  }

  const renderIcon = () => {
    if (name.includes("search")) return <SearchIcon size={13} color={theme.textSecondary} />;
    if (name.includes("edit")) return <EditIcon size={13} color={theme.accent} />;
    if (name.includes("collection")) return <CollectionIcon size={13} color={theme.textSecondary} />;
    return <DocumentIcon size={13} color={theme.textSecondary} />;
  };

  return (
    <ToolContainer $isPending={isPending}>
      <ToolHeader type="button" onClick={() => setOpen(!open)}>
        <ToolTitle>
          <ToolIconPill>{renderIcon()}</ToolIconPill>
          <ToolTextGroup>
            <MainLabel>{baseLabel}</MainLabel>
            {subDetail && <SubDetailText>{subDetail}</SubDetailText>}
          </ToolTextGroup>
        </ToolTitle>
        <RightStatusGroup>
          <ToolStatusBadge $isError={tc?.isError} $isPending={isPending}>
            {tc?.isError ? (
              t("Lỗi")
            ) : isPending ? (
              <PendingPill>
                <SpinnerDot />
                <span>{t("Đang gọi…")}</span>
              </PendingPill>
            ) : (
              <SuccessPill>
                <CheckmarkIcon size={12} color="#10b981" />
                <span>{t("Xong")}</span>
              </SuccessPill>
            )}
          </ToolStatusBadge>
          <CaretDownIcon
            size={12}
            color={theme.textTertiary}
            style={{
              transform: open ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform 150ms ease",
            }}
          />
        </RightStatusGroup>
      </ToolHeader>

      {open && (
        <ToolDetails>
          {tc?.args && Object.keys(tc.args).length > 0 && (
            <ToolSection>
              <ToolSectionTitle>{t("Tham số đầu vào")}</ToolSectionTitle>
              <CodeBlock>
                <code>{JSON.stringify(tc.args, null, 2)}</code>
              </CodeBlock>
            </ToolSection>
          )}
          {tc?.result !== undefined && (
            <ToolSection>
              <ToolSectionTitle>{t("Kết quả công cụ")}</ToolSectionTitle>
              <CodeBlock>
                <code>{JSON.stringify(tc.result, null, 2)}</code>
              </CodeBlock>
            </ToolSection>
          )}
        </ToolDetails>
      )}

      {tc?.pendingEdit && (
        <PendingEditBox>
          <PendingEditHeader>{t("Đề xuất chỉnh sửa tài liệu")}</PendingEditHeader>
          <DiffContainer>
            <DiffLine $type="remove">- {tc.pendingEdit.searchText}</DiffLine>
            <DiffLine $type="add">+ {tc.pendingEdit.replaceText}</DiffLine>
          </DiffContainer>

          {tc.decision === "accepted" ? (
            <DecisionBadge $type="accepted">
              <CheckmarkIcon size={12} color="#10b981" />
              <span>{t("Đã áp dụng vào tài liệu")}</span>
            </DecisionBadge>
          ) : tc.decision === "rejected" ? (
            <DecisionBadge $type="rejected">
              <span>{t("Đã từ chối chỉnh sửa")}</span>
            </DecisionBadge>
          ) : (
            <EditActions>
              <RejectBtn
                type="button"
                onClick={() => agent.rejectEdit(toolCallId)}
              >
                {t("Từ chối")}
              </RejectBtn>
              <AcceptBtn
                type="button"
                onClick={() => agent.acceptEdit(toolCallId)}
              >
                {t("Chấp nhận & Áp dụng")}
              </AcceptBtn>
            </EditActions>
          )}
        </PendingEditBox>
      )}
    </ToolContainer>
  );
});

function FormattedMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  lines.forEach((line, index) => {
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <CodeBlock key={`code-${index}`}>
            <code>{codeBuffer.join("\n")}</code>
          </CodeBlock>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      return;
    }

    if (line.startsWith("### ")) {
      elements.push(<Heading3 key={index}>{line.slice(4)}</Heading3>);
    } else if (line.startsWith("## ")) {
      elements.push(<Heading2 key={index}>{line.slice(3)}</Heading2>);
    } else if (line.startsWith("# ")) {
      elements.push(<Heading1 key={index}>{line.slice(2)}</Heading1>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <ListItem key={index}>
          <ListBullet>•</ListBullet>
          <span>{formatInline(line.slice(2))}</span>
        </ListItem>
      );
    } else if (line.trim().length > 0) {
      elements.push(<Paragraph key={index}>{formatInline(line)}</Paragraph>);
    } else {
      elements.push(<Spacer key={index} />);
    }
  });

  if (inCodeBlock && codeBuffer.length > 0) {
    elements.push(
      <CodeBlock key="code-end">
        <code>{codeBuffer.join("\n")}</code>
      </CodeBlock>
    );
  }

  return <>{elements}</>;
}

function formatInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <InlineCode key={match.index}>{token.slice(1, -1)}</InlineCode>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts;
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                            */
/* -------------------------------------------------------------------------- */

export const ClaudeStyleChat = observer(function ClaudeStyleChat() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { agent } = useStores();
  const { id: currentDocumentId } = useCurrentDocument();

  const [input, setInput] = React.useState("");
  const [selectedModel, setSelectedModel] = React.useState("MiniMax-M3");
  const [showModelPicker, setShowModelPicker] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Auto scroll to bottom during streaming or message update
  React.useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [agent.messages.length, agent.streamingText, agent.errorMessage]);

  const handleSubmit = React.useCallback(
    (customText?: string) => {
      const textToSend = (customText ?? input).trim();
      if (!textToSend || agent.streaming) {
        return;
      }
      setInput("");
      void agent.send(textToSend, {
        currentDocumentId: currentDocumentId ?? undefined,
        model: selectedModel,
      });
    },
    [agent, currentDocumentId, input, selectedModel]
  );

  const handleCopy = React.useCallback(
    (id: string, text: string) => {
      void navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success(t("Copied to clipboard"));
      setTimeout(() => setCopiedId(null), 2000);
    },
    [t]
  );

  const handleRetry = React.useCallback(() => {
    const lastUserMsg = [...agent.messages]
      .reverse()
      .find((m) => m.role === "user");
    if (lastUserMsg) {
      const text = lastUserMsg.parts
        .map((p) => ("text" in p ? p.text : ""))
        .join("");
      handleSubmit(text);
    }
  }, [agent.messages, handleSubmit]);

  const promptSuggestions = [
    {
      title: t("Tóm tắt tài liệu"),
      subtitle: t("Tóm tắt nội dung chính và kết quả quan trọng"),
      query: t("Hãy tóm tắt các điểm chính của tài liệu này giúp tôi."),
    },
    {
      title: t("Soạn thảo nội dung mới"),
      subtitle: t("Viết tiếp dàn ý hoặc nội dung kế tiếp"),
      query: t("Hãy đề xuất dàn ý mở rộng cho chủ đề này."),
    },
    {
      title: t("Review & Sửa lỗi"),
      subtitle: t("Kiểm tra ngữ pháp, văn phong và tính chính xác"),
      query: t("Hãy review văn phong và ngữ pháp của tài liệu này giúp tôi."),
    },
    {
      title: t("Tra cứu tri thức"),
      subtitle: t("Tìm kiếm thông tin liên quan từ kho dữ liệu"),
      query: t(
        "Tìm kiếm các tài liệu liên quan đến chủ đề này trong workspace."
      ),
    },
  ];

  return (
    <Container>
      {/* Header Bar */}
      <HeaderBar>
        <HeaderLeft>
          <ModelDropdownContainer>
            <ModelTriggerButton
              type="button"
              onClick={() => setShowModelPicker(!showModelPicker)}
            >
              <SparklesIcon size={14} color="#c96442" />
              <span>{selectedModel}</span>
              <CaretDownIcon size={12} color={theme.textTertiary} />
            </ModelTriggerButton>

            {showModelPicker && (
              <ModelMenu>
                {["MiniMax-M3", "Claude 3.5 Sonnet", "GPT-4o"].map((m) => (
                  <ModelMenuItem
                    key={m}
                    $active={m === selectedModel}
                    onClick={() => {
                      setSelectedModel(m);
                      setShowModelPicker(false);
                    }}
                  >
                    <span>{m}</span>
                    {m === selectedModel && (
                      <CheckmarkIcon size={14} color={theme.accent} />
                    )}
                  </ModelMenuItem>
                ))}
              </ModelMenu>
            )}
          </ModelDropdownContainer>

          <ModePill
            type="button"
            $active={agent.planMode === "plan"}
            onClick={() =>
              agent.setPlanMode(agent.planMode === "plan" ? "off" : "plan")
            }
          >
            {agent.planMode === "plan" ? t("Plan") : t("Act")}
          </ModePill>
        </HeaderLeft>

        <HeaderActions>
          {agent.messages.length > 0 && (
            <IconButton
              type="button"
              title={t("New Chat")}
              onClick={() => agent.reset()}
            >
              <TrashIcon size={16} color={theme.textTertiary} />
            </IconButton>
          )}
        </HeaderActions>
      </HeaderBar>

      {/* Main Messages Viewport */}
      <Viewport ref={viewportRef}>
        {agent.messages.length === 0 ? (
          <EmptyStateContainer>
            <SparkleIconWrapper>
              <SparklesIcon size={32} color="#c96442" />
            </SparkleIconWrapper>
            <EmptyTitle>{t("How can I help you today?")}</EmptyTitle>
            <EmptySubtitle>
              {t("Ask anything or choose a quick prompt to get started.")}
            </EmptySubtitle>

            <SuggestionsGrid>
              {promptSuggestions.map((item, idx) => (
                <SuggestionCard
                  key={idx}
                  type="button"
                  onClick={() => handleSubmit(item.query)}
                >
                  <SuggestionTitle>{item.title}</SuggestionTitle>
                  <SuggestionSubtitle>{item.subtitle}</SuggestionSubtitle>
                </SuggestionCard>
              ))}
            </SuggestionsGrid>
          </EmptyStateContainer>
        ) : (
          <MessageList>
            {agent.messages.map((msg) => {
              const hasContent = msg.parts.length > 0;
              if (!hasContent && msg.role === "assistant" && !agent.streaming) {
                return null;
              }

              const textContent = msg.parts
                .filter((p) => p.type === "text")
                .map((p) => (p as { type: "text"; text: string }).text)
                .join("");

              return (
                <MessageItem key={msg.id} $role={msg.role}>
                  {msg.role === "assistant" && (
                    <AvatarBadge>
                      <SparklesIcon size={16} color="#c96442" />
                    </AvatarBadge>
                  )}

                  <MessageBubble $role={msg.role}>
                    {msg.parts.length === 0 &&
                      msg.role === "assistant" &&
                      agent.streaming && (
                        <ThinkingIndicator>
                          <SparklesIcon size={14} color="#c96442" />
                          <span>{t("AI đang xử lý...")}</span>
                        </ThinkingIndicator>
                      )}
                    {msg.parts.map((part, pIdx) => {
                      if (part.type === "text") {
                        return (
                          <FormattedMarkdown
                            key={`p-${pIdx}`}
                            content={part.text}
                          />
                        );
                      }
                      if (part.type === "tool_call") {
                        return (
                          <ToolCallView
                            key={`tc-${part.id}`}
                            toolCallId={part.id}
                            name={part.name}
                          />
                        );
                      }
                      return null;
                    })}

                    {msg.role === "assistant" && agent.streaming && (
                      <CursorIndicator />
                    )}

                    {msg.role === "assistant" &&
                      textContent &&
                      !agent.streaming && (
                        <MessageActionBar>
                          <ActionIconButton
                            type="button"
                            title={t("Copy")}
                            onClick={() => handleCopy(msg.id, textContent)}
                          >
                            {copiedId === msg.id ? (
                              <CheckmarkIcon size={14} color="#10b981" />
                            ) : (
                              <CopyIcon size={14} color={theme.textTertiary} />
                            )}
                          </ActionIconButton>
                          <ActionIconButton
                            type="button"
                            title={t("Retry")}
                            onClick={handleRetry}
                          >
                            <RestoreIcon size={14} color={theme.textTertiary} />
                          </ActionIconButton>
                        </MessageActionBar>
                      )}
                  </MessageBubble>
                </MessageItem>
              );
            })}

            {agent.pendingPlan && (
              <PlanCard
                plan={agent.pendingPlan}
                onDecision={(decision, reason) => {
                  agent.decidePlan(
                    decision === "approve"
                      ? "approved"
                      : decision === "reject"
                        ? "rejected"
                        : "edit_requested",
                    reason
                  );
                }}
              />
            )}

            {agent.errorMessage && (
              <ErrorBanner>
                <ErrorText>{agent.errorMessage}</ErrorText>
                <RetryButton type="button" onClick={handleRetry}>
                  {t("Retry")}
                </RetryButton>
              </ErrorBanner>
            )}
          </MessageList>
        )}
      </Viewport>

      {/* Footer & Composer Input */}
      <FooterContainer>
        <ComposerCard>
          <ComposerTextArea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              agent.streaming
                ? t("Generating answer...")
                : t("Ask Claude or MiniMax anything...")
            }
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          <ComposerBottomRow>
            <AttachButton type="button" title={t("Add attachment")}>
              <PlusIcon size={16} color={theme.textTertiary} />
            </AttachButton>

            <ComposerActions>
              {agent.streaming ? (
                <StopButton
                  type="button"
                  title={t("Stop generating")}
                  onClick={() => agent.cancel()}
                >
                  <StopSquare />
                </StopButton>
              ) : (
                <SendButton
                  type="button"
                  disabled={!input.trim()}
                  onClick={() => handleSubmit()}
                >
                  <SendIconWrapper>
                    <ArrowIcon size={14} color="#fff" />
                  </SendIconWrapper>
                </SendButton>
              )}
            </ComposerActions>
          </ComposerBottomRow>
        </ComposerCard>

        <DisclaimerText>
          {t("AI can make mistakes. Please double-check responses.")}
        </DisclaimerText>
      </FooterContainer>
    </Container>
  );
});

/* -------------------------------------------------------------------------- */
/*  Styled Components                                                         */
/* -------------------------------------------------------------------------- */

const spinAnimation = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.3; transform: scale(0.95); }
  50% { opacity: 1; transform: scale(1.05); }
`;

const blink = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.text};
`;

const HeaderBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid ${(props) => props.theme.divider};
  flex-shrink: 0;
`;

const ModelDropdownContainer = styled.div`
  position: relative;
`;

const ModelTriggerButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  background: ${(props) =>
    props.theme.sidebarControlHoverBackground ||
    props.theme.backgroundSecondary};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
  cursor: var(--pointer);

  &:hover {
    background: ${(props) => props.theme.sidebarHoverBackground};
  }
`;

const ModelMenu = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  width: 180px;
  background: ${(props) => props.theme.menuBackground};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  box-shadow: ${(props) => props.theme.menuShadow};
  z-index: 100;
  padding: 4px;
`;

const ModelMenuItem = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: var(--pointer);
  background: ${(props) =>
    props.$active ? props.theme.menuItemSelected : "transparent"};
  color: ${(props) => props.theme.text};

  &:hover {
    background: ${(props) => props.theme.menuItemSelected};
  }
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const IconButton = styled.button`
  background: transparent;
  border: 0;
  padding: 4px;
  border-radius: 6px;
  cursor: var(--pointer);
  display: inline-flex;

  &:hover {
    background: ${(props) => props.theme.sidebarControlHoverBackground};
  }
`;

const Viewport = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
`;

const EmptyStateContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: auto 0;
  text-align: center;
`;

const SparkleIconWrapper = styled.div`
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: rgba(201, 100, 66, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  animation: ${pulse} 3s infinite ease-in-out;
`;

const EmptyTitle = styled.h3`
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 6px 0;
  color: ${(props) => props.theme.text};
`;

const EmptySubtitle = styled.p`
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  margin: 0 0 20px 0;
  max-width: 300px;
  line-height: 1.4;
`;

const SuggestionsGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  width: 100%;
  max-width: 340px;
`;

const SuggestionCard = styled.button`
  background: ${(props) => props.theme.backgroundSecondary};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 10px;
  padding: 10px 12px;
  text-align: left;
  cursor: var(--pointer);
  transition: all 150ms ease-in-out;

  &:hover {
    background: ${(props) => props.theme.sidebarHoverBackground};
    border-color: rgba(201, 100, 66, 0.4);
    transform: translateY(-1px);
  }
`;

const SuggestionTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
`;

const SuggestionSubtitle = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.textSecondary};
  margin-top: 2px;
`;

const MessageList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const MessageItem = styled.div<{ $role: "user" | "assistant" }>`
  display: flex;
  gap: 10px;
  justify-content: ${(props) =>
    props.$role === "user" ? "flex-end" : "flex-start"};
`;

const AvatarBadge = styled.div`
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: rgba(201, 100, 66, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
`;

const MessageBubble = styled.div<{ $role: "user" | "assistant" }>`
  max-width: 88%;
  padding: 8px 12px;
  border-radius: ${(props) =>
    props.$role === "user" ? "12px 12px 2px 12px" : "12px"};
  background: ${(props) =>
    props.$role === "user"
      ? props.theme.sidebarControlHoverBackground ||
        props.theme.backgroundSecondary
      : props.theme.background};
  border: 1px solid
    ${(props) => (props.$role === "user" ? props.theme.divider : "transparent")};
  color: ${(props) => props.theme.text};
  font-size: 13px;
  line-height: 1.55;
`;

const CursorIndicator = styled.span`
  display: inline-block;
  width: 6px;
  height: 13px;
  background: #c96442;
  margin-left: 4px;
  animation: ${blink} 1s infinite;
  vertical-align: middle;
`;

const MessageActionBar = styled.div`
  display: flex;
  gap: 4px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid ${(props) => props.theme.divider};
`;

const ActionIconButton = styled.button`
  background: transparent;
  border: 0;
  padding: 4px;
  border-radius: 4px;
  cursor: var(--pointer);
  display: inline-flex;

  &:hover {
    background: ${(props) => props.theme.sidebarControlHoverBackground};
  }
`;

const FooterContainer = styled.div`
  padding: 10px 14px 12px;
  border-top: 1px solid ${(props) => props.theme.divider};
  flex-shrink: 0;
  background: ${(props) => props.theme.background};
`;

const ComposerCard = styled.div`
  background: ${(props) => props.theme.backgroundSecondary};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 14px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: all 150ms ease-in-out;

  &:focus-within {
    border-color: rgba(201, 100, 66, 0.6);
    box-shadow: 0 0 0 3px rgba(201, 100, 66, 0.12);
  }
`;

const ComposerTextArea = styled.textarea`
  width: 100%;
  border: 0;
  background: transparent;
  color: ${(props) => props.theme.text};
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  resize: none;
  font-family: inherit;
  min-height: 48px;
  max-height: 220px;

  &::placeholder {
    color: ${(props) => props.theme.textTertiary};
  }
`;

const ComposerBottomRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const AttachButton = styled.button`
  background: transparent;
  border: 0;
  padding: 4px;
  border-radius: 6px;
  cursor: var(--pointer);
  display: inline-flex;

  &:hover {
    background: ${(props) => props.theme.sidebarHoverBackground};
  }
`;

const ComposerActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const SendButton = styled.button<{ disabled?: boolean }>`
  background: #c96442;
  border: 0;
  border-radius: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ${(props) => (props.disabled ? "default" : "var(--pointer)")};
  opacity: ${(props) => (props.disabled ? 0.4 : 1)};
  transition: opacity 150ms ease, background 150ms ease;

  &:hover:not(:disabled) {
    background: #b1573a;
  }
`;

const SendIconWrapper = styled.div`
  transform: rotate(-90deg);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const StopButton = styled.button`
  background: #ef4444;
  border: 0;
  border-radius: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: var(--pointer);

  &:hover {
    background: #dc2626;
  }
`;

const StopSquare = styled.div`
  width: 10px;
  height: 10px;
  background: #fff;
  border-radius: 2px;
`;

const DisclaimerText = styled.p`
  margin: 6px 0 0 0;
  text-align: center;
  font-size: 11px;
  color: ${(props) => props.theme.textTertiary};
`;

/* Markdown Elements */
const Heading1 = styled.h1`
  font-size: 15px;
  font-weight: 700;
  margin: 8px 0 4px 0;
`;

const Heading2 = styled.h2`
  font-size: 14px;
  font-weight: 600;
  margin: 6px 0 4px 0;
`;

const Heading3 = styled.h3`
  font-size: 13px;
  font-weight: 600;
  margin: 4px 0 2px 0;
`;

const Paragraph = styled.p`
  font-size: 13px;
  margin: 0 0 6px 0;
  &:last-child {
    margin-bottom: 0;
  }
`;

const ListItem = styled.div`
  display: flex;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 4px;
`;

const ListBullet = styled.span`
  color: ${(props) => props.theme.textTertiary};
`;

const Spacer = styled.div`
  height: 4px;
`;

const InlineCode = styled.code`
  background: ${(props) =>
    props.theme.sidebarControlHoverBackground ||
    props.theme.backgroundSecondary};
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
`;

const CodeBlock = styled.pre`
  background: ${(props) =>
    props.theme.sidebarControlHoverBackground ||
    props.theme.backgroundSecondary};
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  overflow-x: auto;
  margin: 6px 0;
  border: 1px solid ${(props) => props.theme.divider};
`;

/* AI Agent Tools, Diffs, Mode & Error Styled Components */
const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ModePill = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid ${(p) => (p.$active ? p.theme.accent : p.theme.divider)};
  background: ${(p) => (p.$active ? `${p.theme.accent}15` : "transparent")};
  color: ${(p) => (p.$active ? p.theme.accent : p.theme.textSecondary)};
  cursor: var(--pointer);

  &:hover {
    background: ${(p) =>
      p.$active
        ? `${p.theme.accent}25`
        : p.theme.sidebarControlHoverBackground};
  }
`;

const ToolContainer = styled.div<{ $isPending?: boolean }>`
  margin: 6px 0;
  border: 1px solid
    ${(props) => (props.$isPending ? props.theme.accent : props.theme.divider)};
  border-radius: 8px;
  background: ${(props) =>
    props.theme.backgroundSecondary ||
    props.theme.sidebarControlHoverBackground};
  overflow: hidden;
  transition: border-color 150ms ease, box-shadow 150ms ease;

  ${(props) =>
    props.$isPending &&
    `
    box-shadow: 0 0 0 2px ${props.theme.accent}15;
  `}
`;

const ToolHeader = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: transparent;
  border: 0;
  cursor: var(--pointer);

  &:hover {
    background: ${(props) => props.theme.sidebarControlHoverBackground};
  }
`;

const ToolTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: ${(props) => props.theme.text};
  overflow: hidden;
`;

const ToolTextGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
`;

const MainLabel = styled.span`
  font-weight: 500;
  color: ${(props) => props.theme.text};
`;

const SubDetailText = styled.span`
  font-size: 11px;
  color: ${(props) => props.theme.textTertiary};
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
`;

const ToolIconPill = styled.div`
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: ${(props) => props.theme.background};
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${(props) => props.theme.divider};
`;

const RightStatusGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ToolStatusBadge = styled.span<{
  $isError?: boolean;
  $isPending?: boolean;
}>`
  font-size: 11px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
`;

const PendingPill = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  color: ${(p) => p.theme.accent};
`;

const SuccessPill = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  color: #10b981;
`;

const SpinnerDot = styled.div`
  width: 12px;
  height: 12px;
  border: 2px solid ${(p) => `${p.theme.accent}30`};
  border-top-color: ${(p) => p.theme.accent};
  border-radius: 50%;
  animation: ${spinAnimation} 0.8s linear infinite;
`;

const ToolDetails = styled.div`
  padding: 8px 10px;
  border-top: 1px solid ${(props) => props.theme.divider};
  background: ${(props) => props.theme.background};
`;

const ToolSection = styled.div`
  margin-bottom: 6px;
  &:last-child {
    margin-bottom: 0;
  }
`;

const ToolSectionTitle = styled.div`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: ${(props) => props.theme.textTertiary};
  margin-bottom: 2px;
`;

const PendingEditBox = styled.div`
  padding: 10px;
  border-top: 1px solid ${(props) => props.theme.divider};
  background: ${(props) => props.theme.background};
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const PendingEditHeader = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
`;

const DiffContainer = styled.div`
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 11px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.divider};
`;

const DiffLine = styled.div<{ $type: "remove" | "add" }>`
  padding: 4px 8px;
  white-space: pre-wrap;
  word-break: break-word;
  background: ${(p) =>
    p.$type === "remove" ? `${p.theme.danger}15` : `${p.theme.success}15`};
  color: ${(p) => (p.$type === "remove" ? p.theme.danger : p.theme.success)};
`;

const DecisionBadge = styled.div<{ $type: "accepted" | "rejected" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 4px;
  background: ${(p) =>
    p.$type === "accepted" ? `${p.theme.success}20` : `${p.theme.danger}20`};
  color: ${(p) => (p.$type === "accepted" ? p.theme.success : p.theme.danger)};
  align-self: flex-start;
`;

const EditActions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
`;

const AcceptBtn = styled.button`
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid ${(p) => p.theme.success};
  background: ${(p) => p.theme.success};
  color: #fff;
  cursor: var(--pointer);

  &:hover {
    opacity: 0.9;
  }
`;

const RejectBtn = styled.button`
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid ${(p) => p.theme.divider};
  background: transparent;
  color: ${(p) => p.theme.textSecondary};
  cursor: var(--pointer);

  &:hover {
    background: ${(p) => p.theme.sidebarControlHoverBackground};
  }
`;

const ErrorBanner = styled.div`
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: ${(p) => `${p.theme.danger}15`};
  border: 1px solid ${(p) => `${p.theme.danger}30`};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const ErrorText = styled.div`
  font-size: 12px;
  color: ${(p) => p.theme.danger};
  flex: 1;
  word-break: break-word;
`;

const RetryButton = styled.button`
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid ${(p) => p.theme.danger};
  background: transparent;
  color: ${(p) => p.theme.danger};
  cursor: var(--pointer);

  &:hover {
    background: ${(p) => `${p.theme.danger}15`};
  }
`;

const ThinkingIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: ${(p) => p.theme.textTertiary};
  padding: 4px 0;
  font-style: italic;
`;
