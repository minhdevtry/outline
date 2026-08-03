import { matchPath, useLocation } from "react-router-dom";
import useStores from "./useStores";
import { matchDocumentSlug } from "~/utils/routeHelpers";

/**
 * Resolves the document the user is currently viewing, if any. Returns
 * `undefined` for every field when the user is not on a document route.
 *
 * Phase 0: only `id` and `title` are populated. Phase 1 will populate `text`
 * with the current editor selection.
 *
 * @returns the current document's id, title, and (Phase 1+) selected text.
 */
export function useCurrentDocument() {
  const location = useLocation();
  const { documents } = useStores();
  const slugMatch = matchPath<{ documentSlug: string }>(location.pathname, {
    path: `/doc/${matchDocumentSlug}`,
  });
  if (!slugMatch) {
    return { id: undefined, title: undefined, text: undefined };
  }
  const doc = documents.get(slugMatch.params.documentSlug);
  if (!doc) {
    return { id: undefined, title: undefined, text: undefined };
  }
  return {
    id: doc.id,
    title: doc.title,
    text: undefined,
  };
}
