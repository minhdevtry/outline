import { observer } from "mobx-react";
import {
  SparklesIcon,
  CloseIcon,
  ArrowIcon,
  PlusIcon,
} from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled, { keyframes, useTheme } from "styled-components";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";
import { AgentMessage } from "~/stores/AgentStore";

const pulsate = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const StopSquare = () => (
  <svg width={14} height={14} viewBox="0 0 14 14" fill="currentColor">
    <rect x="2" y="2" width="10" height="10" rx="1.5" />
  </svg>
);

/**
 * Right-rail AI Agent panel. The agent is a small autonomous loop that
 * calls tools (search, read, edit, create, list, comment) on the user's
 * behalf. It is opened from the kbar ("Ask Outline AI") and from the
 * search page's AI panel button.
 *
 * Visually inspired by Claude Code's secondary sidebar: vertical scroll,
 * right-aligned, ~380 px wide on desktop, full-screen drawer on mobile.
 */
function Agent() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { agent } = useStores();
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new content.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [agent.messages.length, agent.streamingText, agent.pendingToolCalls.size]);

  if (!agent.panelOpen) {
    return null;
  }

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || agent.streaming) {
      return;
    }
    void agent.send(input);
    setInput("");
  };

  return (
    <Aside>
      <Header>
        <Title>
          <SparklesIcon color={theme.accent} size={18} />
          <strong>{t("AI Agent")}</strong>
          {agent.streaming && <StatusDot aria-label={t("Thinking")} />}
        </Title>
        <HeaderActions>
          <IconButton
            type="button"
            onClick={() => agent.reset()}
            title={t("New conversation")}
            aria-label={t("New conversation")}
          >
            <PlusIcon size={16} color={theme.textTertiary} />
          </IconButton>
          <IconButton
            type="button"
            onClick={() => agent.closePanel()}
            title={t("Close")}
            aria-label={t("Close")}
          >
            <CloseIcon size={16} color={theme.textTertiary} />
          </IconButton>
        </HeaderActions>
      </Header>

      <Scroll ref={scrollRef}>
        {!agent.hasStarted ? (
          <Empty>
            <EmptyIcon>
              <SparklesIcon size={32} color={theme.accent} />
            </EmptyIcon>
            <EmptyTitle>{t("What can I help with?")}</EmptyTitle>
            <EmptyHint>
              {t(
                "I can search your workspace, read and edit documents, create new ones, and post comments. Try asking: \"Tóm tắt các doc về YouTube\" or \"Tạo doc mới về <chủ đề>\"."
              )}
            </EmptyHint>
          </Empty>
        ) : (
          agent.messages.map((m: AgentMessage) => <Message key={m.id} message={m} />)
        )}
        {agent.errorMessage && (
          <ErrorNote>{agent.errorMessage}</ErrorNote>
        )}
      </Scroll>

      <Footer>
        <ComposerForm onSubmit={handleSend}>
          <ComposerInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              agent.streaming
                ? t("Agent is running... press Stop to cancel")
                : t("Ask the agent anything...")
            }
            disabled={agent.streaming}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />
          {agent.streaming ? (
            <ComposerButton
              type="button"
              $accent={theme.textSecondary}
              onClick={() => agent.cancel()}
              title={t("Stop")}
            >
              <StopSquare />
            </ComposerButton>
          ) : (
            <ComposerButton
              type="submit"
              $accent={theme.accent}
              disabled={!input.trim()}
              title={t("Send")}
            >
              <ArrowIcon size={14} />
            </ComposerButton>
          )}
        </ComposerForm>
        <FooterHint>{t("Enter to send, Shift+Enter for newline")}</FooterHint>
      </Footer>
    </Aside>
  );
}

const Message = observer(function Message({
  message,
}: {
  message: AgentMessage;
}) {
  const theme = useTheme();
  const isUser = message.role === "user";

  return (
    <Bubble $user={isUser}>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <TextPart key={i} $user={isUser}>
              {part.text}
            </TextPart>
          );
        }
        if (part.type === "tool_call") {
          return (
            <ToolCallBubble key={i} name={part.name} />
          );
        }
        return null;
      })}
    </Bubble>
  );
});

const ToolCallBubble = observer(function ToolCallBubble({
  name,
}: {
  name: string;
}) {
  const { t } = useTranslation();
  const label =
    ({
      search_documents: t("Searching the workspace"),
      read_document: t("Reading document"),
      edit_document: t("Editing document"),
      create_document: t("Creating document"),
      list_collections: t("Listing collections"),
      add_comment: t("Posting comment"),
    } as Record<string, string>)[name] ?? `${t("Running")} ${name}`;
  return (
    <ToolCallCard>
      <span>{label}</span>
      <ToolSpinner>...</ToolSpinner>
    </ToolCallCard>
  );
});

const Aside = styled.aside`
  position: fixed;
  inset: 0 0 0 auto;
  width: 380px;
  max-width: 90vw;
  background: ${s("background")};
  border-left: 1px solid ${s("divider")};
  z-index: 100;
  display: flex;
  flex-direction: column;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.06);

  @media (max-width: 720px) {
    width: 100vw;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid ${s("divider")};
`;

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: ${s("text")};
`;

const StatusDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${(p) => p.theme.accent};
  margin-left: 2px;
  animation: ${pulsate} 1.2s infinite;
`;

const HeaderActions = styled.div`
  display: flex;
  gap: 4px;
`;

const IconButton = styled.button`
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: ${s("sidebarControlHoverBackground")};
  }
`;

const Scroll = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Bubble = styled.div<{ $user: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 90%;
  align-self: ${(p) => (p.$user ? "flex-end" : "flex-start")};
`;

const TextPart = styled.div<{ $user: boolean }>`
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  color: ${(p) => s(p.$user ? "text" : "text")};
  background: ${(p) => (p.$user ? s("backgroundSecondary") : "transparent")};
  padding: 8px 12px;
  border-radius: 8px;
`;

const ToolCallCard = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: ${s("textSecondary")};
  background: ${s("backgroundSecondary")};
  padding: 6px 10px;
  border-radius: 6px;
  align-self: flex-start;
  max-width: 100%;
`;

const ToolSpinner = styled.span`
  color: ${(p) => p.theme.accent};
  letter-spacing: 1px;
  font-weight: 600;
  animation: ${pulsate} 1.2s infinite;
`;

const Empty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  gap: 8px;
  flex: 1;
`;

const EmptyIcon = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: ${(p) => `${p.theme.accent}10`};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
`;

const EmptyTitle = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: ${s("text")};
`;

const EmptyHint = styled.div`
  font-size: 13px;
  color: ${s("textTertiary")};
  line-height: 1.5;
  max-width: 280px;
`;

const ErrorNote = styled.div`
  font-size: 13px;
  color: ${s("danger")};
  padding: 8px 10px;
  background: ${s("danger")}10;
  border-radius: 6px;
`;

const Footer = styled.div`
  border-top: 1px solid ${s("divider")};
  padding: 10px 12px 12px;
`;

const ComposerForm = styled.form`
  display: flex;
  align-items: end;
  gap: 6px;
  background: ${s("inputBackground")};
  border: 1px solid ${s("inputBorder")};
  border-radius: 8px;
  padding: 6px;
  transition: border-color 100ms ease-in-out;

  &:focus-within {
    border-color: ${s("inputBorderFocused")};
  }
`;

const ComposerInput = styled.textarea`
  flex: 1;
  background: transparent;
  border: 0;
  outline: 0;
  color: ${s("text")};
  font-size: 14px;
  font-family: inherit;
  padding: 4px 6px;
  resize: none;
  max-height: 120px;

  &::placeholder {
    color: ${s("placeholder")};
  }
`;

const ComposerButton = styled.button<{ $accent: string }>`
  background: transparent;
  border: 0;
  color: ${(p) => (p.disabled ? s("textTertiary") : p.$accent)};
  cursor: ${(p) => (p.disabled ? "default" : "pointer")};
  padding: 6px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: ${s("sidebarControlHoverBackground")};
  }
`;

const FooterHint = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
  text-align: center;
  margin-top: 6px;
`;

export default observer(Agent);
