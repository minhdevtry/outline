import { SparklesIcon } from "outline-icons";
import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import Button from "~/components/Button";
import Text from "~/components/Text";
import LoadingIndicator from "~/components/LoadingIndicator";
import { s } from "@shared/styles";
import useCurrentTeam from "~/hooks/useCurrentTeam";

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

/**
 * Side panel that calls POST /api/ai.answer with the current search query and
 * renders the model's response plus the source documents that were used as
 * context. Hidden until the user explicitly asks; closing it does not affect
 * the underlying search results.
 */
function AIAnswerPanel({ query, visible, onClose }: Props) {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const [state, setState] = React.useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const enabledForTeam = !!team?.aiEnabled;

  const ask = React.useCallback(async () => {
    if (!query || state === "loading") {
      return;
    }
    setState("loading");
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/ai.answer", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setAnswer(json.data as Answer);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, [query, state]);

  if (!visible) {
    return null;
  }

  return (
    <Panel>
      <Header>
        <Title>
          <SparklesIcon color="currentColor" size={18} />
          <strong>{t("AI Answer")}</strong>
        </Title>
        <CloseButton type="button" onClick={onClose} aria-label={t("Close")}>
          ×
        </CloseButton>
      </Header>

      {!enabledForTeam ? (
        <Empty type="secondary">
          {t(
            "AI Answer is not enabled for this workspace. An admin can enable it in Settings → AI."
          )}
        </Empty>
      ) : !query ? (
        <Empty type="secondary">
          {t("Type a search query and ask the AI.")}
        </Empty>
      ) : state === "loading" ? (
        <LoadingContainer>
          <LoadingIndicator />
        </LoadingContainer>
      ) : state === "error" ? (
        <Empty>
          {t("Failed to get an answer: {{error}}", { error })}
        </Empty>
      ) : state === "ready" && answer ? (
        <>
          <AnswerBody>{answer.answer}</AnswerBody>
          {answer.sources.length > 0 ? (
            <Sources>
              <SourcesHeader>{t("Sources")}</SourcesHeader>
              {answer.sources.map((s, i) => (
                <SourceItem key={s.id} href={s.url}>
                  [{i + 1}] {s.title}
                </SourceItem>
              ))}
            </Sources>
          ) : null}
        </>
      ) : (
        <Actions>
          <Button onClick={ask} disabled={!query}>
            {t("Ask AI")}
          </Button>
        </Actions>
      )}
    </Panel>
  );
}

const Panel = styled.aside`
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  padding: 16px;
  margin-top: 12px;
  margin-bottom: 24px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
`;

const CloseButton = styled.button`
  background: transparent;
  border: 0;
  color: ${s("textTertiary")};
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;

  &:hover {
    color: ${s("text")};
  }
`;

const AnswerBody = styled.div`
  white-space: pre-wrap;
  font-size: 15px;
  line-height: 1.6;
  color: ${s("text")};
`;

const Empty = styled(Text)`
  margin: 8px 0;
`;

const Sources = styled.div`
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid ${s("divider")};
`;

const SourcesHeader = styled.div`
  font-size: 12px;
  text-transform: uppercase;
  color: ${s("textTertiary")};
  margin-bottom: 8px;
  letter-spacing: 0.05em;
`;

const SourceItem = styled.a`
  display: block;
  color: ${s("textSecondary")};
  font-size: 13px;
  margin: 4px 0;

  &:hover {
    color: ${s("text")};
    text-decoration: underline;
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
`;

const LoadingContainer = styled.div`
  display: flex;
  justify-content: center;
  padding: 24px 0;
`;

export default observer(AIAnswerPanel);
