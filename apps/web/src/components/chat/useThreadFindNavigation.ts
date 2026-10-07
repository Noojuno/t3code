import type { LegendListRef } from "@legendapp/list/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ThreadFindMatch } from "./threadFind";
import { useThreadFindHighlights } from "./threadFindHighlights";

const FIND_MATCH_VIEW_MARGIN = 96;

/** Materializes missing results and otherwise scrolls only enough to reveal the active text. */
export function useThreadFindNavigation({
  container,
  query,
  match,
  navigationId,
  rowIndex,
  entries,
  listRef,
  contentInsetEndAdjustment,
  listReady,
  historyControls,
}: {
  container: HTMLElement | null;
  query: string;
  match: ThreadFindMatch | null;
  navigationId: number;
  rowIndex: number;
  entries: readonly { readonly id: string }[];
  listRef: RefObject<LegendListRef | null>;
  contentInsetEndAdjustment: number;
  listReady: boolean;
  historyControls?:
    | {
        readonly hasMoreHistory: boolean;
        readonly loading: boolean;
        readonly error: string | null;
        readonly onLoadEarlier: () => void;
      }
    | undefined;
}) {
  const matchKey = match ? `${navigationId}:${query}:${match.entryId}:${match.occurrence}` : null;
  const positionedMatchRef = useRef<string | null>(null);
  const [positionedMatchKey, setPositionedMatchKey] = useState<string | null>(null);
  const revealedMatchRef = useRef<string | null>(null);
  const positionedEntriesRef = useRef<typeof entries | null>(null);
  const requestedPagesRef = useRef<{ key: string | null; pages: Set<string> }>({
    key: null,
    pages: new Set(),
  });
  useEffect(() => {
    if (requestedPagesRef.current.key !== matchKey)
      requestedPagesRef.current = { key: matchKey, pages: new Set() };
    if (
      !match ||
      !listReady ||
      rowIndex >= 0 ||
      entries.some((entry) => entry.id === match.entryId)
    )
      return;
    if (!historyControls?.hasMoreHistory || historyControls.loading || historyControls.error)
      return;
    const cursor = entries[0]?.id ?? "first";
    if (requestedPagesRef.current.pages.has(cursor)) return;
    requestedPagesRef.current.pages.add(cursor);
    historyControls.onLoadEarlier();
  }, [entries, historyControls, listReady, match, matchKey, rowIndex]);
  const reveal = useCallback(
    (range: Range | null) => {
      if (!matchKey) {
        positionedMatchRef.current = null;
        revealedMatchRef.current = null;
        return;
      }
      if (revealedMatchRef.current === matchKey) return;
      if (!listReady || rowIndex < 0) return;
      const materialize = () => {
        const list = listRef.current;
        if (rowIndex < 0 || !list || positionedMatchRef.current === matchKey) return;
        positionedMatchRef.current = matchKey;
        void list
          .scrollToIndex({
            index: rowIndex,
            animated: false,
            viewOffset: FIND_MATCH_VIEW_MARGIN,
          })
          .then(() => {
            if (positionedMatchRef.current !== matchKey) return;
            positionedEntriesRef.current = entries;
            setPositionedMatchKey(matchKey);
          });
      };
      if (!range) {
        if (container) materialize();
        return;
      }

      const codeScroller = range.startContainer.parentElement?.closest("pre");
      if (codeScroller) {
        const rect = range.getBoundingClientRect();
        const viewport = codeScroller.getBoundingClientRect();
        if (rect.left < viewport.left) codeScroller.scrollLeft += rect.left - viewport.left - 16;
        else if (rect.right > viewport.right)
          codeScroller.scrollLeft += rect.right - viewport.right + 16;
      }
      const rect = range.getBoundingClientRect();
      const viewport = container?.getBoundingClientRect();
      if (!viewport || rect.height === 0) return;
      const top = viewport.top + FIND_MATCH_VIEW_MARGIN;
      const bottom = viewport.bottom - FIND_MATCH_VIEW_MARGIN - contentInsetEndAdjustment;
      const delta =
        rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
      // A new list can expose DOM text before its virtual row sizes settle.
      // Await row positioning before measuring an offscreen occurrence.
      if (
        Math.abs(delta) >= 1 &&
        positionedEntriesRef.current !== entries &&
        positionedMatchKey !== matchKey
      ) {
        materialize();
        return;
      }
      const scroll = listRef.current?.getState?.().scroll;
      positionedEntriesRef.current = entries;
      revealedMatchRef.current = matchKey;
      if (Math.abs(delta) >= 1 && typeof scroll === "number") {
        listRef.current?.scrollToOffset({ offset: scroll + delta, animated: false });
      }
    },
    [
      container,
      contentInsetEndAdjustment,
      entries,
      listRef,
      listReady,
      matchKey,
      positionedMatchKey,
      rowIndex,
    ],
  );

  useThreadFindHighlights({
    container,
    query,
    activeRowId: match?.entryId ?? null,
    activeOccurrence: match?.occurrence ?? 0,
    onActiveRange: reveal,
  });
}
