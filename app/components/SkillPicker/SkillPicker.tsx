import {
  BeakerIcon,
  CodeIcon,
  EditIcon,
  DocumentIcon,
  SearchIcon,
  SparklesIcon,
} from "outline-icons";
import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components";
import { s } from "@shared/styles";
import Flex from "~/components/Flex";
import {
  Menu,
  MenuContent,
  MenuLabel,
  MenuSeparator,
} from "~/components/primitives/Menu";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import type { AgentSkill } from "~/stores/AgentStore";

/**
 * Icon map for skill icons. Falls back to SparklesIcon for unknown names
 * or when the skill doesn't set one. Centralized here so the icon set
 * is consistent across the panel and any future settings UI.
 */
const SKILL_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  SparklesIcon,
  BeakerIcon,
  CodeIcon,
  EditIcon,
  SearchIcon,
  DocumentIcon,
};

function SkillIcon({
  name,
  size = 14,
  color,
}: {
  name: string | null;
  size?: number;
  color?: string;
}) {
  const Icon = (name && SKILL_ICONS[name]) || SparklesIcon;
  return <Icon size={size} color={color} />;
}

/**
 * Chip-style skill picker. Renders the active skill as a compact button
 * with an icon + display name; click opens a menu of all available skills
 * with descriptions and an active check. Styled to fit the right-rail
 * panel header alongside the title and other actions.
 */
function SkillPicker() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { agent } = useStores();
  const active = agent.activeSkill;
  const hasSkills = agent.skills.length > 1;

  // Auto-load the skill list the first time the chip renders.
  React.useEffect(() => {
    void agent.fetchSkills();
  }, [agent]);

  if (!active) {
    return null;
  }

  return (
    <Menu>
      <TooltipLabel content={t("Active skill")}>
        <Trigger
          type="button"
          aria-label={t("Change active skill")}
          $accent={active.color ?? undefined}
        >
          <SkillIcon name={active.icon} color={active.color ?? theme.accent} />
          <TriggerLabel>{active.displayName}</TriggerLabel>
          <Chevron size={10} color={theme.textTertiary} />
        </Trigger>
      </TooltipLabel>
      <MenuContent
        align="start"
        sideOffset={6}
        style={{ minWidth: 280, maxWidth: 360 }}
      >
        <MenuLabel>{t("Active skill")}</MenuLabel>
        <MenuSeparator />
        {agent.skills.map((skill) => (
          <SkillRow
            key={skill.id}
            skill={skill}
            active={skill.id === active.id}
            onSelect={() => agent.setActiveSkill(skill.id)}
          />
        ))}
        {!hasSkills && (
          <EmptyNote>
            {t(
              "No other skills available yet. Admins can create them in Settings → AI."
            )}
          </EmptyNote>
        )}
      </MenuContent>
    </Menu>
  );
}

const SkillRow = observer(function SkillRow({
  skill,
  active,
  onSelect,
}: {
  skill: AgentSkill;
  active: boolean;
  onSelect: () => void;
}) {
  const theme = useTheme();
  return (
    <SkillRowButton
      type="button"
      role="menuitem"
      onClick={onSelect}
      $active={active}
    >
      <Flex gap={10} align="flex-start">
        <SkillIcon
          name={skill.icon}
          color={active ? (skill.color ?? theme.accent) : theme.textSecondary}
        />
        <Flex column gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Flex justify="space-between" align="center" gap={6}>
            <Name $active={active}>{skill.displayName}</Name>
            {active ? <CheckMark color={theme.accent}>✓</CheckMark> : null}
          </Flex>
          {skill.description ? <Desc>{skill.description}</Desc> : null}
        </Flex>
      </Flex>
    </SkillRowButton>
  );
});

/** Lightweight tooltip wrapper around the trigger (no UI primitive dep). */
const TooltipLabel = (props: {
  content: string;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = React.useState(false);
  return (
    <TipWrap
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {props.children}
      {open ? <Tip>{props.content}</Tip> : null}
    </TipWrap>
  );
};

export default observer(SkillPicker);

const Trigger = styled.button<{ $accent?: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 6px;
  background: ${(p) =>
    p.$accent ? `${p.$accent}15` : p.theme.backgroundSecondary};
  border: 1px solid
    ${(p) => (p.$accent ? `${p.$accent}40` : p.theme.inputBorder)};
  border-radius: 999px;
  color: ${() => s("text")};
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition:
    background 80ms ease-out,
    border-color 80ms ease-out;

  &:hover {
    background: ${(p) =>
      p.$accent ? `${p.$accent}22` : p.theme.sidebarControlHoverBackground};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.accent};
    outline-offset: 2px;
  }
`;

const TriggerLabel = styled.span`
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Chevron = styled.span<{ size: number; color?: string }>`
  display: inline-block;
  border-left: ${(p) => p.size / 2}px solid transparent;
  border-right: ${(p) => p.size / 2}px solid transparent;
  border-top: ${(p) => p.size / 2}px solid ${(p) => p.color ?? "currentColor"};
  margin-left: 2px;
`;

const Name = styled.span<{ $active: boolean }>`
  font-size: 12px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  color: ${(p) => (p.$active ? s("text") : s("textSecondary"))};
`;

const SkillRowButton = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: flex-start;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: ${(p) => (p.$active ? p.theme.accent + "12" : "transparent")};
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: background 60ms ease-out;

  &:hover {
    background: ${(p) =>
      p.$active
        ? p.theme.accent + "1c"
        : p.theme.sidebarControlHoverBackground};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.accent};
    outline-offset: -2px;
  }
`;

const Desc = styled(Text)`
  font-size: 11px;
  line-height: 1.4;
  color: ${s("textTertiary")};
`;

const CheckMark = styled.span<{ color: string }>`
  font-size: 11px;
  font-weight: 700;
  color: ${(p) => p.color};
`;

const EmptyNote = styled.div`
  font-size: 11px;
  color: ${s("textTertiary")};
  padding: 8px 10px;
  line-height: 1.5;
`;

const TipWrap = styled.span`
  position: relative;
  display: inline-flex;
`;

const Tip = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: ${s("tooltipBackground")};
  color: ${s("tooltipText")};
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1000;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
`;
