import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  RunId,
  ThreadId,
  type OrchestrationV2SearchThreadInput,
  type OrchestrationV2SearchThreadResult,
} from "@t3tools/contracts";
import { useThreadFind } from "./useThreadFind";
import { orchestrationEnvironment } from "~/state/orchestration";
import { requestThreadFindOpen } from "./threadFindActionBus";

const queries = vi.hoisted(() => ({
  results: new Map<string, OrchestrationV2SearchThreadResult>(),
  pending: false,
}));
vi.mock("~/state/orchestration", () => ({
  orchestrationEnvironment: {
    threadFind: vi.fn(
      (input: { environmentId: EnvironmentId; input: OrchestrationV2SearchThreadInput }) => input,
    ),
  },
}));
vi.mock("~/state/queries", () => ({ useDebouncedValue: <T,>(value: T) => value }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (atom: { environmentId: EnvironmentId } | null) => ({
    data: atom === null ? null : (queries.results.get(atom.environmentId) ?? null),
    isPending: queries.pending,
    error: null,
    refresh: () => {},
  }),
}));

vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));

let renderer: ReactTestRenderer | undefined;
let find: ReturnType<typeof useThreadFind>;
const a = EnvironmentId.make("environment:a");
const b = EnvironmentId.make("environment:b");
const threadId = ThreadId.make("shared-thread");
const runId = RunId.make("run:plan");
function Probe({
  environmentId,
  enabled = true,
}: {
  environmentId: EnvironmentId;
  enabled?: boolean;
}) {
  const state = useThreadFind({
    thread: { environmentId, threadId },
    enabled,
    content: undefined,
  });
  useLayoutEffect(() => {
    find = state;
  });
  return null;
}
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = undefined;
  queries.results.clear();
  queries.pending = false;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("V2 find state", () => {
  function messageResult(index: number, snapshotSequence = 9): OrchestrationV2SearchThreadResult {
    return {
      snapshotSequence,
      totalMatches: 10,
      activeIndex: index,
      match: { entryId: `message:${index + 2}`, runId, occurrence: 0 },
    };
  }

  it("starts from the viewport and steps from the server-selected match", async () => {
    queries.results.set(a, messageResult(4));
    await act(async () => {
      renderer = create(<Probe environmentId={a} />);
    });
    await act(async () => find.open());
    find.timelineProps.findPositionReaderRef.current = () => ({
      entryId: "message:6",
      occurrence: 1,
    });
    await act(async () => find.barProps.onQueryChange("COD4"));
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: {
        threadId,
        query: "COD4",
        skills: [],
        start: { entryId: "message:6", occurrence: 1 },
      },
    });
    expect(find.barProps.activeIndex).toBe(4);
    queries.results.set(a, messageResult(5));
    await act(async () => find.barProps.onNext());
    expect(orchestrationEnvironment.threadFind).toHaveBeenLastCalledWith({
      environmentId: a,
      input: { threadId, query: "COD4", skills: [], index: 5 },
    });
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("message:7");
    queries.results.set(a, messageResult(4));
    await act(async () => find.barProps.onPrevious());
    expect(find.barProps.activeIndex).toBe(4);
  });

  it("does not navigate the previous result while a new match is loading", async () => {
    queries.results.set(a, messageResult(0));
    await act(async () => {
      renderer = create(<Probe environmentId={a} />);
    });
    await act(async () => find.open());
    await act(async () => find.barProps.onQueryChange("COD4"));
    queries.pending = true;
    queries.results.delete(a);
    await act(async () => find.barProps.onNext());
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("message:2");
    expect(find.timelineProps.findNavigationId).toBe(0);
    expect(find.barProps.status).toBeNull();
    expect(find.barProps.activeIndex).toBe(0);
    expect(find.barProps.matchCount).toBe(10);
    queries.pending = false;
    queries.results.set(a, messageResult(1));
    await act(async () => renderer?.update(<Probe environmentId={a} />));
    expect(find.timelineProps.activeFindMatch?.entryId).toBe("message:3");
    expect(find.timelineProps.findNavigationId).toBe(1);
  });

  it("shows Searching only when the query has no result yet", async () => {
    queries.pending = true;
    await act(async () => {
      renderer = create(<Probe environmentId={a} />);
    });
    await act(async () => find.open());
    await act(async () => find.barProps.onQueryChange("COD4"));
    expect(find.barProps.status).toBe("loading");
    queries.pending = false;
    queries.results.set(a, messageResult(0));
    await act(async () => renderer?.update(<Probe environmentId={a} />));
    expect(find.barProps.status).toBeNull();
    queries.pending = true;
    queries.results.delete(a);
    await act(async () => find.barProps.onQueryChange("different query"));
    expect(find.barProps.status).toBe("loading");
    expect(find.barProps.matchCount).toBe(0);
  });

  it("keeps search unavailable when the server does not support it", async () => {
    await act(async () => {
      renderer = create(<Probe environmentId={a} enabled={false} />);
    });
    await act(async () => {
      find.open();
      requestThreadFindOpen();
    });
    expect(find.isOpen).toBe(false);
    expect(find.timelineProps.activeFindMatch).toBeNull();
    expect(orchestrationEnvironment.threadFind).not.toHaveBeenCalled();
  });

  it("closes search when support disappears without restoring stale queries", async () => {
    await act(async () => {
      renderer = create(<Probe environmentId={a} />);
    });
    await act(async () => find.open());
    await act(async () => find.barProps.onQueryChange("needle"));
    expect(find.isOpen).toBe(true);
    vi.mocked(orchestrationEnvironment.threadFind).mockClear();
    await act(async () => {
      renderer?.update(<Probe environmentId={a} enabled={false} />);
    });
    expect(find.isOpen).toBe(false);
    expect(find.timelineProps.activeFindMatch).toBeNull();
    expect(find.timelineProps.findQuery).toBe("");
    expect(orchestrationEnvironment.threadFind).not.toHaveBeenCalled();
    await act(async () => {
      renderer?.update(<Probe environmentId={a} />);
    });
    expect(find.isOpen).toBe(false);
    await act(async () => find.open());
    expect(find.barProps.query).toBe("");
  });

  it("preserves plan item ID and run ownership for navigation", async () => {
    queries.results.set(a, {
      snapshotSequence: 9,
      totalMatches: 1,
      activeIndex: 0,
      match: { entryId: "plan-item", runId, occurrence: 0 },
    });
    await act(async () => {
      renderer = create(<Probe environmentId={a} />);
    });
    await act(async () => {
      find.open();
    });
    await act(async () => {
      find.barProps.onQueryChange("needle");
    });
    expect(find.timelineProps.activeFindMatch).toEqual({
      entryId: "plan-item",
      runId,
      occurrence: 0,
    });
    await act(async () => {
      find.close();
    });
    expect(find.timelineProps.activeFindMatch).toBeNull();
    expect(find.timelineProps.findQuery).toBe("");
  });

  it("drops results on environment changes even when the thread IDs are identical", async () => {
    queries.results.set(a, {
      snapshotSequence: 1,
      totalMatches: 3,
      activeIndex: 0,
      match: null,
    });
    queries.results.set(b, {
      snapshotSequence: 2,
      totalMatches: 0,
      activeIndex: 0,
      match: null,
    });
    await act(async () => {
      renderer = create(<Probe environmentId={a} />);
    });
    await act(async () => {
      find.open();
    });
    await act(async () => {
      find.barProps.onQueryChange("needle");
    });
    expect(find.barProps.matchCount).toBe(3);
    await act(async () => {
      renderer?.update(<Probe environmentId={b} />);
    });
    expect(find.isOpen).toBe(false);
    expect(find.timelineProps.activeFindMatch).toBeNull();
    await act(async () => {
      find.open();
    });
    await act(async () => {
      find.barProps.onQueryChange("needle");
    });
    expect(find.barProps.matchCount).toBe(0);
    await act(async () => {
      renderer?.update(<Probe environmentId={a} />);
    });
    expect(find.isOpen).toBe(false);
  });
});
