import { observer } from "mobx-react";
import { SparklesIcon, PlusIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import { client } from "~/utils/ApiClient";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import useStores from "~/hooks/useStores";
import type { AgentSkill } from "~/stores/AgentStore";

function SkillsSettings() {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const { agent } = useStores();
  const [editing, setEditing] = React.useState<AgentSkill | "new" | null>(null);

  React.useEffect(() => {
    void agent.fetchSkills();
  }, [agent]);

  const handleDelete = React.useCallback(
    async (id: string) => {
      if (!window.confirm(t("Delete this skill?"))) {
        return;
      }
      try {
        await client.post("/agentSkills.delete", { id });
        toast.success(t("Skill deleted"));
        await agent.fetchSkills();
      } catch {
        toast.error(t("Failed to delete skill"));
      }
    },
    [agent, t]
  );

  const handleSetDefault = React.useCallback(
    async (id: string) => {
      try {
        await client.post("/agentSkills.update", { id, isDefault: true });
        toast.success(t("Default updated"));
        await agent.fetchSkills();
      } catch {
        toast.error(t("Failed to update default"));
      }
    },
    [agent, t]
  );

  if (!team?.aiEnabled) {
    return (
      <Scene title={t("Skills")} icon={<SparklesIcon />}>
        <Heading>{t("Skills")}</Heading>
        <Text as="p" type="secondary">
          {t("Enable AI in the team settings to manage agent skills.")}
        </Text>
      </Scene>
    );
  }

  return (
    <Scene
      title={t("Skills")}
      icon={<SparklesIcon />}
      actions={
        editing ? null : (
          <Button
            type="button"
            onClick={() => setEditing("new")}
            icon={<PlusIcon />}
          >
            {t("New skill")}
          </Button>
        )
      }
    >
      <Heading>{t("Skills")}</Heading>
      <Text as="p" type="secondary">
        {t(
          "Skills are reusable personas and tool bundles for the agent. The system prompt fragment is prepended when the skill is active."
        )}
      </Text>

      {editing && (
        <SkillForm
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void agent.fetchSkills();
          }}
        />
      )}

      {agent.skillsLoading && agent.skills.length === 0 ? (
        <Empty>{t("Loading…")}</Empty>
      ) : agent.skills.length === 0 && !editing ? (
        <Empty>
          {t("No skills yet. Create one to give the agent a persona.")}
        </Empty>
      ) : (
        <List>
          {agent.skills.map((skill) => (
            <SkillRow key={skill.id}>
              <RowHeader>
                <RowMain>
                  <RowName>
                    {skill.displayName || skill.name}
                    {skill.isDefault && (
                      <DefaultPill>{t("Default")}</DefaultPill>
                    )}
                  </RowName>
                  <RowSlug>@{skill.name}</RowSlug>
                </RowMain>
                <RowActions>
                  {!skill.isDefault && (
                    <ActionButton
                      type="button"
                      onClick={() => void handleSetDefault(skill.id)}
                    >
                      {t("Set as default")}
                    </ActionButton>
                  )}
                  <ActionButton type="button" onClick={() => setEditing(skill)}>
                    {t("Edit")}
                  </ActionButton>
                  <ActionButton
                    type="button"
                    $danger
                    onClick={() => void handleDelete(skill.id)}
                  >
                    {t("Delete")}
                  </ActionButton>
                </RowActions>
              </RowHeader>
              {skill.description && (
                <RowDescription>{skill.description}</RowDescription>
              )}
              <Fragment>
                <FragmentLabel>{t("System prompt")}</FragmentLabel>
                <FragmentBody>{skill.systemPromptFragment}</FragmentBody>
              </Fragment>
              {skill.toolNames.length > 0 && (
                <Tools>
                  {skill.toolNames.map((tool) => (
                    <ToolPill key={tool}>{tool}</ToolPill>
                  ))}
                </Tools>
              )}
            </SkillRow>
          ))}
        </List>
      )}
    </Scene>
  );
}

/* -------------------------------------------------------------------------- */
/*  Skill form — create or edit.                                              */
/* -------------------------------------------------------------------------- */

const SkillForm = observer(function SkillForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: AgentSkill | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(initial?.name ?? "");
  const [displayName, setDisplayName] = React.useState(
    initial?.displayName ?? ""
  );
  const [description, setDescription] = React.useState(
    initial?.description ?? ""
  );
  const [systemPromptFragment, setFragment] = React.useState(
    initial?.systemPromptFragment ?? ""
  );
  const [toolNames, setToolNames] = React.useState(
    (initial?.toolNames ?? []).join("\n")
  );
  const [isDefault, setIsDefault] = React.useState(initial?.isDefault ?? false);
  const [saving, setSaving] = React.useState(false);

  const slugOk = /^[a-z0-9_-]+$/.test(name.trim());
  const canSave =
    name.trim() &&
    displayName.trim() &&
    systemPromptFragment.trim() &&
    slugOk &&
    !saving;

  const onSave = async () => {
    if (!canSave) {
      return;
    }
    setSaving(true);
    const toolList = toolNames
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      id: initial?.id,
      name: name.trim(),
      displayName: displayName.trim(),
      description: description.trim() || null,
      systemPromptFragment: systemPromptFragment.trim(),
      toolNames: toolList,
      isDefault,
    };
    try {
      if (initial) {
        await client.post("/agentSkills.update", payload);
        toast.success(t("Skill updated"));
      } else {
        await client.post("/agentSkills.create", payload);
        toast.success(t("Skill created"));
      }
      onSaved();
    } catch {
      toast.error(t("Failed to save skill"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormCard>
      <FormTitle>{initial ? t("Edit skill") : t("New skill")}</FormTitle>
      <FieldRow>
        <Field>
          <Label>{t("Name (slug)")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            placeholder="researcher"
            disabled={saving || !!initial}
          />
        </Field>
        <Field>
          <Label>{t("Display name")}</Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Researcher"
            disabled={saving}
          />
        </Field>
      </FieldRow>
      <Field>
        <Label>{t("Description")}</Label>
        <Input
          type="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("What this skill is for")}
          disabled={saving}
        />
      </Field>
      <Field>
        <Label>{t("System prompt fragment")}</Label>
        <Input
          type="textarea"
          value={systemPromptFragment}
          onChange={(e) => setFragment(e.target.value)}
          minHeight="10lh"
          placeholder="You are a careful research assistant…"
          disabled={saving}
        />
      </Field>
      <Field>
        <Label>{t("Tool names (one per line)")}</Label>
        <Input
          type="textarea"
          value={toolNames}
          onChange={(e) => setToolNames(e.target.value)}
          placeholder="search_documents\nlist_collections"
          disabled={saving}
        />
      </Field>
      <Field>
        <ToggleLabel>
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            disabled={saving}
          />
          {t("Use as default skill")}
        </ToggleLabel>
      </Field>
      <FormActions>
        <Button type="button" onClick={onCancel} disabled={saving} neutral>
          {t("Cancel")}
        </Button>
        <Button type="button" onClick={onSave} disabled={!canSave}>
          {saving ? t("Saving…") : t("Save")}
        </Button>
      </FormActions>
    </FormCard>
  );
});

/* -------------------------------------------------------------------------- */
/*  Styled primitives                                                         */
/* -------------------------------------------------------------------------- */

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
`;

const SkillRow = styled.div`
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  background: ${s("background")};
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const RowHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
`;

const RowMain = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const RowName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
  display: flex;
  align-items: center;
  gap: 8px;
`;

const RowSlug = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
`;

const DefaultPill = styled.span`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 3px;
  background: ${(p) => `${p.theme.accent}20`};
  color: ${(p) => p.theme.accent};
`;

const RowActions = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;

const ActionButton = styled.button<{ $danger?: boolean }>`
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid ${s("inputBorder")};
  background: transparent;
  color: ${(p) =>
    p.$danger ? (p.theme.danger ?? p.theme.error) : s("textSecondary")};
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${s("sidebarControlHoverBackground")};
  }
`;

const RowDescription = styled.div`
  font-size: 12px;
  color: ${s("textSecondary")};
  line-height: 1.5;
`;

const Fragment = styled.div`
  background: ${s("backgroundSecondary")};
  border-radius: 4px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const FragmentLabel = styled.span`
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: ${s("textTertiary")};
  letter-spacing: 0.4px;
`;

const FragmentBody = styled.div`
  font-size: 12px;
  color: ${s("text")};
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow: auto;
`;

const Tools = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const ToolPill = styled.span`
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 3px;
  background: ${s("backgroundSecondary")};
  color: ${s("textSecondary")};
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
`;

const Empty = styled.div`
  text-align: center;
  padding: 32px;
  color: ${s("textSecondary")};
  font-size: 13px;
`;

const FormCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  padding: 16px;
  margin-top: 16px;
`;

const FormTitle = styled.h3`
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
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

const ToggleLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: ${s("text")};
  cursor: pointer;
`;

const FormActions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
`;

export default observer(SkillsSettings);
