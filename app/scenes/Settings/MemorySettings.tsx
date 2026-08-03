import { observer } from "mobx-react";
import { SparklesIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import Heading from "~/components/Heading";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import { client } from "~/utils/ApiClient";
import useCurrentTeam from "~/hooks/useCurrentTeam";

interface AgentMemory {
  id: string;
  category: string;
  content: string;
  archived: boolean;
  confidence: number;
  createdAt: string;
  sourceSessionId: string | null;
  lastUsedAt: string | null;
}

function MemorySettings() {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const [memories, setMemories] = React.useState<AgentMemory[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [endpointsAvailable, setEndpointsAvailable] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = (await client.post("/agentMemories.list", {})) as {
        data?: AgentMemory[];
      };
      setMemories((res.data ?? []).filter((m) => !m.archived));
      setEndpointsAvailable(true);
    } catch {
      setEndpointsAvailable(false);
      setMemories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleForget = React.useCallback(
    async (id: string) => {
      try {
        await client.post("/agentMemories.archive", { id });
        toast.success(t("Memory forgotten"));
        await refresh();
      } catch {
        toast.error(t("Failed to forget memory"));
      }
    },
    [refresh, t]
  );

  // Group by category, preserving the within-group order from the server.
  const grouped = React.useMemo(() => {
    const map = new Map<string, AgentMemory[]>();
    (memories ?? []).forEach((m) => {
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [memories]);

  if (!team?.aiEnabled) {
    return (
      <Scene title={t("Memory")} icon={<SparklesIcon />}>
        <Heading>{t("Memory")}</Heading>
        <Text as="p" type="secondary">
          {t("Enable AI in the team settings to manage agent memory.")}
        </Text>
      </Scene>
    );
  }

  if (!endpointsAvailable) {
    return (
      <Scene title={t("Memory")} icon={<SparklesIcon />}>
        <Heading>{t("Memory")}</Heading>
        <Text as="p" type="secondary">
          {t(
            "The agent can remember facts about you across conversations. View and manage what it has learned."
          )}
        </Text>
        <Empty>
          <EmptyTitle>{t("Coming soon")}</EmptyTitle>
          <EmptyHint>
            {t(
              "Memory management is part of the Phase 3.3 release. The AgentMemory model exists server-side; the management UI will arrive once the agentMemories API is wired up."
            )}
          </EmptyHint>
        </Empty>
      </Scene>
    );
  }

  return (
    <Scene title={t("Memory")} icon={<SparklesIcon />}>
      <Heading>{t("Memory")}</Heading>
      <Text as="p" type="secondary">
        {t(
          "Facts the agent has learned about you. The agent pulls relevant memories into each new session. Forget any that are wrong or no longer apply."
        )}
      </Text>

      {loading && (memories ?? []).length === 0 ? (
        <Empty>{t("Loading…")}</Empty>
      ) : grouped.length === 0 ? (
        <Empty>
          {t(
            "No memories yet. The agent will start remembering facts after a few conversations."
          )}
        </Empty>
      ) : (
        <Groups>
          {grouped.map(([category, items]) => (
            <CategoryBlock key={category}>
              <CategoryHeader>
                <CategoryName>{category}</CategoryName>
                <CategoryCount>{items.length}</CategoryCount>
              </CategoryHeader>
              <MemoryList>
                {items.map((m) => (
                  <MemoryRow key={m.id}>
                    <MemoryBody>
                      <MemoryContent>{m.content}</MemoryContent>
                      <MemoryMeta>
                        <span>
                          {t("Saved {{when}}", {
                            when: formatRelative(m.createdAt),
                          })}
                        </span>
                        {m.sourceSessionId && (
                          <span>
                            {t("Source session {{id}}", {
                              id: m.sourceSessionId.slice(0, 8),
                            })}
                          </span>
                        )}
                        {m.confidence < 1 && (
                          <Confidence>
                            {t("Confidence {{pct}}%", {
                              pct: Math.round(m.confidence * 100),
                            })}
                          </Confidence>
                        )}
                      </MemoryMeta>
                    </MemoryBody>
                    <ForgetButton
                      type="button"
                      onClick={() => void handleForget(m.id)}
                    >
                      {t("Forget")}
                    </ForgetButton>
                  </MemoryRow>
                ))}
              </MemoryList>
            </CategoryBlock>
          ))}
        </Groups>
      )}
    </Scene>
  );
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString();
}

/* -------------------------------------------------------------------------- */
/*  Styled primitives                                                         */
/* -------------------------------------------------------------------------- */

const Groups = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 16px;
`;

const CategoryBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CategoryHeader = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid ${s("divider")};
`;

const CategoryName = styled.div`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${s("textTertiary")};
`;

const CategoryCount = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
  font-weight: 500;
`;

const MemoryList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const MemoryRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 6px;
`;

const MemoryBody = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const MemoryContent = styled.div`
  font-size: 13px;
  color: ${s("text")};
  line-height: 1.5;
  word-break: break-word;
`;

const MemoryMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: ${s("textTertiary")};
`;

const Confidence = styled.span`
  color: ${s("textTertiary")};
`;

const ForgetButton = styled.button`
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid ${s("inputBorder")};
  background: transparent;
  color: ${s("textSecondary")};
  cursor: pointer;
  flex-shrink: 0;
  align-self: center;

  &:hover:not(:disabled) {
    background: ${s("sidebarControlHoverBackground")};
  }
`;

const Empty = styled.div`
  text-align: center;
  padding: 32px;
  color: ${s("textSecondary")};
  font-size: 13px;
  margin-top: 16px;
`;

const EmptyTitle = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: ${s("text")};
  margin-bottom: 4px;
`;

const EmptyHint = styled.div`
  font-size: 13px;
  line-height: 1.5;
  max-width: 480px;
  margin: 0 auto;
`;

export default observer(MemorySettings);
