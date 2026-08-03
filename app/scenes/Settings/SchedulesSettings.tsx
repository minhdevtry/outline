import { observer } from "mobx-react";
import { ClockIcon, PlusIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import {
  CronEditor,
  SchedulerCard,
  type ScheduledJob,
} from "~/components/AIChat/SchedulerCard";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import useStores from "~/hooks/useStores";

function SchedulesSettings() {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const { agent } = useStores();
  const [editing, setEditing] = React.useState<ScheduledJob | "new" | null>(
    null
  );

  React.useEffect(() => {
    void agent.fetchSchedules();
  }, [agent]);

  const handleDelete = React.useCallback(
    async (id: string) => {
      if (!window.confirm(t("Delete this schedule?"))) {
        return;
      }
      await agent.deleteSchedule(id);
      toast.success(t("Schedule deleted"));
    },
    [agent, t]
  );

  const handleRunNow = React.useCallback(
    async (id: string) => {
      await agent.runScheduleNow(id);
      toast.success(t("Run triggered"));
    },
    [agent, t]
  );

  const handleToggle = React.useCallback(
    async (id: string, enabled: boolean) => {
      await agent.toggleSchedule(id, enabled);
    },
    [agent]
  );

  if (!team?.aiEnabled) {
    return (
      <Scene title={t("Schedules")} icon={<ClockIcon />}>
        <Heading>{t("Schedules")}</Heading>
        <Text as="p" type="secondary">
          {t("Enable AI in the team settings to manage agent schedules.")}
        </Text>
      </Scene>
    );
  }

  return (
    <Scene
      title={t("Schedules")}
      icon={<ClockIcon />}
      actions={
        editing ? null : (
          <Button
            type="button"
            onClick={() => setEditing("new")}
            icon={<PlusIcon />}
          >
            {t("New schedule")}
          </Button>
        )
      }
    >
      <Heading>{t("Schedules")}</Heading>
      <Text as="p" type="secondary">
        {t(
          "Run the agent on a cron schedule. The agent uses the prompt as its goal for each run."
        )}
      </Text>

      {editing && (
        <ScheduleForm
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void agent.fetchSchedules();
          }}
        />
      )}

      {agent.schedulesLoading && agent.schedules.length === 0 ? (
        <Empty>{t("Loading…")}</Empty>
      ) : agent.schedules.length === 0 && !editing ? (
        <Empty>
          {t("No schedules yet. Create one to run the agent on a cron.")}
        </Empty>
      ) : (
        <List>
          {agent.schedules.map((schedule) => (
            <SchedulerCard
              key={schedule.id}
              schedule={schedule}
              busy={false}
              onEdit={() => setEditing(schedule)}
              onDelete={() => void handleDelete(schedule.id)}
              onRunNow={() => void handleRunNow(schedule.id)}
              onToggle={(enabled) => void handleToggle(schedule.id, enabled)}
            />
          ))}
        </List>
      )}
    </Scene>
  );
}

/* -------------------------------------------------------------------------- */
/*  Schedule form — used for both create and edit.                            */
/* -------------------------------------------------------------------------- */

const ScheduleForm = observer(function ScheduleForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: ScheduledJob | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { agent } = useStores();
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(
    initial?.description ?? ""
  );
  const [cron, setCron] = React.useState(initial?.cron ?? "0 9 * * *");
  const [prompt, setPrompt] = React.useState(initial?.prompt ?? "");
  const [enabled, setEnabled] = React.useState(initial?.enabled ?? true);
  const [saving, setSaving] = React.useState(false);

  const canSave = name.trim() && cron.trim() && prompt.trim() && !saving;

  const onSave = async () => {
    if (!canSave) {
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        const res = await fetch("/api/agentSchedules.update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: initial.id,
            name: name.trim(),
            description: description.trim() || null,
            cron: cron.trim(),
            prompt: prompt.trim(),
            enabled,
          }),
        });
        if (!res.ok) {
          throw new Error("Update failed");
        }
        toast.success(t("Schedule updated"));
      } else {
        const id = await agent.createSchedule({
          name: name.trim(),
          description: description.trim() || undefined,
          cron: cron.trim(),
          prompt: prompt.trim(),
          enabled,
        });
        if (!id) {
          throw new Error("Create failed");
        }
        toast.success(t("Schedule created"));
      }
      onSaved();
    } catch {
      toast.error(t("Failed to save schedule"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormCard>
      <FormTitle>{initial ? t("Edit schedule") : t("New schedule")}</FormTitle>
      <Field>
        <Label>{t("Name")}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Daily standup summary")}
          disabled={saving}
        />
      </Field>
      <Field>
        <Label>{t("Description")}</Label>
        <Input
          type="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("Optional summary of what this run does")}
          disabled={saving}
        />
      </Field>
      <Field>
        <Label>{t("Cron expression")}</Label>
        <CronEditor value={cron} onChange={setCron} disabled={saving} />
      </Field>
      <Field>
        <Label>{t("Prompt")}</Label>
        <Input
          type="textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("What should the agent do each run?")}
          minHeight="8lh"
          disabled={saving}
        />
      </Field>
      <Field>
        <ToggleLabel>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={saving}
          />
          {t("Enabled")}
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

export default observer(SchedulesSettings);
