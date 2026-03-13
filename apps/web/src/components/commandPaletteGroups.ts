import type { ThreadId } from "@t3tools/contracts";
import type { CommandPaletteMode } from "../commandPaletteStore";
import { collectThreadIds, type Workspace, type SplitGroup } from "../splitViewStore";
import type { Project, Thread } from "../types";

export type PaletteItem =
  | { kind: "new-thread"; project: Project }
  | { kind: "rename-thread"; thread: Thread }
  | { kind: "mark-thread-unread"; thread: Thread }
  | { kind: "copy-thread-id"; thread: Thread }
  | { kind: "rename-workspace"; workspaceId: string; name: string }
  | { kind: "open-editor"; cwd: string; label: string }
  | { kind: "open-file-manager"; cwd: string; label: string }
  | {
      kind: "git-action";
      actionId: "init" | "pull" | "commit" | "push" | "create-pr" | "view-pr";
      label: string;
      subtitle?: string;
      prUrl?: string;
    }
  | { kind: "submit-rename" }
  | { kind: "cancel-rename" }
  | { kind: "workspace"; workspaceId: string; name: string; threadCount: number }
  | { kind: "thread"; thread: Thread; project: Project | undefined };

export type PaletteItemGroup = {
  label: string;
  items: PaletteItem[];
};

type WorkspacePaletteItem = Extract<PaletteItem, { kind: "workspace" }>;
type ThreadPaletteItem = Extract<PaletteItem, { kind: "thread" }>;

const RECENTS_LIMIT = 5;

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function threadRecencyTimestamp(thread: Thread): number {
  return Math.max(
    parseTimestamp(thread.lastVisitedAt),
    parseTimestamp(thread.latestTurn?.completedAt),
    parseTimestamp(thread.createdAt),
  );
}

function workspaceRecencyTimestamp(
  workspace: Workspace,
  threadById: ReadonlyMap<ThreadId, Thread>,
): number {
  const explicitRecency = parseTimestamp(workspace.lastVisitedAt);
  if (explicitRecency > Number.NEGATIVE_INFINITY) {
    return explicitRecency;
  }
  return collectThreadIds(workspace.root).reduce((latest, threadId) => {
    const thread = threadById.get(threadId);
    if (!thread) {
      return latest;
    }
    return Math.max(latest, threadRecencyTimestamp(thread));
  }, Number.NEGATIVE_INFINITY);
}

export function buildPaletteItemGroups(input: {
  paletteMode: CommandPaletteMode;
  projects: readonly Project[];
  threads: readonly Thread[];
  workspaces: readonly Workspace[];
  routeThreadId: ThreadId | null;
  activeWorkspaceId: string | null;
  splitGroup: SplitGroup | null;
  projectDraftThreadIdByProjectId: Record<string, ThreadId | undefined>;
}): PaletteItemGroup[] {
  const {
    activeWorkspaceId,
    paletteMode,
    projectDraftThreadIdByProjectId,
    projects,
    routeThreadId,
    splitGroup,
    threads,
    workspaces,
  } = input;

  const projectMap = new Map(projects.map((project) => [project.id, project] as const));
  const threadById = new Map(threads.map((thread) => [thread.id, thread] as const));
  const activeThread =
    routeThreadId !== null ? (threads.find((thread) => thread.id === routeThreadId) ?? null) : null;
  const activeWorkspace =
    activeWorkspaceId !== null
      ? (workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null)
      : null;
  const openThreadIds = new Set<ThreadId>();
  if (
    paletteMode === "split-right" ||
    paletteMode === "split-down" ||
    paletteMode === "replace-focused"
  ) {
    const activeThreadIds = splitGroup
      ? collectThreadIds(splitGroup.root)
      : routeThreadId
        ? [routeThreadId]
        : [];
    for (const threadId of activeThreadIds) {
      openThreadIds.add(threadId);
    }
  }

  const newThreadItems: PaletteItem[] = projects
    .filter((project) => {
      const draftThreadId = projectDraftThreadIdByProjectId[project.id];
      return !draftThreadId || !openThreadIds.has(draftThreadId);
    })
    .map((project) => ({
      kind: "new-thread",
      project,
    }));

  const workspaceItems: WorkspacePaletteItem[] =
    paletteMode === "split-right" || paletteMode === "split-down"
      ? []
      : workspaces.map((workspace) => ({
          kind: "workspace",
          workspaceId: workspace.id,
          name: workspace.name,
          threadCount: collectThreadIds(workspace.root).length,
        }));

  const actionItems: PaletteItem[] =
    paletteMode === "default"
      ? [
          ...(activeThread
            ? [{ kind: "rename-thread", thread: activeThread } satisfies PaletteItem]
            : []),
          ...(activeWorkspace
            ? [
                {
                  kind: "rename-workspace",
                  workspaceId: activeWorkspace.id,
                  name: activeWorkspace.name,
                } satisfies PaletteItem,
              ]
            : []),
        ]
      : [];

  const threadItems: ThreadPaletteItem[] = threads
    .filter((thread) => !openThreadIds.has(thread.id))
    .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((thread) => ({
      kind: "thread",
      thread,
      project: projectMap.get(thread.projectId),
    }));

  const recentItems = [
    ...workspaceItems.map((item) => {
      const workspace = workspaces.find((entry) => entry.id === item.workspaceId) ?? null;
      return {
        item,
        recency: workspace
          ? workspaceRecencyTimestamp(workspace, threadById)
          : Number.NEGATIVE_INFINITY,
      };
    }),
    ...threadItems.map((item) => ({
      item,
      recency: threadRecencyTimestamp(item.thread),
    })),
  ]
    .toSorted((a, b) => {
      const byRecency = b.recency - a.recency;
      if (byRecency !== 0) {
        return byRecency;
      }
      return paletteItemKey(a.item).localeCompare(paletteItemKey(b.item));
    })
    .slice(0, RECENTS_LIMIT)
    .map(({ item }) => item);

  return [
    { label: "Recents", items: recentItems },
    { label: "Actions", items: actionItems },
    { label: "Workspaces", items: workspaceItems },
    { label: "New Thread", items: newThreadItems },
    { label: "Threads", items: threadItems },
  ];
}

export function paletteItemKey(item: PaletteItem): string {
  switch (item.kind) {
    case "new-thread":
      return `new-${item.project.id}`;
    case "rename-thread":
      return `rename-thread-${item.thread.id}`;
    case "mark-thread-unread":
      return `mark-thread-unread-${item.thread.id}`;
    case "copy-thread-id":
      return `copy-thread-id-${item.thread.id}`;
    case "rename-workspace":
      return `rename-workspace-${item.workspaceId}`;
    case "open-editor":
      return `open-editor-${item.cwd}`;
    case "open-file-manager":
      return `open-file-manager-${item.cwd}`;
    case "git-action":
      return `git-action-${item.actionId}`;
    case "submit-rename":
      return "submit-rename";
    case "cancel-rename":
      return "cancel-rename";
    case "workspace":
      return `workspace-${item.workspaceId}`;
    case "thread":
      return `thread-${item.thread.id}`;
  }
}
