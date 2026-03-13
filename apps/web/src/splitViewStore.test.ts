import { beforeEach, describe, expect, it } from "vitest";
import { ThreadId } from "@t3tools/contracts";

import { collectThreadIds, findLeafByThreadId, useSplitViewStore } from "./splitViewStore";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const THREAD_C = ThreadId.makeUnsafe("thread-c");
const THREAD_D = ThreadId.makeUnsafe("thread-d");

describe("splitViewStore workspaces", () => {
  beforeEach(() => {
    useSplitViewStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      group: null,
      dragOver: null,
      zoomed: false,
    });
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
  });

  it("creates multiple workspaces over time instead of reusing one global split", () => {
    useSplitViewStore.getState().splitThread(THREAD_A, THREAD_B, "horizontal", false);
    const firstWorkspaceId = useSplitViewStore.getState().activeWorkspaceId;

    useSplitViewStore.getState().deactivateWorkspace();
    useSplitViewStore.getState().splitThread(THREAD_C, THREAD_D, "vertical", false);

    const state = useSplitViewStore.getState();
    expect(state.workspaces).toHaveLength(2);
    expect(state.activeWorkspaceId).not.toBe(firstWorkspaceId);
    expect(state.group).not.toBeNull();
    expect(state.workspaces.map((workspace) => workspace.name)).toEqual([
      "Workspace 1",
      "Workspace 2",
    ]);
  });

  it("reuses the existing workspace when splitting a thread that is already in one", () => {
    useSplitViewStore.getState().splitThread(THREAD_A, THREAD_B, "horizontal", false);
    const firstWorkspaceId = useSplitViewStore.getState().activeWorkspaceId;
    expect(firstWorkspaceId).not.toBeNull();

    useSplitViewStore.getState().deactivateWorkspace();
    useSplitViewStore.getState().splitThread(THREAD_A, THREAD_C, "vertical", false);

    const state = useSplitViewStore.getState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.activeWorkspaceId).toBe(firstWorkspaceId);
    expect(state.group).not.toBeNull();
    expect(collectThreadIds(state.group!.root)).toEqual([THREAD_A, THREAD_C, THREAD_B]);
  });

  it("renames a workspace and keeps the active workspace in sync", () => {
    useSplitViewStore.getState().splitThread(THREAD_A, THREAD_B, "horizontal", false);
    const workspaceId = useSplitViewStore.getState().activeWorkspaceId;
    expect(workspaceId).not.toBeNull();

    useSplitViewStore.getState().renameWorkspace(workspaceId!, "Review Pair");

    const state = useSplitViewStore.getState();
    expect(state.workspaces[0]?.name).toBe("Review Pair");
    expect(state.group?.name).toBe("Review Pair");
  });

  it("updates workspace recency when activating a workspace", () => {
    useSplitViewStore.getState().splitThread(THREAD_A, THREAD_B, "horizontal", false);
    const workspaceId = useSplitViewStore.getState().activeWorkspaceId;
    expect(workspaceId).not.toBeNull();

    const initialVisitedAt = useSplitViewStore.getState().group?.lastVisitedAt;
    expect(initialVisitedAt).toBeTruthy();

    useSplitViewStore.getState().deactivateWorkspace();
    useSplitViewStore.getState().activateWorkspace(workspaceId!);

    const nextVisitedAt = useSplitViewStore.getState().group?.lastVisitedAt;
    expect(nextVisitedAt).toBeTruthy();
    expect(Date.parse(nextVisitedAt!)).toBeGreaterThanOrEqual(Date.parse(initialVisitedAt!));
  });

  it("drops a workspace when its final split is closed", () => {
    useSplitViewStore.getState().splitThread(THREAD_A, THREAD_B, "horizontal", false);
    const activeWorkspace = useSplitViewStore.getState().group;
    expect(activeWorkspace).not.toBeNull();

    const closingLeaf = findLeafByThreadId(activeWorkspace!.root, THREAD_B);
    expect(closingLeaf).not.toBeNull();

    const fallbackThreadId = useSplitViewStore.getState().closePane(closingLeaf!.id);
    const state = useSplitViewStore.getState();

    expect(fallbackThreadId).toBe(THREAD_A);
    expect(state.workspaces).toHaveLength(0);
    expect(state.activeWorkspaceId).toBeNull();
    expect(state.group).toBeNull();
  });

  it("preserves zoom when reconciling an unchanged thread set", () => {
    useSplitViewStore.getState().splitThread(THREAD_A, THREAD_B, "horizontal", false);
    useSplitViewStore.getState().toggleZoom();
    expect(useSplitViewStore.getState().zoomed).toBe(true);

    const remainingThreadId = useSplitViewStore
      .getState()
      .reconcileThreads(new Set([THREAD_A, THREAD_B]));

    expect(remainingThreadId).toBe(THREAD_B);
    expect(useSplitViewStore.getState().zoomed).toBe(true);
  });
});
