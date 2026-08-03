import { GlobeIcon, SparklesIcon } from "outline-icons";
import { t } from "i18next";
import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import type { MenuItem, SelectionContext } from "@shared/editor/types";
import stores from "~/stores";

const MAX_SELECTION_CHARS = 4_000;

/**
 * Returns the AI selection toolbar row. Rendered as a secondary compact row
 * below the formatting toolbar when the user has a non-empty text selection
 * inside an editable document, matching the Notion AI interaction model.
 *
 * Each item opens the right-rail agent panel and dispatches a pre-filled
 * prompt with the current document id and the selected text as context.
 * The agent decides what to do with the selection (it can call
 * `edit_document` to apply the change, or summarize, translate, etc.).
 */
/** Minimal ref of the document the user is currently viewing. */
type CurrentDocumentRef = { id: string; title: string };

export default function aiMenuItems(
  ctx: SelectionContext,
  view: EditorView | undefined,
  currentDocument: CurrentDocumentRef | undefined
): MenuItem[] {
  if (!view || !currentDocument || ctx.readOnly || ctx.isInCodeBlock) {
    return [];
  }

  const { from, to } = view.state.selection;
  if (!(view.state.selection instanceof TextSelection) || from === to) {
    return [];
  }

  const text = view.state.doc.cut(from, to).textContent;
  if (!text) {
    return [];
  }

  const selection = {
    from,
    to,
    text:
      text.length > MAX_SELECTION_CHARS
        ? `${text.slice(0, MAX_SELECTION_CHARS)}\n\n[truncated]`
        : text,
  };

  const send = (prompt: string) => {
    // Defer to next microtask so the click handler returns before the
    // panel mounts and the SSE connection opens.
    void Promise.resolve().then(() => {
      stores.agent.openPanel();
      void stores.agent.send(prompt, {
        currentDocumentId: currentDocument.id,
        currentSelection: selection,
      });
    });
  };

  return [
    {
      tooltip: t("Ask AI"),
      icon: <SparklesIcon />,
      visible: true,
      onClick: () => send("Đoạn văn này nói về gì? Tóm tắt và giải thích."),
    },
    {
      tooltip: t("Improve writing"),
      icon: <SparklesIcon />,
      visible: true,
      onClick: () =>
        send(
          "Improve this passage. Keep the same meaning, tighten the prose, and fix any grammar issues."
        ),
    },
    {
      tooltip: t("Translate"),
      icon: <GlobeIcon />,
      visible: true,
      onClick: () =>
        send(
          "Translate the following passage to Vietnamese (or the user's preferred language). Preserve formatting and code blocks."
        ),
    },
    {
      tooltip: t("Summarize"),
      icon: <SparklesIcon />,
      visible: true,
      onClick: () => send("Summarize the following passage in 2-3 sentences."),
    },
  ];
}
