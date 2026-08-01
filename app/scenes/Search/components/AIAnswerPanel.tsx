import { SparklesIcon, CloseIcon, ArrowIcon, CopyIcon } from "outline-icons";
import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled, { keyframes, useTheme } from "styled-components";
import { s } from "@shared/styles";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import { client } from "~/utils/ApiClient";
import PlaceholderText from "~/components/PlaceholderText";

interface Source {
  id: string;
  title: string;
  url: string;
  snippet: string;
}

interface Answer {
  answer: string;
  sources: Source[];
  tokensUsed: number;
}

interface Props {
  query: string;
  visible: boolean;
  onClose: () => void;
}

const MIN_QUERY_LENGTH = 4;
const DEBOUNCE_MS = 350;

const blink = keyframes`
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
`;

/**
 * AI Answer panel — auto-fetches as the user types (debounced) and shows a
 * concise summary plus clickable source cards. The previous "press a button
 * to ask" UX is gone: the panel opens with the search query and streams an
 * answer as soon as it's long enough to be meaningful.
 */
function AIAnswerPanel({ query, visible, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const team = useCurrentTeam();
  const [state, setState] = React.useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [followUp, setFollowUp] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const reqIdRef = React.useRef(0);

  const enabledForTeam = !!team?.aiEnabled;
  const queryReady = query.trim().length >= MIN_QUERY_LENGTH;

  // Auto-fetch on query change, debounced, race-safe. The first call that
  // fires sets reqIdRef.current; if a newer call starts before the older
  // one returns, the older result is discarded.
  React.useEffect(() => {
    if (!visible || !enabledForTeam || !queryReady) {
      return;
    }
    const handle = setTimeout(() => {
      const myId = ++reqIdRef.current;
      setState("loading");
      setError(null);
      setAnswer(null);
      void (async () => {
        try {
          const res = (await client.post("/ai.answer", { query })) as {
            data?: Answer;
          };
          if (reqIdRef.current !== myId) {
            return; // a newer query superseded us
          }
          setAnswer((res.data as Answer) ?? null);
          setState("ready");
        } catch (err) {
          if (reqIdRef.current !== myId) {
            return;
          }
          setError(err instanceof Error ? err.message : String(err));
          setState("error");
        }
      })();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, visible, enabledForTeam, queryReady]);

  if (!visible) {
    return null;
  }

  const handleCopy = () => {
    if (answer) {
      void navigator.clipboard.writeText(answer.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUp.trim()) {
      return;
    }
    // Re-run the same /ai.answer endpoint with the follow-up as the new query.
    // The follow-up is treated as a fresh search; the previous answer is
    // replaced. (A more advanced agent would concatenate messages; that is
    // out of scope for the inline search panel.)
    const merged = `${query} \n\n${followUp.trim()}`;
    setFollowUp("");
    reqIdRef.current += 1;
    setState("loading");
    setError(null);
    setAnswer(null);
    const myId = reqIdRef.current;
    void (async () => {
      try {
        const res = (await client.post("/ai.answer", { query: merged })) as {
          data?: Answer;
        };
        if (reqIdRef.current !== myId) {
          return;
        }
        setAnswer((res.data as Answer) ?? null);
        setState("ready");
      } catch (err) {
        if (reqIdRef.current !== myId) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setState("error");
      }
    })();
  };

  return (
    <Panel>
      <Header>
        <Title>
          <SparklesIcon color={theme.accent} size={16} />
          <strong>{t("AI Answer")}</strong>
          {state === "loading" && (
            <StatusDot aria-label={t("Loading")} />
          )}
        </Title>
        <CloseButton
          type="button"
          onClick={onClose}
          aria-label={t("Close")}
        >
          <CloseIcon size={16} color={theme.textTertiary} />
        </CloseButton>
      </Header>

      {!enabledForTeam ? (
        <EmptyNote>
          {t(
            "AI Answer is not enabled for this workspace. An admin can enable it in Settings → AI."
          )}
        </EmptyNote>
      ) : !query ? (
        <EmptyNote>
          {t("Type a search query to see an AI-generated summary.")}
        </EmptyNote>
      ) : !queryReady ? (
        <EmptyNote>
          {t("Keep typing to see an AI-generated summary.")}
        </EmptyNote>
      ) : state === "error" ? (
        <ErrorNote>
          {t("Could not get an answer: {{error}}", { error })}
        </ErrorNote>
      ) : state === "ready" && answer ? (
        <>
          <AnswerBody>{answer.answer}</AnswerBody>
          {answer.sources.length > 0 ? (
            <Sources>
              <SourcesHeader>{t("Sources")}</SourcesHeader>
              <SourceList>
                {answer.sources.map((s, i) => (
                  <SourceCard key={s.id} href={s.url} title={s.snippet}>
                    <SourceNumber>{i + 1}</SourceNumber>
                    <SourceMeta>
                      <SourceTitle>{s.title}</SourceTitle>
                      <SourceSnippet>{s.snippet}</SourceSnippet>
                    </SourceMeta>
                  </SourceCard>
                ))}
              </SourceList>
            </Sources>
          ) : null}
          <Footer>
            <FooterActions>
              <FooterButton
                type="button"
                onClick={handleCopy}
                title={t("Copy answer")}
                color={theme.textSecondary}
              >
                <CopyIcon size={14} />
                <span>{copied ? t("Copied") : t("Copy")}</span>
              </FooterButton>
            </FooterActions>
            <FollowUpForm onSubmit={handleFollowUp}>
              <FollowUpInput
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder={t("Ask a follow-up...")}
              />
              <FollowUpButton
                type="submit"
                disabled={!followUp.trim()}
                $accent={theme.accent}
                aria-label={t("Send follow-up")}
              >
                <ArrowIcon size={14} />
              </FollowUpButton>
            </FollowUpForm>
          </Footer>
        </>
      ) : (
        // loading skeleton
        <>
          <Skeleton>
            <PlaceholderText width={92} />
            <PlaceholderText width={88} />
            <PlaceholderText width={75} />
            <PlaceholderText width={60} />
          </Skeleton>
          <Sources>
            <SourcesHeader>{t("Sources")}</SourcesHeader>
            <SourceList>
              {[0, 1, 2].map((i) => (
                <SourceCardSkeleton key={i}>
                  <SourceNumber>·</SourceNumber>
                  <SourceMeta>
                    <PlaceholderText width={50} />
                    <PlaceholderText width={88} />
                  </SourceMeta>
                </SourceCardSkeleton>
              ))}
            </SourceList>
          </Sources>
        </>
      )}
    </Panel>
  );
}

const Panel = styled.aside`
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  padding: 18px 20px 14px;
  margin-top: 14px;
  margin-bottom: 24px;
  position: relative;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
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
  animation: ${blink} 1.2s infinite;
`;

const CloseButton = styled.button`
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

const AnswerBody = styled.div`
  font-size: 15px;
  line-height: 1.65;
  color: ${s("text")};
  white-space: pre-wrap;

  p {
    margin: 0 0 8px;
  }
`;

const Sources = styled.div`
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid ${s("divider")};
`;

const SourcesHeader = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  color: ${s("textTertiary")};
  margin-bottom: 8px;
  letter-spacing: 0.05em;
  font-weight: 600;
`;

const SourceList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SourceCard = styled.a`
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  text-decoration: none;
  color: inherit;
  transition: background 100ms ease-in-out, border-color 100ms ease-in-out;

  &:hover {
    background: ${s("sidebarControlHoverBackground")};
    border-color: ${s("inputBorderFocused")};
  }
`;

const SourceCardSkeleton = styled.div`
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  opacity: 0.6;
`;

const SourceNumber = styled.span`
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: ${(p) => p.theme.accent};
  color: ${(p) => p.theme.accentText ?? "#fff"};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  margin-top: 1px;
`;

const SourceMeta = styled.div`
  flex: 1;
  min-width: 0;
`;

const SourceTitle = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: ${s("text")};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SourceSnippet = styled.div`
  font-size: 12px;
  color: ${s("textTertiary")};
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
`;

const Footer = styled.div`
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid ${s("divider")};
  display: flex;
  align-items: center;
  gap: 10px;
`;

const FooterActions = styled.div`
  display: flex;
  gap: 4px;
`;

const FooterButton = styled.button<{ color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 0;
  color: ${(p) => p.color};
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;

  &:hover {
    background: ${s("sidebarControlHoverBackground")};
    color: ${s("text")};
  }
`;

const FollowUpForm = styled.form`
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  background: ${s("inputBackground")};
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  padding: 2px 4px 2px 10px;

  &:focus-within {
    border-color: ${s("inputBorderFocused")};
  }
`;

const FollowUpInput = styled.input`
  flex: 1;
  background: transparent;
  border: 0;
  outline: 0;
  color: ${s("text")};
  font-size: 13px;
  padding: 6px 0;

  &::placeholder {
    color: ${s("placeholder")};
  }
`;

const FollowUpButton = styled.button<{ $accent: string }>`
  background: transparent;
  border: 0;
  color: ${(p) => (p.disabled ? s("textTertiary") : p.$accent)};
  cursor: ${(p) => (p.disabled ? "default" : "pointer")};
  padding: 6px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;

  &:hover:not(:disabled) {
    background: ${s("sidebarControlHoverBackground")};
  }
`;

const Skeleton = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
`;

const EmptyNote = styled.div`
  color: ${s("textTertiary")};
  font-size: 13px;
  margin: 8px 0;
`;

const ErrorNote = styled.div`
  color: ${s("danger")};
  font-size: 13px;
  margin: 8px 0;
`;

export default observer(AIAnswerPanel);
