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
        const json = (await client.post("/ai.toggle", { aiEnabled: checked })) as {
          data?: { aiEnabled?: boolean; aiModel?: string | null };
        };
        team.aiEnabled = !!json?.data?.aiEnabled;
        if (json?.data?.aiModel !== undefined) {
          team.aiModel = json.data.aiModel;
        }
        toast.success(t("Settings saved"));
      } catch (err) {
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
 * Live status panel for the RAG embedding pipeline. Polls
 * `/api/ai.embeddingStatus` and shows counts (indexed / in-progress /
 * pending / failed) plus the active local model. When there is pending
 * work the panel polls every 3s; otherwise every 30s.
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
    embeddingModel: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

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
    const interval = stats && (stats.pending > 0 || stats.in_progress > 0 || stats.failed > 0) ? 3000 : 30000;
    const id = setInterval(() => void refresh(), interval);
    return () => clearInterval(id);
  }, [refresh, stats?.pending, stats?.in_progress, stats?.failed]);

  if (error) {
    return (
      <SettingRow
        name="embeddingStatus"
        label={t("Embeddings")}
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
        label={t("Embeddings")}
        description={t("Loading...")}
        border={false}
      >
        <span />
      </SettingRow>
    );
  }

  const description = (
    <>
      <Text type="secondary" as="p">
        {t(
          "Local embedding model: {{model}}. {{indexed}} of {{total}} documents indexed.",
          {
            model: stats.embeddingModel,
            indexed: stats.indexedDocuments,
            total: stats.totalDocuments,
          }
        )}
      </Text>
      <Text type="secondary" as="p" style={{ marginTop: 6 }}>
        {t(
          "New documents are indexed automatically within a few minutes of editing. Failed jobs ({{failed}}) can be re-tried by editing the document or waiting for the nightly cron.",
          { failed: stats.failed }
        )}
      </Text>
    </>
  );

  return (
    <SettingRow
      name="embeddingStatus"
      label={t("Embeddings")}
      description={description}
      border={false}
    >
      <StatusList>
        <StatusPill $kind="ok">
          {t("Indexed")} · {stats.indexed}
        </StatusPill>
        {stats.in_progress > 0 ? (
          <StatusPill $kind="progress">
            {t("In progress")} · {stats.in_progress}
          </StatusPill>
        ) : null}
        {stats.pending > 0 ? (
          <StatusPill $kind="pending">
            {t("Pending")} · {stats.pending}
          </StatusPill>
        ) : null}
        {stats.failed > 0 ? (
          <StatusPill $kind="error">
            {t("Failed")} · {stats.failed}
          </StatusPill>
        ) : null}
      </StatusList>
    </SettingRow>
  );
});

const StatusList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
`;

const StatusPill = styled.span<{ $kind: "ok" | "progress" | "pending" | "error" }>`
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  color: ${(props) => {
    switch (props.$kind) {
      case "ok":
        return props.theme.accentText ?? "#fff";
      case "progress":
        return props.theme.text;
      case "pending":
        return props.theme.textSecondary;
      case "error":
        return props.theme.text;
    }
  }};
  background: ${(props) => {
    switch (props.$kind) {
      case "ok":
        return props.theme.accent;
      case "progress":
        return props.theme.backgroundSecondary;
      case "pending":
        return props.theme.backgroundSecondary;
      case "error":
        return "#fee";
    }
  }};
`;

export default observer(Features);
