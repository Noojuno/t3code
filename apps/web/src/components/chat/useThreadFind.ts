import type { InlineSkill } from "@t3tools/shared/inlineSkills";
import type { OrchestrationV2ThreadProjection, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { useDebouncedValue } from "~/state/queries";
import { type ThreadFindPositionReader, type ThreadFindStart } from "./threadFind";
import { subscribeThreadFindOpen } from "./threadFindActionBus";
import { toastManager } from "../ui/toast";

const EMPTY_SKILLS: readonly InlineSkill[] = [];

const CLOSED_FIND = {
  threadKey: null as string | null,
  query: "",
  offset: 0,
  start: undefined as ThreadFindStart | undefined,
  focusRequestId: 0,
  navigationId: 0,
};

/** Owns find state for the active thread and its environment. */
export function useThreadFind({
  thread,
  enabled,
  skills = EMPTY_SKILLS,
  content,
}: {
  thread: ScopedThreadRef | null;
  enabled: boolean;
  skills?: readonly InlineSkill[];
  content: Pick<OrchestrationV2ThreadProjection, "visibleTurnItems" | "runs"> | undefined;
}) {
  const findPositionReaderRef = useRef<ThreadFindPositionReader | null>(null);
  const threadKey = thread ? scopedThreadKey(thread) : null;
  const [state, setState] = useState(CLOSED_FIND);
  if (state.threadKey !== null && (!enabled || state.threadKey !== threadKey))
    setState(CLOSED_FIND);
  const isOpen = enabled && threadKey !== null && state.threadKey === threadKey;
  const open = useCallback(() => {
    if (threadKey === null) return;
    if (!enabled) {
      toastManager.add({
        id: "thread-find-unavailable",
        title: "Thread search is unavailable on this server.",
        description: "Update the server to enable it.",
      });
      return;
    }
    setState((previous) => ({
      ...(previous.threadKey === threadKey ? previous : CLOSED_FIND),
      threadKey,
      focusRequestId: previous.focusRequestId + 1,
    }));
  }, [enabled, threadKey]);
  const close = useCallback(() => setState(CLOSED_FIND), []);
  useEffect(() => subscribeThreadFindOpen(open), [open]);

  const remote = useServerResults(
    isOpen ? thread : null,
    state.query,
    state.offset,
    state.navigationId,
    state.start,
    skills,
  );
  const status: "loading" | "error" | null = remote.error
    ? "error"
    : remote.isPending && remote.data === null
      ? "loading"
      : null;
  const count = remote.data?.totalMatches ?? 0;
  const activeIndex = remote.data?.activeIndex ?? 0;
  const match = remote.data?.match ?? null;
  const step = (delta: number) => {
    if (count === 0) return;
    setState((previous) => {
      const pending = previous.navigationId !== remote.navigationId;
      return {
        ...previous,
        start:
          pending || !match
            ? previous.start
            : { entryId: match.entryId, occurrence: match.occurrence },
        offset: pending ? previous.offset + delta : delta,
        navigationId: previous.navigationId + 1,
      };
    });
  };

  // Refresh at most once per 300 ms, even while tokens continue arriving.
  // An identity anchor keeps newly inserted matches from shifting the selection.
  const refreshLiveResultsRef = useRef(() => {});
  useLayoutEffect(() => {
    refreshLiveResultsRef.current = () => {
      if (!isOpen || !state.query.trim()) return;
      if (!match || state.navigationId !== remote.navigationId) {
        remote.refresh();
        return;
      }
      const start = { entryId: match.entryId, occurrence: match.occurrence };
      if (
        state.offset === 0 &&
        state.start?.entryId === start.entryId &&
        state.start.occurrence === start.occurrence
      ) {
        remote.refresh();
      } else {
        setState((previous) => ({ ...previous, start, offset: 0 }));
      }
    };
  });
  const lastContentRef = useRef(content);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (lastContentRef.current === content) return;
    lastContentRef.current = content;
    if (!isOpen || !state.query.trim() || refreshTimerRef.current !== null) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      refreshLiveResultsRef.current();
    }, 300);
  }, [content, isOpen, state.query]);
  useEffect(() => {
    if (!isOpen || threadKey === null || !state.query.trim()) return;
    return () => {
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
  }, [threadKey, isOpen, state.query]);

  return {
    isOpen,
    open,
    close,
    barProps: {
      open: isOpen,
      query: state.query,
      matchCount: count,
      activeIndex,
      status,
      focusRequestId: state.focusRequestId,
      onRetry: remote.refresh,
      onQueryChange: (query: string) => {
        const start = findPositionReaderRef.current?.(query.trim());
        setState((previous) => ({ ...previous, query, offset: 0, start }));
      },
      onNext: () => step(1),
      onPrevious: () => step(-1),
      onClose: close,
    },
    timelineProps: {
      findOpen: isOpen,
      // Stays on between keystrokes so folded content does not collapse while results load.
      findExpanded: isOpen && state.query.trim().length > 0,
      findPositionReaderRef,
      findQuery: isOpen && remote.data?.match ? state.query : "",
      activeFindMatch: remote.data?.match ?? null,
      findNavigationId: remote.navigationId,
    },
  };
}

/** Query atoms cancel obsolete requests; navigation retains only the current query's result. */
function useServerResults(
  thread: ScopedThreadRef | null,
  query: string,
  offset: number,
  navigationId: number,
  start: ThreadFindStart | undefined,
  skills: readonly InlineSkill[],
) {
  const skillLabels = useMemo(
    () => skills.map(({ name, displayName }) => ({ name, displayName })),
    [skills],
  );
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, 200);
  const atom =
    thread && debouncedQuery && normalizedQuery === debouncedQuery
      ? orchestrationEnvironment.threadFind({
          environmentId: thread.environmentId,
          input: {
            threadId: thread.threadId,
            query: debouncedQuery,
            ...(start ? { start } : {}),
            ...(offset !== 0 ? { offset } : {}),
            skills: skillLabels,
          },
        })
      : null;
  const result = useEnvironmentQuery(atom);
  const key = thread
    ? JSON.stringify([thread.environmentId, thread.threadId, normalizedQuery, skillLabels])
    : null;
  const [previous, setPrevious] = useState({
    key,
    data: result.data,
    navigationId,
  });
  if (
    previous.key !== key ||
    (result.data !== null &&
      !result.isPending &&
      (previous.data !== result.data || previous.navigationId !== navigationId))
  ) {
    const response = result.data;
    setPrevious({
      key,
      data: response,
      navigationId,
    });
  }
  return {
    ...result,
    data: key === previous.key && !result.error ? previous.data : null,
    navigationId: previous.navigationId,
    isPending:
      thread !== null &&
      normalizedQuery.length > 0 &&
      (normalizedQuery !== debouncedQuery || result.isPending),
  };
}
