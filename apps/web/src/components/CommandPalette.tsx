"use client";

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useDebouncedValue } from "@tanstack/react-pacer";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ColumnsIcon,
  CornerLeftUpIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  RowsIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import type { ProjectId, ThreadId } from "@t3tools/contracts";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useAppSettings } from "../appSettings";
import {
  useCommandPaletteStore,
  type CommandPaletteMode,
} from "../commandPaletteStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import {
  startNewLocalThreadFromContext,
  startNewThreadFromContext,
} from "../lib/chatThreadActions";
import {
  appendBrowsePathSegment,
  getBrowseParentPath,
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
} from "../lib/projectPaths";
import { addProjectFromPath } from "../lib/projectAdd";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { cn, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import {
  useSplitViewStore,
  collectThreadIds,
  countPanes,
  findPaneByThreadId,
  type SplitDirection,
} from "../splitViewStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { DEFAULT_RUNTIME_MODE } from "../types";
import {
  ADDON_ICON_CLASS,
  buildBrowseGroups,
  buildProjectActionItems,
  buildThreadActionItems,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  filterCommandPaletteGroups,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteInputStartAddon,
  getCommandPaletteMode,
  ITEM_ICON_CLASS,
  RECENT_THREAD_LIMIT,
} from "./CommandPalette.logic";
import { CommandPaletteResults } from "./CommandPaletteResults";
import { Button } from "./ui/button";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandInput,
  CommandPanel,
} from "./ui/command";
import { Kbd, KbdGroup } from "./ui/kbd";
import { toastManager } from "./ui/toast";

export function CommandPalette({ children }: { children: ReactNode }) {
  const open = useCommandPaletteStore((store) => store.open);
  const closePalette = useCommandPaletteStore((store) => store.closePalette);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        closePalette();
      }
    },
    [closePalette],
  );

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      {children}
      <CommandPaletteDialog />
    </CommandDialog>
  );
}

function CommandPaletteDialog() {
  const open = useCommandPaletteStore((store) => store.open);
  const closePalette = useCommandPaletteStore((store) => store.closePalette);

  useEffect(() => {
    return () => {
      closePalette();
    };
  }, [closePalette]);

  if (!open) {
    return null;
  }

  return <OpenCommandPaletteDialog />;
}

// ── Split-view helpers ──────────────────────────────────────────────

function splitDirectionForMode(mode: CommandPaletteMode): SplitDirection | null {
  switch (mode) {
    case "split-right":
      return "horizontal";
    case "split-down":
      return "vertical";
    default:
      return null;
  }
}

function splitModeInputPlaceholder(mode: CommandPaletteMode): string | null {
  switch (mode) {
    case "split-right":
      return "Split right with a thread or project\u2026";
    case "split-down":
      return "Split down with a thread or project\u2026";
    case "replace-focused":
      return "Replace the focused pane with a thread\u2026";
    case "new-workspace":
      return "Add a thread to a new workspace\u2026";
    case "new-thread-project":
      return "Select a project\u2026";
    default:
      return null;
  }
}

const SPLIT_VIEW_MODES = new Set<CommandPaletteMode>([
  "split-right",
  "split-down",
  "replace-focused",
  "new-workspace",
  "new-thread-project",
]);

// ── Main dialog ─────────────────────────────────────────────────────

function OpenCommandPaletteDialog() {
  const navigate = useNavigate();
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const storeMode = useCommandPaletteStore((store) => store.mode);
  const sourceThreadId = useCommandPaletteStore((store) => store.sourceThreadId);
  const sourcePaneId = useCommandPaletteStore((store) => store.sourcePaneId);
  const previewThreadId = useCommandPaletteStore((store) => store.previewThreadId);
  const previewPaneId = useCommandPaletteStore((store) => store.previewPaneId);
  const previousMode = useCommandPaletteStore((store) => store.previousMode);
  const openPalette = useCommandPaletteStore((store) => store.openPalette);
  const closePaletteStore = useCommandPaletteStore((store) => store.closePalette);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = query.startsWith(">");
  const isBrowsing = isFilesystemBrowseQuery(query);
  const [debouncedBrowsePath] = useDebouncedValue(query, { wait: 200 });
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const { settings } = useAppSettings();
  const { activeDraftThread, activeThread, handleNewThread, projects } = useHandleNewThread();
  const threads = useStore((store) => store.threads);
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const keybindings = serverConfigQuery.data?.keybindings ?? [];
  const [viewStack, setViewStack] = useState<CommandPaletteView[]>([]);
  const currentView = viewStack.at(-1) ?? null;
  const paletteMode = getCommandPaletteMode({ currentView, isBrowsing });
  const [browseGeneration, setBrowseGeneration] = useState(0);

  // Split view state
  const splitGroup = useSplitViewStore((state) => state.group);
  const workspaces = useSplitViewStore((state) => state.workspaces);
  const activateWorkspace = useSplitViewStore((state) => state.activateWorkspace);
  const closePane = useSplitViewStore((state) => state.closePane);
  const createWorkspace = useSplitViewStore((state) => state.createWorkspace);
  const deactivateWorkspace = useSplitViewStore((state) => state.deactivateWorkspace);
  const splitThread = useSplitViewStore((state) => state.splitThread);
  const splitPane = useSplitViewStore((state) => state.splitPane);
  const replaceThreadInPane = useSplitViewStore((state) => state.replaceThreadInPane);
  const replaceThreadInFocusedPane = useSplitViewStore(
    (state) => state.replaceThreadInFocusedPane,
  );
  const setFocusedPane = useSplitViewStore((state) => state.setFocusedPane);

  const clearDraftThread = useComposerDraftStore((store) => store.clearDraftThread);
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const projectDraftThreadIdByProjectId = useComposerDraftStore(
    (store) => store.projectDraftThreadIdByProjectId,
  );
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);

  const isSplitMode = SPLIT_VIEW_MODES.has(storeMode);

  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const projectTitleById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name] as const)),
    [projects],
  );

  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  const currentProjectCwd = currentProjectId
    ? (projectCwdById.get(currentProjectId) ?? null)
    : null;
  const relativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(query.trim()) && currentProjectCwd === null;
  const debouncedRelativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(debouncedBrowsePath.trim()) && currentProjectCwd === null;

  const { data: browseEntries = [] } = useQuery({
    queryKey: ["filesystemBrowse", debouncedBrowsePath, currentProjectCwd],
    queryFn: async () => {
      const api = readNativeApi();
      if (!api) return [];

      const result = await api.filesystem.browse({
        partialPath: debouncedBrowsePath,
        ...(currentProjectCwd ? { cwd: currentProjectCwd } : {}),
      });
      return result.entries;
    },
    enabled:
      !isSplitMode &&
      isBrowsing &&
      debouncedBrowsePath.length > 0 &&
      !debouncedRelativePathNeedsActiveProject,
  });

  // ── Split-view thread activation ────────────────────────────────

  const effectiveMode = useMemo(() => {
    if (storeMode === "new-thread-project") {
      return previousMode ?? storeMode;
    }
    return storeMode;
  }, [storeMode, previousMode]);

  const splitDirection = splitDirectionForMode(effectiveMode);

  const resetPalette = useCallback(() => {
    closePaletteStore();
    setQuery("");
    setHighlightedItemValue(null);
  }, [closePaletteStore]);

  const closePaletteWithCleanup = useCallback(() => {
    let remainingThreadId: ThreadId | null = null;
    if (previewPaneId && previewThreadId) {
      remainingThreadId = closePane(previewPaneId);
      clearDraftThread(previewThreadId);
    }
    resetPalette();
    if (remainingThreadId) {
      void navigate({
        to: "/$threadId",
        params: { threadId: remainingThreadId },
      });
    }
  }, [clearDraftThread, closePane, navigate, previewPaneId, previewThreadId, resetPalette]);

  const activateThreadInSplitMode = useCallback(
    (threadId: ThreadId) => {
      if (previewPaneId && previewThreadId) {
        const existingPane = splitGroup ? findPaneByThreadId(splitGroup.root, threadId) : null;
        if (existingPane && existingPane.id !== previewPaneId) {
          closePane(previewPaneId);
          clearDraftThread(previewThreadId);
          setFocusedPane(existingPane.id);
          resetPalette();
          void navigate({ to: "/$threadId", params: { threadId } });
          return;
        }

        replaceThreadInPane(previewPaneId, threadId);
        clearDraftThread(previewThreadId);
        resetPalette();
        void navigate({ to: "/$threadId", params: { threadId } });
        return;
      }

      resetPalette();

      if (splitDirection && sourceThreadId) {
        if (splitGroup) {
          const existingPane = findPaneByThreadId(splitGroup.root, threadId);
          if (existingPane) {
            setFocusedPane(existingPane.id);
            return;
          }
          // Use the explicit sourcePaneId if provided, otherwise split the
          // focused pane in the active workspace so we add to the existing
          // layout instead of creating a brand-new workspace.
          const targetPaneId = sourcePaneId ?? splitGroup.focusedPaneId;
          splitPane(targetPaneId, threadId, splitDirection, false);
          return;
        }
        splitThread(sourceThreadId, threadId, splitDirection, false);
        return;
      }

      if (effectiveMode === "replace-focused" && splitGroup) {
        const existingPane = findPaneByThreadId(splitGroup.root, threadId);
        if (existingPane) {
          setFocusedPane(existingPane.id);
          void navigate({ to: "/$threadId", params: { threadId } });
          return;
        }
        replaceThreadInFocusedPane(threadId);
        void navigate({ to: "/$threadId", params: { threadId } });
        return;
      }

      if (effectiveMode === "new-workspace") {
        createWorkspace(threadId);
        void navigate({ to: "/$threadId", params: { threadId } });
        return;
      }

      deactivateWorkspace();
      void navigate({ to: "/$threadId", params: { threadId } });
    },
    [
      clearDraftThread,
      closePane,
      createWorkspace,
      deactivateWorkspace,
      effectiveMode,
      navigate,
      previewPaneId,
      previewThreadId,
      replaceThreadInFocusedPane,
      replaceThreadInPane,
      resetPalette,
      setFocusedPane,
      sourcePaneId,
      sourceThreadId,
      splitDirection,
      splitGroup,
      splitPane,
      splitThread,
    ],
  );

  const handleSplitNewThread = useCallback(
    (projectId: ProjectId) => {
      const storedDraftThread = getDraftThreadByProjectId(projectId);
      if (storedDraftThread) {
        setProjectDraftThreadId(projectId, storedDraftThread.threadId);
        activateThreadInSplitMode(storedDraftThread.threadId);
        return;
      }

      if (previewThreadId) {
        const previewDraftThread = getDraftThread(previewThreadId);
        setProjectDraftThreadId(projectId, previewThreadId, {
          createdAt: previewDraftThread?.createdAt ?? new Date().toISOString(),
          branch: previewDraftThread?.branch ?? null,
          worktreePath: previewDraftThread?.worktreePath ?? null,
          envMode: previewDraftThread?.envMode ?? "local",
          runtimeMode: previewDraftThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          interactionMode: previewDraftThread?.interactionMode ?? "default",
        });
        resetPalette();
        void navigate({ to: "/$threadId", params: { threadId: previewThreadId } });
        return;
      }

      const threadId = newThreadId();
      clearProjectDraftThreadId(projectId);
      setProjectDraftThreadId(projectId, threadId, {
        createdAt: new Date().toISOString(),
        branch: null,
        worktreePath: null,
        envMode: "local",
        runtimeMode: DEFAULT_RUNTIME_MODE,
      });
      activateThreadInSplitMode(threadId);
    },
    [
      activateThreadInSplitMode,
      clearProjectDraftThreadId,
      getDraftThread,
      getDraftThreadByProjectId,
      navigate,
      previewThreadId,
      resetPalette,
      setProjectDraftThreadId,
    ],
  );

  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => {
      resetPalette();
      const focusedThreadId = activateWorkspace(workspaceId);
      if (!focusedThreadId) return;
      void navigate({ to: "/$threadId", params: { threadId: focusedThreadId } });
    },
    [activateWorkspace, navigate, resetPalette],
  );

  const handleSelectProjectInSplit = useCallback(
    (projectId: ProjectId) => {
      const latestThread = threads
        .filter((thread) => thread.projectId === projectId)
        .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (latestThread) {
        activateThreadInSplitMode(latestThread.id);
        return;
      }
      handleSplitNewThread(projectId);
    },
    [activateThreadInSplitMode, handleSplitNewThread, threads],
  );

  // ── Split-mode groups (thread/project picker) ───────────────────

  const splitModeGroups = useMemo<CommandPaletteGroup[]>(() => {
    if (!isSplitMode) return [];

    const projectMap = new Map(projects.map((project) => [project.id, project]));

    // In new-thread-project mode, show projects as new-thread targets
    if (storeMode === "new-thread-project") {
      const items: CommandPaletteActionItem[] = projects.map((project) => ({
        kind: "action" as const,
        value: `split-new-thread:${project.id}`,
        label: `new thread ${project.name} ${project.cwd}`,
        title: (
          <>
            New thread in <span className="font-semibold">{project.name}</span>
          </>
        ),
        searchText: `new thread ${project.name} ${project.cwd}`,
        icon: <FolderIcon className={ITEM_ICON_CLASS} />,
        run: async () => {
          handleSplitNewThread(project.id);
        },
      }));
      return [{ value: "new-thread", label: "New Thread", items }];
    }

    // Determine which threads are already open
    const openThreadIds = new Set<ThreadId>();
    if (
      storeMode === "split-right" ||
      storeMode === "split-down" ||
      storeMode === "replace-focused"
    ) {
      const activeThreadIds = splitGroup
        ? collectThreadIds(splitGroup.root)
        : activeThread?.id
          ? [activeThread.id]
          : [];
      for (const threadId of activeThreadIds) {
        openThreadIds.add(threadId);
      }
    }

    // Active project
    const activeProject = currentProjectId
      ? projects.find((p) => p.id === currentProjectId) ?? null
      : null;

    // New thread actions
    const newThreadItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];
    if (activeProject) {
      const draftThreadId = projectDraftThreadIdByProjectId[activeProject.id];
      if (!draftThreadId || !openThreadIds.has(draftThreadId)) {
        newThreadItems.push({
          kind: "action",
          value: `split-new:${activeProject.id}`,
          label: `new thread ${activeProject.name} ${activeProject.cwd}`,
          title: (
            <>
              New thread in <span className="font-semibold">{activeProject.name}</span>
            </>
          ),
          searchText: `new thread ${activeProject.name} ${activeProject.cwd}`,
          icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
          run: async () => {
            handleSplitNewThread(activeProject.id);
          },
        });
      }
    }
    if (projects.length > 1 || !activeProject) {
      newThreadItems.push({
        kind: "submenu",
        value: "split-new-thread-picker",
        label: "new thread in project",
        title: "New thread in\u2026",
        searchText: "new thread project pick choose select",
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
        groups: [
          {
            value: "projects",
            label: "Projects",
            items: projects.map((project) => ({
              kind: "action" as const,
              value: `split-new-thread:${project.id}`,
              label: `new thread ${project.name} ${project.cwd}`,
              title: (
                <>
                  New thread in <span className="font-semibold">{project.name}</span>
                </>
              ),
              searchText: `new thread ${project.name} ${project.cwd}`,
              icon: <FolderIcon className={ITEM_ICON_CLASS} />,
              run: async () => {
                handleSplitNewThread(project.id);
              },
            })),
          },
        ],
      });
    }

    // Workspace items (only in default and replace-focused modes)
    const workspaceItems: CommandPaletteActionItem[] =
      storeMode === "split-right" ||
      storeMode === "split-down" ||
      storeMode === "new-workspace"
        ? []
        : workspaces.map((workspace) => ({
            kind: "action" as const,
            value: `workspace:${workspace.id}`,
            label: `workspace ${workspace.name} ${countPanes(workspace.root)}`,
            title: workspace.name,
            searchText: `workspace ${workspace.name} ${countPanes(workspace.root)} panes`,
            icon: <ColumnsIcon className={ITEM_ICON_CLASS} />,
            run: async () => {
              handleSelectWorkspace(workspace.id);
            },
          }));

    // Thread items
    const threadItems: CommandPaletteActionItem[] = threads
      .filter((thread) => !openThreadIds.has(thread.id))
      .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((thread) => {
        const project = projectMap.get(thread.projectId);
        return {
          kind: "action" as const,
          value: `split-thread:${thread.id}`,
          label: `${thread.title || "untitled thread"} ${project?.name ?? ""} ${project?.cwd ?? ""}`,
          title: (
            <div className="min-w-0 flex-1">
              <span className="block truncate">{thread.title || "Untitled thread"}</span>
              {project && (
                <span className="block truncate text-xs text-muted-foreground">
                  {project.name}
                </span>
              )}
            </div>
          ),
          searchText: `${thread.title || "untitled thread"} ${project?.name ?? ""} ${project?.cwd ?? ""}`,
          icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
          run: async () => {
            activateThreadInSplitMode(thread.id);
          },
        };
      });

    // Project items
    const projectItems: CommandPaletteActionItem[] = projects.map((project) => ({
      kind: "action" as const,
      value: `split-project:${project.id}`,
      label: `${project.name} ${project.cwd}`,
      title: (
        <div className="min-w-0 flex-1">
          <span className="block truncate">{project.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{project.cwd}</span>
        </div>
      ),
      searchText: `${project.name} ${project.cwd}`,
      icon: <FolderIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        handleSelectProjectInSplit(project.id);
      },
    }));

    const groups: CommandPaletteGroup[] = [];
    if (newThreadItems.length > 0) {
      groups.push({ value: "new-thread", label: "New Thread", items: newThreadItems });
    }
    if (workspaceItems.length > 0) {
      groups.push({ value: "workspaces", label: "Workspaces", items: workspaceItems });
    }
    if (threadItems.length > 0) {
      groups.push({ value: "threads", label: "Threads", items: threadItems });
    }
    if (projectItems.length > 0) {
      groups.push({ value: "projects", label: "Projects", items: projectItems });
    }
    return groups;
  }, [
    activeThread?.id,
    activateThreadInSplitMode,
    currentProjectId,
    draftThreadsByThreadId,
    handleSelectProjectInSplit,
    handleSelectWorkspace,
    handleSplitNewThread,
    isSplitMode,
    projectDraftThreadIdByProjectId,
    projects,
    splitGroup,
    storeMode,
    threads,
    workspaces,
  ]);

  // ── Standard command palette groups ─────────────────────────────

  const projectThreadItems = useMemo(
    () =>
      buildProjectActionItems({
        projects,
        valuePrefix: "new-thread-in",
        icon: <FolderIcon className={ITEM_ICON_CLASS} />,
        runProject: async (projectId) => {
          await handleNewThread(projectId, {
            envMode: settings.defaultThreadEnvMode,
          });
        },
      }),
    [handleNewThread, projects, settings.defaultThreadEnvMode],
  );

  const projectLocalThreadItems = useMemo(
    () =>
      buildProjectActionItems({
        projects,
        valuePrefix: "new-local-thread-in",
        icon: <FolderIcon className={ITEM_ICON_CLASS} />,
        runProject: async (projectId) => {
          await handleNewThread(projectId, {
            envMode: "local",
          });
        },
      }),
    [handleNewThread, projects],
  );

  const allThreadItems = useMemo(
    () =>
      buildThreadActionItems({
        threads,
        ...(activeThread?.id ? { activeThreadId: activeThread.id } : {}),
        projectTitleById,
        icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
        runThread: async (threadId) => {
          await navigate({
            to: "/$threadId",
            params: { threadId },
          });
        },
      }),
    [activeThread?.id, navigate, projectTitleById, threads],
  );

  const recentThreadItems = useMemo(
    () => allThreadItems.slice(0, RECENT_THREAD_LIMIT),
    [allThreadItems],
  );

  const pushView = useCallback((item: CommandPaletteSubmenuItem) => {
    setViewStack((previousViews) => [
      ...previousViews,
      {
        addonIcon: item.addonIcon,
        groups: item.groups,
        ...(item.initialQuery ? { initialQuery: item.initialQuery } : {}),
      },
    ]);
    setHighlightedItemValue(null);
    setQuery(item.initialQuery ?? "");
  }, []);

  const popView = useCallback(() => {
    setViewStack((previousViews) => previousViews.slice(0, -1));
    setHighlightedItemValue(null);
    setQuery("");
  }, []);

  const handleQueryChange = useCallback(
    (nextQuery: string) => {
      setHighlightedItemValue(null);
      setQuery(nextQuery);
      if (nextQuery === "" && currentView?.initialQuery) {
        popView();
      }
    },
    [currentView, popView],
  );

  const rootGroups = useMemo<CommandPaletteGroup[]>(() => {
    const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];

    if (projects.length > 0) {
      const activeProjectTitle = currentProjectId
        ? (projectTitleById.get(currentProjectId) ?? null)
        : null;

      if (activeProjectTitle) {
        actionItems.push({
          kind: "action",
          value: "action:new-thread",
          label: `new thread chat create ${activeProjectTitle}`.trim(),
          title: (
            <>
              New thread in <span className="font-semibold">{activeProjectTitle}</span>
            </>
          ),
          searchText: "new thread chat create draft",
          icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
          shortcutCommand: "chat.new",
          run: async () => {
            await startNewThreadFromContext({
              activeDraftThread,
              activeThread,
              defaultThreadEnvMode: settings.defaultThreadEnvMode,
              handleNewThread,
              projects,
            });
          },
        });

        actionItems.push({
          kind: "action",
          value: "action:new-local-thread",
          label: `new fresh thread chat create ${activeProjectTitle}`.trim(),
          title: (
            <>
              New fresh thread in <span className="font-semibold">{activeProjectTitle}</span>
            </>
          ),
          searchText: "new local thread chat create fresh default environment",
          icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
          shortcutCommand: "chat.newLocal",
          run: async () => {
            await startNewLocalThreadFromContext({
              activeDraftThread,
              activeThread,
              defaultThreadEnvMode: settings.defaultThreadEnvMode,
              handleNewThread,
              projects,
            });
          },
        });
      }

      actionItems.push({
        kind: "submenu",
        value: "action:new-thread-in",
        label: "new thread in project",
        title: "New thread in...",
        searchText: "new thread project pick choose select",
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
        groups: [{ value: "projects", label: "Projects", items: projectThreadItems }],
      });

      actionItems.push({
        kind: "submenu",
        value: "action:new-local-thread-in",
        label: "new local thread in project",
        title: "New local thread in...",
        searchText: "new local thread project pick choose select fresh default environment",
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
        groups: [{ value: "projects", label: "Projects", items: projectLocalThreadItems }],
      });
    }

    // Split view actions
    if (activeThread?.id) {
      actionItems.push({
        kind: "action",
        value: "action:split-right",
        label: "split right horizontal pane",
        title: "Split right",
        searchText: "split right horizontal pane side by side",
        icon: <ColumnsIcon className={ITEM_ICON_CLASS} />,
        shortcutCommand: "chat.splitRight",
        keepOpen: true,
        run: async () => {
          openPalette({
            mode: "split-right",
            sourceThreadId: activeThread.id,
          });
        },
      });

      actionItems.push({
        kind: "action",
        value: "action:split-down",
        label: "split down vertical pane",
        title: "Split down",
        searchText: "split down vertical pane stack",
        icon: <RowsIcon className={ITEM_ICON_CLASS} />,
        shortcutCommand: "chat.splitDown",
        keepOpen: true,
        run: async () => {
          openPalette({
            mode: "split-down",
            sourceThreadId: activeThread.id,
          });
        },
      });

      if (useSplitViewStore.getState().isSplit()) {
        actionItems.push({
          kind: "action",
          value: "action:replace-focused",
          label: "replace focused pane swap",
          title: "Replace focused pane",
          searchText: "replace focused pane swap thread",
          icon: <ColumnsIcon className={ITEM_ICON_CLASS} />,
          shortcutCommand: "chat.replaceFocusedPane",
          keepOpen: true,
          run: async () => {
            openPalette({
              mode: "replace-focused",
              sourceThreadId: activeThread.id,
            });
          },
        });
      }
    }

    actionItems.push({
      kind: "action",
      value: "action:new-workspace",
      label: "new workspace create split view",
      title: "New workspace",
      searchText: "new workspace create split view",
      icon: <ColumnsIcon className={ITEM_ICON_CLASS} />,
      keepOpen: true,
      run: async () => {
        openPalette({ mode: "new-workspace" });
      },
    });

    actionItems.push({
      kind: "submenu",
      value: "action:add-project",
      label: "add project folder directory browse",
      title: "Add project",
      icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
      addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
      groups: [],
      initialQuery: "~/",
    });

    actionItems.push({
      kind: "action",
      value: "action:settings",
      label: "settings preferences configuration keybindings",
      title: "Open settings",
      icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/settings" });
      },
    });

    const groups: CommandPaletteGroup[] = [];
    if (actionItems.length > 0) {
      groups.push({
        value: "actions",
        label: "Actions",
        items: actionItems,
      });
    }
    if (recentThreadItems.length > 0) {
      groups.push({
        value: "recent-threads",
        label: "Recent Threads",
        items: recentThreadItems,
      });
    }
    return groups;
  }, [
    activeDraftThread,
    activeThread,
    currentProjectId,
    handleNewThread,
    navigate,
    openPalette,
    projectLocalThreadItems,
    projectThreadItems,
    projectTitleById,
    projects,
    recentThreadItems,
    settings.defaultThreadEnvMode,
  ]);

  // ── Decide which groups to show ─────────────────────────────────

  const activeGroups = isSplitMode
    ? splitModeGroups
    : currentView
      ? currentView.groups
      : rootGroups;

  const filteredGroups = useMemo(
    () =>
      isSplitMode
        ? filterCommandPaletteGroups({
            activeGroups: splitModeGroups,
            query: deferredQuery,
            isInSubmenu: currentView !== null,
            projectSearchItems: [],
            threadSearchItems: [],
          })
        : filterCommandPaletteGroups({
            activeGroups,
            query: deferredQuery,
            isInSubmenu: currentView !== null,
            projectSearchItems: projectThreadItems,
            threadSearchItems: allThreadItems,
          }),
    [
      activeGroups,
      allThreadItems,
      currentView,
      deferredQuery,
      isSplitMode,
      projectThreadItems,
      splitModeGroups,
    ],
  );

  const handleAddProject = useCallback(
    async (rawCwd: string) => {
      const api = readNativeApi();
      if (!api) return;

      try {
        await addProjectFromPath(
          {
            api,
            currentProjectCwd,
            defaultThreadEnvMode: settings.defaultThreadEnvMode,
            handleNewThread,
            navigateToThread: async (threadId) => {
              await navigate({
                to: "/$threadId",
                params: { threadId },
              });
            },
            platform: navigator.platform,
            projects,
            threads,
          },
          rawCwd,
        );
        setOpen(false);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to add project",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [
      currentProjectCwd,
      handleNewThread,
      navigate,
      projects,
      setOpen,
      settings.defaultThreadEnvMode,
      threads,
    ],
  );

  const browseTo = useCallback(
    (name: string) => {
      setHighlightedItemValue(null);
      setQuery(appendBrowsePathSegment(query, name));
      setBrowseGeneration((generation) => generation + 1);
    },
    [query],
  );

  const browseUp = useCallback(() => {
    const parentPath = getBrowseParentPath(query);
    if (parentPath === null) {
      return;
    }

    setHighlightedItemValue(null);
    setQuery(parentPath);
    setBrowseGeneration((generation) => generation + 1);
  }, [query]);

  const canBrowseUp =
    isBrowsing && !relativePathNeedsActiveProject && getBrowseParentPath(query) !== null;

  const browseGroups = useMemo(
    () =>
      buildBrowseGroups({
        browseEntries,
        browseQuery: query,
        canBrowseUp,
        upIcon: <CornerLeftUpIcon className={ITEM_ICON_CLASS} />,
        directoryIcon: <FolderIcon className={ITEM_ICON_CLASS} />,
        browseUp,
        browseTo,
      }),
    [browseEntries, browseTo, browseUp, canBrowseUp, query],
  );

  const displayedGroups = useMemo(
    () =>
      isSplitMode
        ? filteredGroups
        : isBrowsing && relativePathNeedsActiveProject
          ? []
          : isBrowsing
            ? browseGroups
            : filteredGroups,
    [browseGroups, filteredGroups, isBrowsing, isSplitMode, relativePathNeedsActiveProject],
  );

  // ── Input placeholder / addon ───────────────────────────────────

  const splitPlaceholder = splitModeInputPlaceholder(storeMode);
  const inputPlaceholder = splitPlaceholder ?? getCommandPaletteInputPlaceholder(paletteMode);
  const inputStartAddon = isSplitMode
    ? null
    : getCommandPaletteInputStartAddon({
        mode: paletteMode,
        currentViewAddonIcon: currentView?.addonIcon ?? null,
        browseIcon: <FolderPlusIcon />,
      });
  const isSubmenu =
    isSplitMode || paletteMode === "submenu" || paletteMode === "submenu-browse";

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (isSplitMode) {
        if (event.key === "Backspace" && query === "" && previousMode) {
          event.preventDefault();
          setQuery("");
          setHighlightedItemValue(null);
          openPalette({
            mode: previousMode,
            previousMode: null,
            sourceThreadId,
            sourcePaneId,
            previewThreadId,
            previewPaneId,
          });
        }
        return;
      }

      if (
        isBrowsing &&
        event.key === "Enter" &&
        highlightedItemValue === null &&
        !relativePathNeedsActiveProject
      ) {
        event.preventDefault();
        void handleAddProject(query.trim());
      }

      if (event.key === "Backspace" && query === "" && isSubmenu) {
        event.preventDefault();
        popView();
      }
    },
    [
      handleAddProject,
      highlightedItemValue,
      isBrowsing,
      isSplitMode,
      isSubmenu,
      openPalette,
      popView,
      previewPaneId,
      previewThreadId,
      previousMode,
      query,
      relativePathNeedsActiveProject,
      sourcePaneId,
      sourceThreadId,
    ],
  );

  const executeItem = useCallback(
    (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => {
      if (item.kind === "submenu") {
        pushView(item);
        return;
      }

      if (!item.keepOpen) {
        if (isSplitMode) {
          resetPalette();
        } else {
          setOpen(false);
        }
      }

      void item.run().catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Unable to run command",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      });
    },
    [isSplitMode, pushView, resetPalette, setOpen],
  );

  return (
    <CommandDialogPopup
      aria-label="Command palette"
      className="overflow-hidden p-0"
      data-testid="command-palette"
    >
      <Command
        key={`${viewStack.length}-${browseGeneration}-${storeMode}`}
        aria-label="Command palette"
        autoHighlight={isBrowsing && !isSplitMode ? false : "always"}
        mode="none"
        onItemHighlighted={(value) => {
          setHighlightedItemValue(typeof value === "string" ? value : null);
        }}
        onValueChange={handleQueryChange}
        value={query}
      >
        <div className="relative">
          <CommandInput
            className={isBrowsing && !isSplitMode ? "pe-16" : undefined}
            placeholder={inputPlaceholder}
            startAddon={inputStartAddon}
            onKeyDown={handleKeyDown}
          />
          {isBrowsing && !isSplitMode ? (
            <Button
              variant="outline"
              size="xs"
              tabIndex={-1}
              className="absolute end-2.5 top-1/2 -translate-y-1/2"
              disabled={relativePathNeedsActiveProject}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                if (relativePathNeedsActiveProject) {
                  return;
                }
                void handleAddProject(query.trim());
              }}
            >
              Add
            </Button>
          ) : null}
        </div>
        <CommandPanel className="max-h-[min(28rem,70vh)]">
          <CommandPaletteResults
            groups={displayedGroups}
            isActionsOnly={isActionsOnly}
            keybindings={keybindings}
            onExecuteItem={executeItem}
            {...(relativePathNeedsActiveProject && !isSplitMode
              ? { emptyStateMessage: "Relative paths require an active project." }
              : {})}
          />
        </CommandPanel>
        <CommandFooter className="gap-3 max-sm:flex-col max-sm:items-start">
          <div className="flex items-center gap-3">
            <KbdGroup className="items-center gap-1.5">
              <Kbd>
                <ArrowUpIcon />
              </Kbd>
              <Kbd>
                <ArrowDownIcon />
              </Kbd>
              <span className={cn("text-muted-foreground/80")}>Navigate</span>
            </KbdGroup>
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Enter</Kbd>
              <span className={cn("text-muted-foreground/80")}>
                {splitDirection
                  ? "Split"
                  : effectiveMode === "replace-focused"
                    ? "Replace"
                    : effectiveMode === "new-workspace"
                      ? "Create"
                      : "Select"}
              </span>
            </KbdGroup>
            {isSubmenu ? (
              <KbdGroup className="items-center gap-1.5">
                <Kbd>Backspace</Kbd>
                <span className={cn("text-muted-foreground/80")}>Back</span>
              </KbdGroup>
            ) : null}
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Esc</Kbd>
              <span className={cn("text-muted-foreground/80")}>Close</span>
            </KbdGroup>
          </div>
        </CommandFooter>
      </Command>
    </CommandDialogPopup>
  );
}
