import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  PlanId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2SearchThreadInput,
  type OrchestrationV2SearchThreadResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useThreadFind } from "./useThreadFind";

const queries = vi.hoisted(() => ({
  results: new Map<string, OrchestrationV2SearchThreadResult>(),
}));
vi.mock("~/state/orchestration", () => ({
  orchestrationEnvironment: {
    threadFind: (input: {
      environmentId: EnvironmentId;
      input: OrchestrationV2SearchThreadInput;
    }) => input,
  },
}));
vi.mock("~/state/queries", () => ({ useDebouncedValue: <T,>(value: T) => value }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (atom: { environmentId: EnvironmentId } | null) => ({
    data: atom === null ? null : (queries.results.get(atom.environmentId) ?? null),
    isPending: false,
    error: null,
    refresh: () => {},
  }),
}));

let renderer: ReactTestRenderer | undefined;
let find: ReturnType<typeof useThreadFind>;
const a = EnvironmentId.make("environment:a");
const b = EnvironmentId.make("environment:b");
const threadId = ThreadId.make("shared-thread");
const runId = RunId.make("run:plan");
const now = DateTime.makeUnsafe("2026-10-01T00:00:00Z");
const entries: Parameters<typeof useThreadFind>[0]["entries"] = [];
function Probe({ environmentId }: { environmentId: EnvironmentId }) {
  const state = useThreadFind({
    thread: { environmentId, threadId },
    serverSearch: true,
    cwd: "/repo",
    content: undefined,
    entries,
    history: null,
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
  vi.unstubAllGlobals();
});

describe("V2 find state", () => {
  it("derives a plan result with the timeline item ID and run ownership", async () => {
    queries.results.set(a, {
      snapshotSequence: 9,
      totalMatches: 1,
      activeIndex: 0,
      match: { entryId: "plan-item", runId, occurrence: 0 },
      items: [
        {
          position: 8,
          sourceThreadId: threadId,
          sourceItemId: TurnItemId.make("plan-item"),
          visibility: "local",
          item: {
            id: TurnItemId.make("plan-item"),
            threadId,
            runId,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 9,
            status: "completed",
            title: null,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
            type: "proposed_plan",
            planId: PlanId.make("plan-artifact"),
            markdown: "# Release\nneedle",
            streaming: false,
          },
        },
      ],
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
    const entry = find.timelineProps.searchEntries?.[0];
    expect(entry?.id).toBe("plan-item");
    expect(entry?.kind).toBe("proposed-plan");
    if (entry?.kind === "proposed-plan") {
      expect(entry.proposedPlan.id).toBe("plan-artifact");
      expect(entry.proposedPlan.runId).toBe(runId);
    }
    await act(async () => {
      find.close();
    });
    expect(find.timelineProps.searchEntries).toBeNull();
    expect(find.timelineProps.findQuery).toBe("");
  });

  it("drops results on environment changes even when the thread IDs are identical", async () => {
    queries.results.set(a, {
      snapshotSequence: 1,
      totalMatches: 3,
      activeIndex: 0,
      match: null,
      items: [],
    });
    queries.results.set(b, {
      snapshotSequence: 2,
      totalMatches: 0,
      activeIndex: 0,
      match: null,
      items: [],
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
    expect(find.timelineProps.searchEntries).toBeNull();
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
