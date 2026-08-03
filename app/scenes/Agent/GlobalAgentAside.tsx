import { CloseIcon, SparklesIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components";
import { s } from "@shared/styles";
import useStores from "~/hooks/useStores";
import Agent from "./Agent";

/**
 * The legacy fixed-aside wrapper for the AI Agent. Mounted globally (outside
 * the document route) so the kbar action and Cmd+L shortcut can open the
 * panel from home, search, and settings pages. On document pages the
 * `DocumentAgent` wrapper is used instead, which participates in the
 * right-rail system and benefits from the slide-in animation and
 * `localStorage` persistence.
 *
 * Visibility is driven by the legacy `agent.panelOpen` flag; the right-rail
 * `ui.rightSidebar === "ai"` is the source of truth on document pages and
 * is set together via `AgentStore.openPanel/closePanel`.
 *
 * The body of the panel is now a thin chat surface (`ClineChatPanel`); the
 * legacy skill picker / plan card / scheduler surface was removed in
 * 2026-08.
 */
function GlobalAgentAside() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { agent } = useStores();

  if (!agent.panelOpen) {
    return null;
  }

  return (
    <Aside>
      <Header>
        <Title>
          <SparklesIcon color={theme.accent} size={18} />
          <strong>{t("AI Chat")}</strong>
        </Title>
        <IconButton
          type="button"
          onClick={() => agent.closePanel()}
          title={t("Close")}
          aria-label={t("Close")}
        >
          <CloseIcon size={16} color={theme.textTertiary} />
        </IconButton>
      </Header>
      <Agent />
    </Aside>
  );
}

const Aside = styled.aside`
  position: fixed;
  inset: 0 0 0 auto;
  width: 380px;
  max-width: 90vw;
  background: ${s("background")};
  border-left: 1px solid ${s("divider")};
  z-index: 100;
  display: flex;
  flex-direction: column;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.06);

  @media (max-width: 720px) {
    width: 100vw;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid ${s("divider")};
  flex-shrink: 0;
`;

const Title = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: ${s("text")};
`;

const IconButton = styled.button`
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

export default GlobalAgentAside;
