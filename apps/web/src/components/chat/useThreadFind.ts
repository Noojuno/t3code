import type { InlineSkill } from "@t3tools/shared/inlineSkills";
import type { OrchestrationV2ThreadProjection, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { useDebouncedValue } from "~/state/queries";
import {
  stepThreadFindIndex,
  type ThreadFindPositionReader,
  type ThreadFindStart,
} from "./threadFind";
import { subscribeThreadFindOpen } from "./threadFindActionBus";
import { toastManager } from "../ui/toast";

const EMPTY_SKILLS: readonly InlineSkill[] = [];

const CLOSED_FIND = {
  threadKey: null as string | null,
  query: "",
  activeIndex: null as number | null,
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
    state.activeIndex,
    state.navigationId,
    state.start,
    content,
    skills,
  );
  const status: "loading" | "error" | null = remote.error
    ? "error"
    : remote.isPending && remote.data === null
      ? "loading"
      : null;
  const count = remote.data?.totalMatches ?? 0;
  const activeIndex = remote.data?.activeIndex ?? 0;
  const step = (delta: number) =>
    setState((previous) => ({
      ...previous,
      activeIndex: stepThreadFindIndex(previous.activeIndex ?? activeIndex, count, delta),
      navigationId: previous.navigationId + 1,
    }));

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
        setState((previous) => ({ ...previous, query, activeIndex: null, start }));
      },
      onNext: () => step(1),
      onPrevious: () => step(-1),
      onClose: close,
    },
    timelineProps: {
      findOpen: isOpen,
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
  index: number | null,
  navigationId: number,
  start: ThreadFindStart | undefined,
  content: Pick<OrchestrationV2ThreadProjection, "visibleTurnItems" | "runs"> | undefined,
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
            ...(index === null ? (start ? { start } : {}) : { index }),
            skills: skillLabels,
          },
        })
      : null;
  const result = useEnvironmentQuery(atom);
  const { refresh } = result;
  const messages = content?.visibleTurnItems;
  const plans = content?.runs;
  const revision = useMemo(() => ({ messages, plans }), [messages, plans]);
  const settledRevision = useDebouncedValue(revision, 300);
  const lastRevision = useRef(settledRevision);
  useEffect(() => {
    if (lastRevision.current === settledRevision) return;
    lastRevision.current = settledRevision;
    if (atom !== null) refresh();
  }, [atom, refresh, settledRevision]);
  const key = thread
    ? JSON.stringify([thread.environmentId, thread.threadId, normalizedQuery, start])
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
