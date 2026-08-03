import { observer } from "mobx-react";
import { CopyIcon, SparklesIcon } from "outline-icons";
import * as React from "react";
import { useTranslation, Trans } from "react-i18next";
import { toast } from "sonner";
import { TeamPreference } from "@shared/types";
import { TeamValidation } from "@shared/validations";
import Heading from "~/components/Heading";
import Scene from "~/components/Scene";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import { client } from "~/utils/ApiClient";
import SettingRow from "./components/SettingRow";
import Input from "~/components/Input";
import Tooltip from "~/components/Tooltip";
import CopyToClipboard from "~/components/CopyToClipboard";
import Button from "~/components/Button";
import NudeButton from "~/components/NudeButton";
import { useTheme } from "styled-components";
import styled from "styled-components";

function Features() {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const theme = useTheme();
  const [aiConfigured, setAiConfigured] = React.useState<boolean | null>(null);

  // Fetch whether the server is configured for AI Answer (OPENAI_API_KEY set).
  // The toggle is disabled until that is true; it stays enabled per-team from
  // then on and persists via the ai.toggle endpoint.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const json = (await client.post("/ai.status", {})) as {
          data?: { configured?: boolean };
        };
        if (!cancelled) {
          setAiConfigured(!!json?.data?.configured);
        }
      } catch {
        // ignore — toggle will remain disabled
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMCPChange = React.useCallback(
    async (checked: boolean) => {
      team.setPreference(TeamPreference.MCP, checked);
      await team.save();
      toast.success(t("Settings saved"));
    },
    [team, t]
  );

  const handleGuidanceMCPChange = React.useCallback(
    async (ev: React.ChangeEvent<HTMLTextAreaElement>) => {
      team.guidanceMCP = ev.target.value || null;
    },
    [team]
  );

  const handleGuidanceMCPBlur = React.useCallback(async () => {
    await team.save();
    toast.success(t("Settings saved"));
  }, [team, t]);

  const handleAIEnabledChange = React.useCallback(
    async (checked: boolean) => {
      try {
        const json = (await client.post("/ai.toggle", {
          aiEnabled: checked,
        })) as {
          data?: { aiEnabled?: boolean; aiModel?: string | null };
        };
        team.aiEnabled = !!json?.data?.aiEnabled;
        if (json?.data?.aiModel !== undefined) {
          team.aiModel = json.data.aiModel;
        }
        toast.success(t("Settings saved"));
      } catch (_err) {
        toast.error(t("Failed to update AI settings"));
      }
    },
    [team, t]
  );

  const handleCopied = React.useCallback(() => {
    toast.success(t("Copied to clipboard"));
  }, [t]);

  const mcpEndpoint = window.location.origin + "/mcp";

  return (
    <Scene title={t("AI")} icon={<SparklesIcon />}>
      <Heading>{t("AI")}</Heading>
      <Text as="p" type="secondary">
        <Trans>Manage AI and integration features for your workspace.</Trans>
      </Text>

      <SettingRow
        name={TeamPreference.MCP}
        label={t("MCP server")}
        border={!team.getPreference(TeamPreference.MCP)}
        description={
          <>
            <Text type="secondary" as="p">
              {t(
                "Allow members to connect to this workspace with MCP to read and write data."
              )}
            </Text>
            {team.getPreference(TeamPreference.MCP) && (
              <>
                <Text
                  type="secondary"
                  as="p"
                  style={{ marginTop: 8, marginBottom: 4 }}
                >
                  <Trans
                    defaults="Use the following endpoint to connect to the MCP server from your app. Find out more about setup in <a>the docs</a>."
                    components={{
                      a: (
                        <Text
                          as="a"
                          weight="bold"
                          href="https://docs.getoutline.com/s/guide/doc/mcp-6j9jtENNKL"
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      ),
                    }}
                  />
                </Text>
                <Input readOnly value={mcpEndpoint}>
                  <Tooltip content={t("Copy URL")} placement="top">
                    <CopyToClipboard text={mcpEndpoint} onCopy={handleCopied}>
                      <NudeButton type="button" style={{ marginRight: 3 }}>
                        <CopyIcon color={theme.placeholder} size={18} />
                      </NudeButton>
                    </CopyToClipboard>
                  </Tooltip>
                </Input>
              </>
            )}
          </>
        }
      >
        <Switch
          id={TeamPreference.MCP}
          name={TeamPreference.MCP}
          checked={team.getPreference(TeamPreference.MCP)}
          onChange={handleMCPChange}
        />
      </SettingRow>

      {team.getPreference(TeamPreference.MCP) && (
        <SettingRow
          name="guidanceMCP"
          label={t("Additional guidance")}
          description={
            <>
              <div style={{ marginBottom: 8 }}>
                {t(
                  "You can use these optional instructions to tell MCP clients how to use your knowledge base."
                )}
              </div>
              <Input
                id="guidanceMCP"
                type="textarea"
                autoSize
                minHeight="6lh"
                maxHeight="20lh"
                value={team.guidanceMCP ?? ""}
                maxLength={TeamValidation.maxGuidanceMCPLength}
                warningLimit={TeamValidation.warnGuidanceMCPLength}
                onChange={handleGuidanceMCPChange}
                onBlur={handleGuidanceMCPBlur}
              />
            </>
          }
        />
      )}

      <SettingRow
        name="answers"
        label={t("AI answers")}
        description={t(
          "Use AI to get direct answers to questions in search. Configure the API in your server .env (OPENAI_API_KEY and AI_API_BASE_URL) to enable."
        )}
        border={false}
      >
        <Switch
          id="aiEnabled"
          name="aiEnabled"
          checked={team.aiEnabled ?? false}
          onChange={handleAIEnabledChange}
          disabled={!aiConfigured}
        />
      </SettingRow>

      {team.aiEnabled && aiConfigured && <EmbeddingStatusPanel />}
    </Scene>
  );
}

/**
 * Live status panel for the RAG embedding pipeline & AI Indexing Dashboard.
 * Polls `/api/ai.embeddingStatus` and shows counts (indexed / in-progress /
 * idle_pending / failed) plus the active embedding model, progress bar,
 * and quick-action buttons for 5-min idle sync and full re-indexing.
 */
const EmbeddingStatusPanel = observer(function EmbeddingStatusPanel() {
  const { t } = useTranslation();
  const [stats, setStats] = React.useState<{
    indexed: number;
    in_progress: number;
    pending: number;
    failed: number;
    totalDocuments: number;
    indexedDocuments: number;
    idlePendingCount?: number;
    embeddingModel: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isSyncingIdle, setIsSyncingIdle] = React.useState(false);
  const [isReindexing, setIsReindexing] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const res = (await client.post("/ai.embeddingStatus", {})) as {
        data?: typeof stats;
      };
      setStats(res.data ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const interval =
      stats && (stats.pending > 0 || stats.in_progress > 0 || stats.failed > 0)
        ? 3000
        : 30000;
    const id = setInterval(() => void refresh(), interval);
    return () => clearInterval(id);
  }, [refresh, stats]);

  const handleSyncIdle = React.useCallback(async () => {
    setIsSyncingIdle(true);
    try {
      const res = (await client.post("/ai.indexIdle", {})) as {
        data?: { queuedCount?: number };
      };
      const count = res.data?.queuedCount ?? 0;
      toast.success(
        t("Queued {{count}} idle document(s) (>= 5 mins) for indexing", {
          count,
        })
      );
      await refresh();
    } catch (_err) {
      toast.error(t("Failed to trigger idle indexing"));
    } finally {
      setIsSyncingIdle(false);
    }
  }, [t, refresh]);

  const handleFullReindex = React.useCallback(async () => {
    setIsReindexing(true);
    try {
      await client.post("/ai.reindex", { force: true });
      toast.success(t("Full re-indexing scheduled in background"));
      await refresh();
    } catch (_err) {
      toast.error(t("Failed to trigger full reindex"));
    } finally {
      setIsReindexing(false);
    }
  }, [t, refresh]);

  if (error) {
    return (
      <SettingRow
        name="embeddingStatus"
        label={t("AI Knowledge Indexing")}
        description={t("Status unavailable: {{error}}", { error })}
        border={false}
      >
        <span />
      </SettingRow>
    );
  }

  if (!stats) {
    return (
      <SettingRow
        name="embeddingStatus"
        label={t("AI Knowledge Indexing")}
        description={t("Loading dashboard...")}
        border={false}
      >
        <span />
      </SettingRow>
    );
  }

  const percent =
    stats.totalDocuments > 0
      ? Math.min(
          100,
          Math.round((stats.indexedDocuments / stats.totalDocuments) * 100)
        )
      : 100;

  return (
    <DashboardContainer>
      <DashboardHeader>
        <div>
          <DashboardTitle>{t("AI Knowledge & Vector Indexing")}</DashboardTitle>
          <DashboardSubtitle>
            {t(
              "Active Model: {{model}} · Auto-indexes documents unmodified for 5+ minutes.",
              { model: stats.embeddingModel }
            )}
          </DashboardSubtitle>
        </div>
        <HeaderActions>
          <Button
            type="button"
            $neutral
            onClick={handleSyncIdle}
            disabled={isSyncingIdle}
            style={{ fontSize: 13, height: 32 }}
          >
            {isSyncingIdle ? t("Syncing...") : t("Sync Idle Docs (5m)")}
          </Button>
          <Button
            type="button"
            onClick={handleFullReindex}
            disabled={isReindexing}
            style={{ fontSize: 13, height: 32 }}
          >
            {isReindexing ? t("Queuing...") : t("Re-index All")}
          </Button>
        </HeaderActions>
      </DashboardHeader>

      <ProgressBarContainer>
        <ProgressBarTrack>
          <ProgressBarFill $percent={percent} />
        </ProgressBarTrack>
        <ProgressLabel>
          <span>{t("Knowledge Index Coverage")}</span>
          <strong>
            {percent}% ({stats.indexedDocuments}/{stats.totalDocuments} Docs)
          </strong>
        </ProgressLabel>
      </ProgressBarContainer>

      <MetricsGrid>
        <MetricCard>
          <MetricValue>{stats.totalDocuments}</MetricValue>
          <MetricLabel>{t("Total Documents")}</MetricLabel>
        </MetricCard>
        <MetricCard>
          <MetricValue style={{ color: "#10b981" }}>
            {stats.indexedDocuments}
          </MetricValue>
          <MetricLabel>{t("Indexed Docs")}</MetricLabel>
        </MetricCard>
        <MetricCard>
          <MetricValue style={{ color: "#3b82f6" }}>
            {stats.idlePendingCount ?? 0}
          </MetricValue>
          <MetricLabel>{t("Idle Pending (5m)")}</MetricLabel>
        </MetricCard>
        <MetricCard>
          <MetricValue
            style={{ color: stats.failed > 0 ? "#ef4444" : "inherit" }}
          >
            {stats.failed}
          </MetricValue>
          <MetricLabel>{t("Failed Jobs")}</MetricLabel>
        </MetricCard>
      </MetricsGrid>
    </DashboardContainer>
  );
});

const DashboardContainer = styled.div`
  margin-top: 24px;
  padding: 20px;
  border-radius: 12px;
  background: ${(props) => props.theme.sidebarBackground};
  border: 1px solid ${(props) => props.theme.divider};
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
`;

const DashboardHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;

  @media (max-width: 640px) {
    flex-direction: column;
  }
`;

const DashboardTitle = styled.h4`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
`;

const DashboardSubtitle = styled.p`
  margin: 4px 0 0 0;
  font-size: 13px;
  color: ${(props) => props.theme.textSecondary};
`;

const HeaderActions = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const ProgressBarContainer = styled.div`
  margin-bottom: 20px;
`;

const ProgressBarTrack = styled.div`
  height: 8px;
  width: 100%;
  border-radius: 999px;
  background: ${(props) => props.theme.divider};
  overflow: hidden;
`;

const ProgressBarFill = styled.div<{ $percent: number }>`
  height: 100%;
  width: ${(props) => props.$percent}%;
  border-radius: 999px;
  background: linear-gradient(90deg, #3b82f6 0%, #10b981 100%);
  transition: width 400ms ease-in-out;
`;

const ProgressLabel = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  margin-top: 6px;
`;

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;

  @media (max-width: 640px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;

const MetricCard = styled.div`
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`;

const MetricValue = styled.span`
  font-size: 18px;
  font-weight: 700;
  color: ${(props) => props.theme.text};
`;

const MetricLabel = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
  margin-top: 2px;
`;

export default observer(Features);
