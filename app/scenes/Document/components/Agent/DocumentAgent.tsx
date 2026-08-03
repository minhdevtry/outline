import { SparklesIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "styled-components";
import Flex from "~/components/Flex";
import SidebarLayout from "~/scenes/Document/components/SidebarLayout";
import useKeyDown from "~/hooks/useKeyDown";
import useStores from "~/hooks/useStores";
import { getFocusedSplitPane } from "~/utils/splitView";
import Agent from "~/scenes/Agent/Agent";

/**
 * The AI Agent panel as mounted in the document route's right sidebar. Uses
 * the same `SidebarLayout` chrome as Comments and History, so the panel
 * benefits from the same slide-in animation, mobile drawer, and
 * `localStorage` persistence.
 *
 * The body of the panel is now a thin chat surface (`ClineChatPanel`); the
 * legacy skill picker / plan card / scheduler surface was removed in
 * 2026-08.
 */
function DocumentAgent() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { ui } = useStores();

  const handleClose = () => {
    ui.setRightSidebar(null, getFocusedSplitPane());
  };

  useKeyDown("Escape", handleClose);

  return (
    <SidebarLayout
      title={
        <Flex align="center" gap={8}>
          <SparklesIcon color={theme.accent} size={18} />
          <strong>{t("AI Chat")}</strong>
        </Flex>
      }
      onClose={handleClose}
      scrollable={false}
    >
      <Agent />
    </SidebarLayout>
  );
}

export default DocumentAgent;
