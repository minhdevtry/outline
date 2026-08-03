import { SparklesIcon } from "outline-icons";
import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  ConversationViewport,
  Message,
  MessageContent,
} from "./ClineChat";
import useCurrentTeam from "~/hooks/useCurrentTeam";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatStatus {
  enabled: boolean;
  configured: boolean;
  provider: "anthropic" | "openai" | null;
  model: string;
  baseUrl: string | null;
}

type ServerEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool-call"; id: string; name: string; inputDelta: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "finish"; reason: string }
  | { type: "error"; message: string };

/* -------------------------------------------------------------------------- */
/*  Status hook                                                               */
/* -------------------------------------------------------------------------- */

function useChatStatus(): ChatStatus | null {
  const team = useCurrentTeam();
  const [status, setStatus] = React.useState<ChatStatus | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/chat.status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          return;
        }
        const json = (await res.json()) as { data: ChatStatus };
        if (!cancelled) {
          setStatus(json.data);
        }
      } catch {
        /* status fetch is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [team?.id]);

  return status;
}

/* -------------------------------------------------------------------------- */
/*  Panel                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Minimal chat surface that talks to `/api/chat.send` and renders the
 * conversation using Cline's UI primitives. The original `ClineAgentAdapter`
 * bridged our custom MobX `AgentStore` into the same primitives; this panel
 * is the simpler alternative for teams that just want plain chat with no
 * tools, sessions, plan mode, or scheduler.
 *
 * Stream parsing is local — we just read `text/event-stream` chunks from
 * `fetch` and append deltas to the latest assistant message. Aborting the
 * fetch cancels the LLM request server-side via the SSE `close` event.
 */
export const ClineChatPanel = observer(function ClineChatPanel() {
  const { t } = useTranslation();
  const status = useChatStatus();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const hasStarted = messages.length > 0;

  const handleSend = React.useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text || streaming) {
        return;
      }

      const userMsg: ChatMessage = {
        id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: "user",
        content: text,
      };
      const assistantMsg: ChatMessage = {
        id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: "assistant",
        content: "",
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setError(null);
      setStreaming(true);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch("/api/chat.send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...messages, userMsg].map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "");
          throw new Error(
            errText
              ? `HTTP ${res.status}: ${errText.slice(0, 200)}`
              : `HTTP ${res.status}`
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamError: string | null = null;

        // Parse SSE: events separated by `\n\n`, each event is
        // `data: <json>` (or a comment line starting with `:`).
        const handleEvent = (raw: string) => {
          const dataLines = raw
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
          if (!dataLines) {
            return;
          }
          let ev: ServerEvent;
          try {
            ev = JSON.parse(dataLines) as ServerEvent;
          } catch {
            return;
          }
          if (ev.type === "text") {
            setMessages((prev) => {
              const next = prev.slice();
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  content: last.content + ev.delta,
                };
              }
              return next;
            });
          } else if (ev.type === "reasoning") {
            // Hidden for now; could surface inside Cline's <Reasoning>.
          } else if (ev.type === "error") {
            streamError = ev.message;
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let sep = buffer.indexOf("\n\n");
          while (sep !== -1) {
            const chunk = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            if (chunk.trim()) {
              handleEvent(chunk);
            }
            sep = buffer.indexOf("\n\n");
          }
        }
        // Flush any trailing data buffered without a final \n\n.
        if (buffer.trim()) {
          handleEvent(buffer);
        }
        if (streamError) {
          setError(streamError);
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          // User cancelled — leave the partial assistant content as-is.
        } else {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [input, messages, streaming]
  );

  const handleStop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleReset = React.useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    setError(null);
  }, []);

  if (status && !status.configured) {
    return (
      <Center>
        <StatusBox>
          <strong>{t("AI chat is not configured")}</strong>
          <p>
            {t(
              "Set ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY on the server, then restart."
            )}
          </p>
        </StatusBox>
      </Center>
    );
  }

  return (
    <Body>
      <Header>
        <StatusLine>
          {status?.provider === "anthropic" ? (
            <ProviderBadge>{t("Anthropic")}</ProviderBadge>
          ) : null}
          {status?.provider === "openai" ? (
            <ProviderBadge>{t("OpenAI")}</ProviderBadge>
          ) : null}
          <ProviderModel>{status?.model ?? "—"}</ProviderModel>
        </StatusLine>
        <ResetButton
          type="button"
          onClick={handleReset}
          title={t("New conversation")}
          disabled={streaming && messages.length === 0}
        >
          {t("New")}
        </ResetButton>
      </Header>

      <Scroll>
        <Conversation>
          <ConversationViewport>
            <ConversationContent>
              {hasStarted ? (
                messages.map((m) => (
                  <Message key={m.id} from={m.role}>
                    <MessageContent>
                      {m.content ? (
                        <MarkdownText text={m.content} />
                      ) : m.role === "assistant" && streaming ? (
                        <Cursor />
                      ) : null}
                    </MessageContent>
                  </Message>
                ))
              ) : (
                <ConversationEmptyState
                  icon={<SparklesIcon size={28} color="currentColor" />}
                  title={t("What can I help with?")}
                  description={t(
                    "Ask me anything. Powered by Anthropic-compatible models."
                  )}
                />
              )}
            </ConversationContent>
          </ConversationViewport>
          <ConversationScrollButton />
        </Conversation>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </Scroll>

      <Footer>
        <ComposerForm
          onSubmit={(e) => {
            void handleSend(e);
          }}
        >
          <ComposerInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              streaming
                ? t("Generating… press Stop to cancel")
                : t("Ask anything…")
            }
            disabled={false}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          {streaming ? (
            <ComposerButton
              type="button"
              $variant="stop"
              onClick={handleStop}
              title={t("Stop")}
            >
              {t("Stop")}
            </ComposerButton>
          ) : (
            <ComposerButton
              type="submit"
              $variant="send"
              disabled={!input.trim()}
              title={t("Send")}
            >
              {t("Send")}
            </ComposerButton>
          )}
        </ComposerForm>
        <FooterHint>{t("Enter to send · Shift+Enter for newline")}</FooterHint>
      </Footer>
    </Body>
  );
});

/* -------------------------------------------------------------------------- */
/*  Lightweight Markdown rendering                                            */
/*                                                                            */
/*  We render server responses as plain text inside Cline's <MessageContent>.  */
/*  For a richer experience, swap this for a markdown renderer. Right now     */
/*  the priority is to get the stream working smoothly.                        */
/* -------------------------------------------------------------------------- */

function MarkdownText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} style={{ whiteSpace: "pre-wrap", margin: "0 0 8px 0" }}>
          {p}
        </p>
      ))}
    </>
  );
}

const Cursor = styled.span`
  display: inline-block;
  width: 7px;
  height: 14px;
  vertical-align: text-bottom;
  background: currentColor;
  opacity: 0.6;
`;

/* -------------------------------------------------------------------------- */
/*  Layout                                                                    */
/* -------------------------------------------------------------------------- */

const Body = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid ${s("divider")};
  flex-shrink: 0;
`;

const StatusLine = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: ${s("textTertiary")};
  min-width: 0;
  overflow: hidden;
`;

const ProviderBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  background: ${s("accent")}1a;
  color: ${s("accent")};
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
`;

const ProviderModel = styled.span`
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: ${s("textTertiary")};
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
`;

const ResetButton = styled.button`
  background: transparent;
  border: 1px solid ${s("inputBorder")};
  color: ${s("textSecondary")};
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: ${s("sidebarControlHoverBackground")};
    color: ${s("text")};
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const Scroll = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const Center = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
`;

const StatusBox = styled.div`
  background: ${s("backgroundSecondary")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  color: ${s("textSecondary")};
  max-width: 320px;

  strong {
    display: block;
    color: ${s("text")};
    margin-bottom: 4px;
  }

  p {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
  }
`;

const ErrorNote = styled.div`
  font-size: 13px;
  color: ${s("danger")};
  padding: 8px 10px;
  background: ${s("danger")}10;
  border-radius: 6px;
  margin: 8px 12px 0;
  flex-shrink: 0;
`;

const Footer = styled.div`
  border-top: 1px solid ${s("divider")};
  padding: 10px 12px 12px;
  flex-shrink: 0;
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

const ComposerButton = styled.button<{ $variant: "send" | "stop" }>`
  background: ${(p) => (p.$variant === "stop" ? s("danger") : s("accent"))};
  color: ${(p) => (p.$variant === "stop" ? "#fff" : s("accentText"))};
  border: 0;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: ${(p) => (p.disabled ? "default" : "pointer")};
  opacity: ${(p) => (p.disabled ? 0.5 : 1)};
  flex-shrink: 0;

  &:hover:not(:disabled) {
    filter: brightness(1.05);
  }
`;

const FooterHint = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
  text-align: center;
  margin-top: 6px;
`;
