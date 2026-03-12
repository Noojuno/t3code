import { beforeEach, describe, expect, it } from "vitest";
import { ThreadId } from "@t3tools/contracts";

import { findLeafByThreadId, useSplitViewStore } from "./splitViewStore";

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

  it("renames a workspace and keeps the active workspace in sync", () => {
    useSplitViewStore.getState().splitThread(THREAD_A, THREAD_B, "horizontal", false);
    const workspaceId = useSplitViewStore.getState().activeWorkspaceId;
    expect(workspaceId).not.toBeNull();

    useSplitViewStore.getState().renameWorkspace(workspaceId!, "Review Pair");

    const state = useSplitViewStore.getState();
    expect(state.workspaces[0]?.name).toBe("Review Pair");
    expect(state.group?.name).toBe("Review Pair");
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
});
