import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled, { useTheme } from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Input from "~/components/Input";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";

/* -------------------------------------------------------------------------- */
/*  AI Provider settings — admin-only page to set Anthropic / OpenAI keys.   */
/*  Keys are stored server-side per workspace; this page edits them.        */
/* -------------------------------------------------------------------------- */

type Provider = "anthropic" | "openai" | "openai-compatible";

interface ProviderKey {
  provider: Provider;
  baseUrl: string;
  model: string;
  enabled: boolean;
  /** Last 4 chars of the stored key, returned by the server. */
  apiKeySuffix: string | null;
}

interface ProviderDraft {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}

const PRESETS: Record<Provider, { baseUrl: string; model: string }> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
  },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  "openai-compatible": { baseUrl: "", model: "gpt-4o-mini" },
};

const PROVIDER_ORDER: Provider[] = ["anthropic", "openai", "openai-compatible"];

export const ProvidersSettings = observer(function ProvidersSettings() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { auth } = useStores();
  const team = auth.team;
  const aiEnabled = team?.aiEnabled ?? false;
  const [selected, setSelected] = React.useState<Provider>("anthropic");
  const [loaded, setLoaded] = React.useState<
    Record<Provider, ProviderKey | null>
  >({
    anthropic: null,
    openai: null,
    "openai-compatible": null,
  });
  const [draft, setDraft] = React.useState<ProviderDraft>(() =>
    makeDraft("anthropic", null)
  );
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [savedTick, setSavedTick] = React.useState(0);

  // Initial load.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = (await client.post("/agentProviderKeys.list", {})) as {
          data?: ProviderKey[];
        };
        if (cancelled) {
          return;
        }
        const next: typeof loaded = {
          anthropic: null,
          openai: null,
          "openai-compatible": null,
        };
        (res.data ?? []).forEach((k) => {
          if (PROVIDER_ORDER.includes(k.provider)) {
            next[k.provider] = k;
          }
        });
        setLoaded(next);
      } catch {
        // Endpoint may not be wired yet — leave all as "not configured".
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // When the user switches tab, refresh the draft.
  React.useEffect(() => {
    setDraft(makeDraft(selected, loaded[selected]));
  }, [selected, loaded]);

  const update = (patch: Partial<ProviderDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };

  const onSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      await client.post("/agentProviderKeys.update", {
        provider: draft.provider,
        apiKey: draft.apiKey.trim() || undefined,
        baseUrl: draft.baseUrl.trim() || undefined,
        model: draft.model.trim() || undefined,
        enabled: draft.enabled,
      });
      // Refresh this provider from the server so we pick up the new suffix.
      const res = (await client.post("/agentProviderKeys.list", {})) as {
        data?: ProviderKey[];
      };
      const next: typeof loaded = { ...loaded };
      (res.data ?? []).forEach((k) => {
        if (PROVIDER_ORDER.includes(k.provider)) {
          next[k.provider] = k;
        }
      });
      setLoaded(next);
      setDraft(makeDraft(draft.provider, next[draft.provider]));
      setSavedTick(Date.now());
      toast.success(t("Settings saved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("Failed to save provider")
      );
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (deleting) {
      return;
    }
    if (!window.confirm(t("Remove the API key for this provider?"))) {
      return;
    }
    setDeleting(true);
    try {
      await client.post("/agentProviderKeys.delete", {
        provider: draft.provider,
      });
      const next: typeof loaded = { ...loaded };
      next[selected] = null;
      setLoaded(next);
      setDraft(makeDraft(selected, null));
      toast.success(t("Provider removed"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("Failed to remove provider")
      );
    } finally {
      setDeleting(false);
    }
  };

  if (!aiEnabled) {
    return (
      <Wrapper>
        <Empty>
          <EmptyTitle>{t("AI features are disabled")}</EmptyTitle>
          <EmptyHint>
            {t(
              "Enable AI in the team settings to configure providers and use the agent."
            )}
          </EmptyHint>
        </Empty>
      </Wrapper>
    );
  }

  const current = loaded[selected];
  const keyPlaceholder = current?.apiKeySuffix
    ? `••••••••${current.apiKeySuffix}`
    : selected === "anthropic"
      ? "sk-ant-…"
      : "sk-…";
  const showSaved = Date.now() - savedTick < 4000;

  return (
    <Wrapper>
      <Header>
        <Title>{t("AI providers")}</Title>
        <Subtitle>
          {t(
            "Configure which LLM providers the agent uses. Keys are stored server-side and never exposed in the client after saving."
          )}
        </Subtitle>
      </Header>

      <Tabs role="tablist">
        {PROVIDER_ORDER.map((p) => (
          <Tab
            key={p}
            role="tab"
            aria-selected={selected === p}
            $active={selected === p}
            $configured={!!loaded[p]}
            type="button"
            onClick={() => setSelected(p)}
          >
            {p === "openai-compatible" ? "OpenAI-compatible" : titleCase(p)}
            {loaded[p] ? <Dot $configured /> : null}
          </Tab>
        ))}
      </Tabs>

      {loading ? (
        <Empty>
          <EmptyHint>{t("Loading…")}</EmptyHint>
        </Empty>
      ) : (
        <Form>
          <Field>
            <Label>{t("Provider")}</Label>
            <Input
              type="text"
              value={draft.provider}
              readOnly
              disabled
              style={{ background: s("backgroundSecondary")({ theme }) }}
            />
          </Field>
          <Field>
            <Label>{t("API key")}</Label>
            <Input
              type="password"
              value={draft.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder={keyPlaceholder}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={saving || deleting}
            />
            {current?.apiKeySuffix && !draft.apiKey && (
              <Hint>
                {t("A key is saved for this provider (ending in {{suffix}}).", {
                  suffix: current.apiKeySuffix,
                })}
              </Hint>
            )}
          </Field>
          <Field>
            <Label>{t("Base URL")}</Label>
            <Input
              type="text"
              value={draft.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              placeholder={
                draft.provider === "openai-compatible"
                  ? "https://your-gateway.example.com/v1"
                  : PRESETS[selected].baseUrl
              }
              disabled={
                saving || deleting || draft.provider !== "openai-compatible"
              }
              style={
                draft.provider !== "openai-compatible"
                  ? { background: s("backgroundSecondary")({ theme }) }
                  : undefined
              }
            />
          </Field>
          <Field>
            <Label>{t("Default model")}</Label>
            <Input
              type="text"
              value={draft.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder={PRESETS[selected].model}
              disabled={saving || deleting}
            />
          </Field>
          <Field>
            <ToggleLabel>
              <ToggleInput
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
                disabled={saving || deleting}
              />
              {t("Enable this provider")}
            </ToggleLabel>
          </Field>
          <Actions>
            {current && (
              <Button
                type="button"
                onClick={onDelete}
                disabled={saving || deleting}
                danger
                neutral
              >
                {deleting ? t("Removing…") : t("Delete key")}
              </Button>
            )}
            <RightActions>
              {showSaved && <SavedTag>{t("Saved")}</SavedTag>}
              <Button
                type="button"
                onClick={onSave}
                disabled={saving || deleting}
              >
                {saving ? t("Saving…") : t("Save")}
              </Button>
            </RightActions>
          </Actions>
        </Form>
      )}
    </Wrapper>
  );
});

function makeDraft(provider: Provider, key: ProviderKey | null): ProviderDraft {
  const preset = PRESETS[provider];
  return {
    provider,
    apiKey: "",
    baseUrl: key?.baseUrl || preset.baseUrl,
    model: key?.model || preset.model,
    enabled: key?.enabled ?? false,
  };
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* -------------------------------------------------------------------------- */
/*  Styled primitives                                                         */
/* -------------------------------------------------------------------------- */

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
  padding: 20px 0;
`;

const Header = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: ${s("text")};
`;

const Subtitle = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${s("textSecondary")};
  line-height: 1.5;
`;

const Tabs = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 1px solid ${s("divider")};
`;

const Tab = styled.button<{ $active: boolean; $configured?: boolean }>`
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  background: transparent;
  border: 0;
  border-bottom: 2px solid
    ${(p) => (p.$active ? p.theme.accent : "transparent")};
  color: ${(p) => (p.$active ? s("text") : s("textSecondary"))};
  cursor: pointer;
  margin-bottom: -1px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const Dot = styled.span<{ $configured: boolean }>`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${(p) => (p.$configured ? p.theme.success : s("textTertiary"))};
  display: inline-block;
`;

const Form = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  padding: 16px;
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: ${s("textTertiary")};
`;

const Hint = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
  margin-top: 2px;
`;

const ToggleLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: ${s("text")};
  cursor: pointer;
`;

const ToggleInput = styled.input`
  width: 16px;
  height: 16px;
`;

const Actions = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
`;

const RightActions = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  margin-left: auto;
`;

const SavedTag = styled.span`
  font-size: 11px;
  color: ${(p) => p.theme.success};
  text-transform: uppercase;
  letter-spacing: 0.4px;
  font-weight: 600;
`;

const Empty = styled.div`
  text-align: center;
  padding: 40px;
  color: ${s("textSecondary")};
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
`;
