import { describe, expect, it } from "vitest";
import { ThreadId } from "@t3tools/contracts";
import type { Workspace } from "../splitViewStore";
import type { Project, Thread } from "../types";
import { buildPaletteItemGroups } from "./commandPaletteGroups";

const PROJECT_ID = "project-1" as Project["id"];

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    name: "Project One",
    cwd: "/repo/project-one",
    model: "gpt-5-codex",
    expanded: true,
    scripts: [],
    ...overrides,
  };
}

function makeThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe(id),
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: id,
    model: "gpt-5-codex",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-12T00:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: undefined,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeWorkspace(
  id: string,
  threadIds: readonly [ThreadId, ...ThreadId[]],
  overrides: Partial<Workspace> = {},
): Workspace {
  const [firstThreadId, secondThreadId = firstThreadId] = threadIds;
  return {
    id,
    name: id,
    focusedLeafId: `${id}-leaf-1`,
    root: {
      type: "branch",
      id: `${id}-branch`,
      direction: "horizontal",
      ratio: 0.5,
      children: [
        {
          type: "leaf",
          id: `${id}-leaf-1`,
          threadId: firstThreadId,
        },
        {
          type: "leaf",
          id: `${id}-leaf-2`,
          threadId: secondThreadId,
        },
      ],
    },
    ...overrides,
  };
}

describe("buildPaletteItemGroups", () => {
  it("puts recents ahead of actions, workspaces, and threads", () => {
    const project = makeProject();
    const thread = makeThread("thread-1");
    const workspace = makeWorkspace("workspace-1", [thread.id]);

    const groups = buildPaletteItemGroups({
      paletteMode: "default",
      projects: [project],
      threads: [thread],
      workspaces: [workspace],
      routeThreadId: thread.id,
      activeWorkspaceId: workspace.id,
      splitGroup: workspace,
      projectDraftThreadIdByProjectId: {},
    });

    expect(groups.slice(0, 4).map((group) => group.label)).toEqual([
      "Recents",
      "Actions",
      "Workspaces",
      "New Thread",
    ]);
  });

  it("limits recents to the five most recent workspace or thread entries", () => {
    const project = makeProject();
    const threads = [
      makeThread("thread-1", { lastVisitedAt: "2026-03-12T07:00:00.000Z" }),
      makeThread("thread-2", { lastVisitedAt: "2026-03-12T05:00:00.000Z" }),
      makeThread("thread-3", { lastVisitedAt: "2026-03-12T03:00:00.000Z" }),
      makeThread("thread-4", { lastVisitedAt: "2026-03-12T01:00:00.000Z" }),
    ];
    const workspaces = [
      makeWorkspace("workspace-1", [threads[0]!.id], {
        lastVisitedAt: "2026-03-12T06:00:00.000Z",
      }),
      makeWorkspace("workspace-2", [threads[1]!.id], {
        lastVisitedAt: "2026-03-12T04:00:00.000Z",
      }),
      makeWorkspace("workspace-3", [threads[3]!.id], {
        lastVisitedAt: "2026-03-12T00:30:00.000Z",
      }),
    ];

    const groups = buildPaletteItemGroups({
      paletteMode: "default",
      projects: [project],
      threads,
      workspaces,
      routeThreadId: null,
      activeWorkspaceId: null,
      splitGroup: null,
      projectDraftThreadIdByProjectId: {},
    });

    expect(
      groups[0]?.items.map((item) => {
        switch (item.kind) {
          case "thread":
            return item.thread.title;
          case "workspace":
            return item.name;
          default:
            return item.kind;
        }
      }),
    ).toEqual(["thread-1", "workspace-1", "thread-2", "workspace-2", "thread-3"]);
  });

  it("falls back to thread activity when a workspace has no explicit lastVisitedAt", () => {
    const project = makeProject();
    const thread = makeThread("thread-1", {
      lastVisitedAt: "2026-03-12T08:00:00.000Z",
    });
    const workspace = makeWorkspace("workspace-1", [thread.id]);

    const groups = buildPaletteItemGroups({
      paletteMode: "default",
      projects: [project],
      threads: [thread],
      workspaces: [workspace],
      routeThreadId: null,
      activeWorkspaceId: null,
      splitGroup: null,
      projectDraftThreadIdByProjectId: {},
    });

    expect(groups[0]?.items[0]).toMatchObject({
      kind: "thread",
    });
    expect(groups[0]?.items[1]).toMatchObject({
      kind: "workspace",
      workspaceId: workspace.id,
    });
  });

  it("does not emit a projects group or project items", () => {
    const project = makeProject();
    const thread = makeThread("thread-1");

    const groups = buildPaletteItemGroups({
      paletteMode: "default",
      projects: [project],
      threads: [thread],
      workspaces: [],
      routeThreadId: null,
      activeWorkspaceId: null,
      splitGroup: null,
      projectDraftThreadIdByProjectId: {},
    });

    expect(groups.some((group) => group.label === "Projects")).toBe(false);
    expect(
      groups.flatMap((group) => group.items).some((item) => String(item.kind) === "project"),
    ).toBe(false);
  });
});
