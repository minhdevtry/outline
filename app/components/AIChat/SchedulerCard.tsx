import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";

/* -------------------------------------------------------------------------- */
/*  SchedulerCard — renders one scheduled agent run.                          */
/* -------------------------------------------------------------------------- */

export interface ScheduledJob {
  id: string;
  name: string;
  description?: string | null;
  cron: string;
  prompt: string;
  enabled: boolean;
  agentId: string;
  nextRunAt: string;
  lastRunAt?: string | null;
}

export interface SchedulerCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onSelect"
> {
  schedule: ScheduledJob;
  /** Toggle the schedule on/off. */
  onToggle: (enabled: boolean) => void;
  /** Run the schedule now (sets `nextRunAt` to current time). */
  onRunNow: () => void;
  /** Delete the schedule. */
  onDelete: () => void;
  /** Edit the schedule (parent shows the form). */
  onEdit: () => void;
  /** Whether a mutation is in flight (disables buttons). */
  busy?: boolean;
}

/**
 * Card for one scheduled agent run. Mirrors Cline's job-card pattern
 * (`Cometline JobCard.svelte`) — clamped-name title, status pill,
 * workspace, last-run timestamp. Inline action buttons replace the
 * hover-revealed approach since cards are rare (1 per workspace).
 */
export const SchedulerCard = observer(function SchedulerCard(
  props: SchedulerCardProps
) {
  const {
    schedule,
    onToggle,
    onRunNow,
    onDelete,
    onEdit,
    busy,
    className,
    ...rest
  } = props;

  return (
    <Card
      className={["cline-schedule-card", className].filter(Boolean).join(" ")}
      {...rest}
    >
      <Header>
        <HeaderMain>
          <HeaderName>{schedule.name}</HeaderName>
          {schedule.description ? (
            <HeaderDesc>{schedule.description}</HeaderDesc>
          ) : null}
          <Meta>
            <MetaLabel>Cron</MetaLabel>
            <CronExpr>{schedule.cron}</CronExpr>
          </Meta>
          <Meta>
            <MetaLabel>Next run</MetaLabel>
            <MetaValue>{formatRelative(schedule.nextRunAt)}</MetaValue>
          </Meta>
          {schedule.lastRunAt ? (
            <Meta>
              <MetaLabel>Last run</MetaLabel>
              <MetaValue>{formatRelative(schedule.lastRunAt)}</MetaValue>
            </Meta>
          ) : null}
        </HeaderMain>
        <StatusPill $enabled={schedule.enabled}>
          {schedule.enabled ? "Enabled" : "Disabled"}
        </StatusPill>
      </Header>
      <PromptPreview>
        <PromptLabel>Prompt</PromptLabel>
        <PromptText>{schedule.prompt}</PromptText>
      </PromptPreview>
      <Actions>
        <ActionButton
          type="button"
          $variant="secondary"
          disabled={busy}
          onClick={onEdit}
        >
          Edit
        </ActionButton>
        <ActionButton
          type="button"
          $variant="secondary"
          disabled={busy}
          onClick={onDelete}
        >
          Delete
        </ActionButton>
        <ActionButton
          type="button"
          $variant="primary"
          disabled={busy || !schedule.enabled}
          onClick={onRunNow}
        >
          Run now
        </ActionButton>
        <ToggleButton
          type="button"
          $enabled={schedule.enabled}
          disabled={busy}
          onClick={() => onToggle(!schedule.enabled)}
          aria-label={schedule.enabled ? "Disable schedule" : "Enable schedule"}
        >
          <ToggleThumb $enabled={schedule.enabled} />
        </ToggleButton>
      </Actions>
    </Card>
  );
});

function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString();
}

/* -------------------------------------------------------------------------- */
/*  CronEditor — small inline cron-expression input.                         */
/* -------------------------------------------------------------------------- */

export interface CronEditorProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/** Lightweight 5-field cron input with a "common presets" menu. The
 * presets are intentionally not exhaustive — common workflows only. */
const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at 09:00", value: "0 9 * * *" },
  { label: "Every Monday at 09:00", value: "0 9 * * 1" },
  { label: "First of the month at 09:00", value: "0 9 1 * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
];

export const CronEditor = observer(function CronEditor(props: CronEditorProps) {
  const { value, onChange, disabled } = props;
  return (
    <CronRow>
      <CronInput
        type="text"
        value={value}
        disabled={disabled}
        placeholder="e.g. 0 9 * * 1 (Mondays at 09:00)"
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <PresetSelect
        value=""
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value) {
            onChange(e.target.value);
          }
        }}
      >
        <option value="">Presets…</option>
        {CRON_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </PresetSelect>
    </CronRow>
  );
});

/* -------------------------------------------------------------------------- */
/*  Styled primitives                                                         */
/* -------------------------------------------------------------------------- */

const Card = styled.div`
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  background: ${s("background")};
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
`;

const HeaderMain = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const HeaderName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
`;

const HeaderDesc = styled.div`
  font-size: 12px;
  color: ${s("textSecondary")};
  line-height: 1.4;
`;

const Meta = styled.div`
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 11px;
`;

const MetaLabel = styled.span`
  color: ${s("textTertiary")};
  text-transform: uppercase;
  letter-spacing: 0.4px;
  font-weight: 600;
  font-size: 10px;
`;

const MetaValue = styled.span`
  color: ${s("textSecondary")};
`;

const CronExpr = styled.span`
  color: ${s("text")};
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 11px;
`;

const StatusPill = styled.span<{ $enabled: boolean }>`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 3px 8px;
  border-radius: 3px;
  background: ${(p) =>
    p.$enabled ? `${p.theme.success}20` : `${p.theme.textTertiary}20`};
  color: ${(p) => (p.$enabled ? p.theme.success : s("textTertiary"))};
  flex-shrink: 0;
`;

const PromptPreview = styled.div`
  background: ${s("backgroundSecondary")};
  border-radius: 4px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const PromptLabel = styled.span`
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: ${s("textTertiary")};
  letter-spacing: 0.4px;
`;

const PromptText = styled.div`
  font-size: 12px;
  color: ${s("text")};
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
`;

const Actions = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
`;

const ActionButton = styled.button<{ $variant: "primary" | "secondary" }>`
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid
    ${(p) => (p.$variant === "primary" ? p.theme.accent : p.theme.inputBorder)};
  background: ${(p) =>
    p.$variant === "primary" ? `${p.theme.accent}15` : "transparent"};
  color: ${(p) =>
    p.$variant === "primary" ? p.theme.accent : s("textSecondary")};
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${(p) =>
      p.$variant === "primary"
        ? `${p.theme.accent}25`
        : s("sidebarControlHoverBackground")};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ToggleButton = styled.button<{ $enabled: boolean }>`
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: 1px solid
    ${(p) => (p.$enabled ? `${p.theme.success}60` : s("inputBorder"))};
  background: ${(p) =>
    p.$enabled ? `${p.theme.success}30` : s("backgroundSecondary")};
  margin-left: auto;
  padding: 0;
  cursor: pointer;
  transition:
    background 100ms ease-out,
    border-color 100ms ease-out;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ToggleThumb = styled.span<{ $enabled: boolean }>`
  position: absolute;
  top: 1px;
  left: ${(p) => (p.$enabled ? "17px" : "1px")};
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: ${(p) => (p.$enabled ? p.theme.success : s("textTertiary"))};
  transition:
    left 100ms ease-out,
    background 100ms ease-out;
`;

const CronRow = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
`;

const CronInput = styled.input`
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 12px;
  padding: 5px 8px;
  border-radius: 4px;
  border: 1px solid ${(p) => p.theme.inputBorder};
  background: ${(p) => p.theme.background};
  color: ${(p) => p.theme.text};

  &:focus {
    outline: 2px solid ${(p) => p.theme.accent};
    outline-offset: -1px;
  }
`;

const PresetSelect = styled.select`
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid ${(p) => p.theme.inputBorder};
  background: ${(p) => p.theme.background};
  color: ${(p) => p.theme.text};
`;
export default SchedulerCard;
