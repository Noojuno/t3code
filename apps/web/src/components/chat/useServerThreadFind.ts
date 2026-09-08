import type {
  EnvironmentId,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  ThreadId,
} from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { useDebouncedValue } from "~/state/queries";

/** Query atoms cancel obsolete requests; changing text never displays the previous query's count. */
export function useServerThreadFind(
  thread: { environmentId: EnvironmentId; threadId: ThreadId } | null,
  query: string,
  index: number,
  messages: readonly OrchestrationMessage[] | undefined,
  plans: readonly OrchestrationProposedPlan[] | undefined,
) {
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, 200);
  const atom =
    thread && debouncedQuery && normalizedQuery === debouncedQuery
      ? orchestrationEnvironment.threadFind({
          environmentId: thread.environmentId,
          input: { threadId: thread.threadId, query: debouncedQuery, index },
        })
      : null;
  const result = useEnvironmentQuery(atom);
  const { refresh } = result;
  const content = useMemo(() => ({ messages, plans }), [messages, plans]);
  const settledContent = useDebouncedValue(content, 300);
  const lastContent = useRef(settledContent);
  useEffect(() => {
    if (lastContent.current === settledContent) return;
    lastContent.current = settledContent;
    if (atom !== null) refresh();
  }, [atom, refresh, settledContent]);
  const key = thread
    ? JSON.stringify([thread.environmentId, thread.threadId, normalizedQuery])
    : null;
  const [previous, setPrevious] = useState({ key, data: result.data });
  if (
    previous.key !== key ||
    (result.data !== null && !result.isPending && previous.data !== result.data)
  ) {
    setPrevious({ key, data: result.data });
  }
  return {
    ...result,
    data: key === previous.key && !result.error ? (result.data ?? previous.data) : null,
    isPending:
      thread !== null &&
      normalizedQuery.length > 0 &&
      (normalizedQuery !== debouncedQuery || result.isPending),
  };
}
