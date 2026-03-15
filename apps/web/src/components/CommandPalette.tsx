import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeftIcon, ChevronRightIcon, ColumnsIcon, FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { type ProjectId, ThreadId } from "@t3tools/contracts";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  useCommandFilteredItems,
} from "~/components/ui/command";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { isMacPlatform, newThreadId } from "../lib/utils";
import {
  collectThreadIds,
  countPanes,
  findPaneByThreadId,
  type SplitDirection,
  useSplitViewStore,
} from "../splitViewStore";
import { useStore } from "../store";
import { DEFAULT_RUNTIME_MODE } from "../types";
import type { Project, Thread } from "../types";

type PaletteItem =
  | { kind: "new-thread"; project: Project }
  | { kind: "new-thread-picker" }
  | { kind: "workspace"; workspaceId: string; name: string; threadCount: number }
  | { kind: "thread"; thread: Thread; project: Project | undefined }
  | { kind: "project"; project: Project };

type PaletteItemGroup = {
  label: string;
  items: PaletteItem[];
};

function paletteItemKey(item: PaletteItem): string {
  switch (item.kind) {
    case "new-thread":
      return `new-${item.project.id}`;
    case "new-thread-picker":
      return "new-thread-picker";
    case "workspace":
      return `workspace-${item.workspaceId}`;
    case "thread":
      return `thread-${item.thread.id}`;
    case "project":
      return `project-${item.project.id}`;
  }
}

function paletteItemSearchText(item: PaletteItem): string {
  switch (item.kind) {
    case "new-thread":
      return `new thread ${item.project.name} ${item.project.cwd}`;
    case "new-thread-picker":
      return "new thread in project";
    case "workspace":
      return `workspace ${item.name} ${item.threadCount}`;
    case "thread":
      return `${item.thread.title || "untitled thread"} ${item.project?.name ?? ""} ${item.project?.cwd ?? ""}`;
    case "project":
      return `${item.project.name} ${item.project.cwd}`;
  }
}

function isPaletteItem(value: unknown): value is PaletteItem {
  return value !== null && typeof value === "object" && "kind" in value;
}

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const highlightedItemRef = useRef<PaletteItem | null>(null);

  const open = useCommandPaletteStore((state) => state.open);
  const paletteMode = useCommandPaletteStore((state) => state.mode);
  const sourceThreadId = useCommandPaletteStore((state) => state.sourceThreadId);
  const sourcePaneId = useCommandPaletteStore((state) => state.sourcePaneId);
  const previewThreadId = useCommandPaletteStore((state) => state.previewThreadId);
  const previewPaneId = useCommandPaletteStore((state) => state.previewPaneId);
  const previousMode = useCommandPaletteStore((state) => state.previousMode);
  const openPalette = useCommandPaletteStore((state) => state.openPalette);
  const closePaletteStore = useCommandPaletteStore((state) => state.closePalette);
  const toggleDefaultPalette = useCommandPaletteStore((state) => state.toggleDefaultPalette);

  const projects = useStore((state) => state.projects);
  const threads = useStore((state) => state.threads);
  const navigate = useNavigate();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const splitGroup = useSplitViewStore((state) => state.group);
  const workspaces = useSplitViewStore((state) => state.workspaces);
  const activeWorkspaceId = useSplitViewStore((state) => state.activeWorkspaceId);
  const activateWorkspace = useSplitViewStore((state) => state.activateWorkspace);
  const closePane = useSplitViewStore((state) => state.closePane);
  const createWorkspace = useSplitViewStore((state) => state.createWorkspace);
  const deactivateWorkspace = useSplitViewStore((state) => state.deactivateWorkspace);
  const splitThread = useSplitViewStore((state) => state.splitThread);
  const splitPane = useSplitViewStore((state) => state.splitPane);
  const replaceThreadInPane = useSplitViewStore((state) => state.replaceThreadInPane);
  const replaceThreadInFocusedPane = useSplitViewStore((state) => state.replaceThreadInFocusedPane);
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

  // Determine the active project from the current thread
  const activeProject = useMemo(() => {
    if (!routeThreadId) return null;
    const serverThread = threads.find((t) => t.id === routeThreadId);
    if (serverThread) {
      return projects.find((p) => p.id === serverThread.projectId) ?? null;
    }
    const draftThread = draftThreadsByThreadId[routeThreadId];
    if (draftThread?.projectId) {
      return projects.find((p) => p.id === draftThread.projectId) ?? null;
    }
    return null;
  }, [draftThreadsByThreadId, projects, routeThreadId, threads]);

  const itemGroups = useMemo(() => {
    const projectMap = new Map(projects.map((project) => [project.id, project]));

    // In new-thread-project mode, show all projects as new-thread targets
    if (paletteMode === "new-thread-project") {
      const newThreadProjectItems: PaletteItem[] = projects.map((project) => ({
        kind: "new-thread",
        project,
      }));
      return [{ label: "New Thread", items: newThreadProjectItems }];
    }

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

    // "New Thread" actions: one for the current project, plus a picker for others
    const newThreadItems: PaletteItem[] = [];
    if (activeProject) {
      const draftThreadId = projectDraftThreadIdByProjectId[activeProject.id];
      if (!draftThreadId || !openThreadIds.has(draftThreadId)) {
        newThreadItems.push({ kind: "new-thread", project: activeProject });
      }
    }
    if (projects.length > 1 || !activeProject) {
      newThreadItems.push({ kind: "new-thread-picker" });
    }

    const workspaceItems: PaletteItem[] =
      paletteMode === "split-right" || paletteMode === "split-down" || paletteMode === "new-workspace"
        ? []
        : workspaces.map((workspace) => ({
            kind: "workspace",
            workspaceId: workspace.id,
            name: workspace.name,
            threadCount: countPanes(workspace.root),
          }));

    const threadItems: PaletteItem[] = threads
      .filter((thread) => !openThreadIds.has(thread.id))
      .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((thread) => ({
        kind: "thread",
        thread,
        project: projectMap.get(thread.projectId),
      }));

    const projectItems: PaletteItem[] = projects.map((project) => ({
      kind: "project",
      project,
    }));

    return [
      { label: "New Thread", items: newThreadItems },
      { label: "Workspaces", items: workspaceItems },
      { label: "Threads", items: threadItems },
      { label: "Projects", items: projectItems },
    ];
  }, [
    activeProject,
    paletteMode,
    projectDraftThreadIdByProjectId,
    projects,
    routeThreadId,
    splitGroup,
    threads,
    workspaces,
  ]);

  const resetPalette = useCallback(() => {
    closePaletteStore();
    setQuery("");
    highlightedItemRef.current = null;
  }, [closePaletteStore]);

  const goBack = useCallback(() => {
    if (!previousMode) return;
    setQuery("");
    highlightedItemRef.current = null;
    openPalette({
      mode: previousMode,
      previousMode: null,
      sourceThreadId,
      sourcePaneId,
      previewThreadId,
      previewPaneId,
    });
  }, [openPalette, previewPaneId, previewThreadId, previousMode, sourcePaneId, sourceThreadId]);

  const focusPaletteInput = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>(
      "[data-slot='command-dialog-popup'] input",
    );
    if (!input) {
      return false;
    }
    input.focus({ preventScroll: true });
    const selectionEnd = input.value.length;
    input.setSelectionRange(selectionEnd, selectionEnd);
    return true;
  }, []);

  const closePalette = useCallback(() => {
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
      if (isMod && event.key.toLowerCase() === "k" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if (open && paletteMode !== "default") {
          closePalette();
          return;
        }
        toggleDefaultPalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePalette, open, paletteMode, toggleDefaultPalette]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let fallbackFrameId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      if (focusPaletteInput()) {
        return;
      }
      fallbackFrameId = window.requestAnimationFrame(() => {
        focusPaletteInput();
      });
    });
    const timeoutId = window.setTimeout(() => {
      focusPaletteInput();
    }, 80);

    return () => {
      window.cancelAnimationFrame(frameId);
      if (fallbackFrameId !== null) {
        window.cancelAnimationFrame(fallbackFrameId);
      }
      window.clearTimeout(timeoutId);
    };
  }, [focusPaletteInput, open, paletteMode]);

  // In sub-stage modes (project picker), the "real" mode
  // is the one that spawned them — used for split direction and action routing.
  const effectiveMode = useMemo(() => {
    if (paletteMode === "new-thread-project") {
      return previousMode ?? paletteMode;
    }
    return paletteMode;
  }, [paletteMode, previousMode]);

  const splitDirection = useMemo<SplitDirection | null>(() => {
    switch (effectiveMode) {
      case "split-right":
        return "horizontal";
      case "split-down":
        return "vertical";
      default:
        return null;
    }
  }, [effectiveMode]);

  const activateThread = useCallback(
    (threadId: ThreadId) => {
      if (previewPaneId && previewThreadId) {
        const existingPane = splitGroup ? findPaneByThreadId(splitGroup.root, threadId) : null;
        if (existingPane && existingPane.id !== previewPaneId) {
          closePane(previewPaneId);
          clearDraftThread(previewThreadId);
          setFocusedPane(existingPane.id);
          resetPalette();
          void navigate({
            to: "/$threadId",
            params: { threadId },
          });
          return;
        }

        replaceThreadInPane(previewPaneId, threadId);
        clearDraftThread(previewThreadId);
        resetPalette();
        void navigate({
          to: "/$threadId",
          params: { threadId },
        });
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
          if (sourcePaneId) {
            splitPane(sourcePaneId, threadId, splitDirection, false);
            return;
          }
        }

        splitThread(sourceThreadId, threadId, splitDirection, false);
        return;
      }

      if (effectiveMode === "replace-focused" && splitGroup) {
        const existingPane = findPaneByThreadId(splitGroup.root, threadId);
        if (existingPane) {
          setFocusedPane(existingPane.id);
          void navigate({
            to: "/$threadId",
            params: { threadId },
          });
          return;
        }
        replaceThreadInFocusedPane(threadId);
        void navigate({
          to: "/$threadId",
          params: { threadId },
        });
        return;
      }

      if (effectiveMode === "new-workspace") {
        createWorkspace(threadId);
        void navigate({
          to: "/$threadId",
          params: { threadId },
        });
        return;
      }

      deactivateWorkspace();
      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
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

  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => {
      resetPalette();
      const focusedThreadId = activateWorkspace(workspaceId);
      if (!focusedThreadId) return;
      void navigate({
        to: "/$threadId",
        params: { threadId: focusedThreadId },
      });
    },
    [activateWorkspace, navigate, resetPalette],
  );

  const handleNewThread = useCallback(
    (projectId: ProjectId) => {
      const storedDraftThread = getDraftThreadByProjectId(projectId);
      if (storedDraftThread) {
        setProjectDraftThreadId(projectId, storedDraftThread.threadId);
        activateThread(storedDraftThread.threadId);
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
        void navigate({
          to: "/$threadId",
          params: { threadId: previewThreadId },
        });
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
      activateThread(threadId);
    },
    [
      activateThread,
      clearProjectDraftThreadId,
      getDraftThread,
      getDraftThreadByProjectId,
      navigate,
      previewThreadId,
      resetPalette,
      setProjectDraftThreadId,
    ],
  );

  const handleSelectProject = useCallback(
    (projectId: ProjectId) => {
      const latestThread = threads
        .filter((thread) => thread.projectId === projectId)
        .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (latestThread) {
        activateThread(latestThread.id);
        return;
      }

      handleNewThread(projectId);
    },
    [activateThread, handleNewThread, threads],
  );

  const handleItemClick = useCallback(
    (item: PaletteItem) => {
      switch (item.kind) {
        case "new-thread":
          handleNewThread(item.project.id);
          break;
        case "new-thread-picker":
          // Transition to 2nd stage: pick a project for the new thread
          setQuery("");
          openPalette({
            mode: "new-thread-project",
            previousMode: paletteMode,
            sourceThreadId,
            sourcePaneId,
            previewThreadId,
            previewPaneId,
          });
          break;
        case "workspace":
          handleSelectWorkspace(item.workspaceId);
          break;
        case "thread":
          activateThread(item.thread.id);
          break;
        case "project":
          handleSelectProject(item.project.id);
          break;
      }
    },
    [activateThread, handleNewThread, handleSelectProject, handleSelectWorkspace, openPalette, paletteMode, previewPaneId, previewThreadId, sourcePaneId, sourceThreadId],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return;
        closePalette();
      }}
    >
      <CommandDialogPopup>
        <Command
          items={itemGroups}
          value={query}
          onValueChange={setQuery}
          itemToStringValue={(item) => (isPaletteItem(item) ? paletteItemSearchText(item) : "")}
          onItemHighlighted={(item) => {
            highlightedItemRef.current = isPaletteItem(item) ? item : null;
          }}
        >
          <div className="flex items-center">
            {previousMode && (
              <button
                type="button"
                className="flex-none ml-3 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={goBack}
                aria-label="Back"
              >
                <ArrowLeftIcon className="size-4" />
              </button>
            )}
            <CommandInput
              className={previousMode ? "pl-2" : undefined}
              placeholder={
                paletteMode === "split-right"
                  ? "Split right with a thread or project…"
                  : paletteMode === "split-down"
                    ? "Split down with a thread or project…"
                    : paletteMode === "replace-focused"
                      ? "Replace the focused pane with a thread or project…"
                      : paletteMode === "new-workspace"
                        ? "Add a thread to a new workspace…"
                        : paletteMode === "new-thread-project"
                          ? "Select a project…"
                          : "Search threads and projects…"
              }
              onKeyDown={(event) => {
                if ((event.key === "Backspace" || event.key === "ArrowLeft") && query === "" && previousMode) {
                  event.preventDefault();
                  goBack();
                }
                if (event.key === "ArrowRight" && highlightedItemRef.current?.kind === "new-thread-picker") {
                  event.preventDefault();
                  handleItemClick(highlightedItemRef.current);
                }
              }}
            />
          </div>
          <CommandPanel
            onKeyDownCapture={(event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== "Enter" || !highlightedItemRef.current) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              handleItemClick(highlightedItemRef.current);
            }}
          >
            <CommandPaletteResults onItemClick={handleItemClick} />
          </CommandPanel>
          <CommandFooter>
            <span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                ↑↓
              </kbd>{" "}
              navigate
            </span>
            <span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">↵</kbd>{" "}
              {splitDirection ? "split" : effectiveMode === "replace-focused" ? "replace" : effectiveMode === "new-workspace" ? "create workspace" : "select"}
            </span>
            {previousMode && (
              <span>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  ←
                </kbd>
                <span className="mx-0.5 text-muted-foreground/60">/</span>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  ⌫
                </kbd>{" "}
                back
              </span>
            )}
            <span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                esc
              </kbd>{" "}
              close
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function CommandPaletteResults(props: { onItemClick: (item: PaletteItem) => void }) {
  const filteredItemGroups = useCommandFilteredItems<PaletteItemGroup>();

  return (
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      {filteredItemGroups.map((group) => (
        <CommandGroup key={group.label}>
          <CommandGroupLabel>{group.label}</CommandGroupLabel>
          {group.items.map((item) => (
            <CommandItem
              key={`${group.label}:${paletteItemKey(item)}`}
              value={item}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => props.onItemClick(item)}
            >
              <PaletteItemContent item={item} />
            </CommandItem>
          ))}
          <CommandSeparator />
        </CommandGroup>
      ))}
    </CommandList>
  );
}

function PaletteItemContent({ item }: { item: PaletteItem }) {
  switch (item.kind) {
    case "new-thread":
      return (
        <>
          <PlusIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            New thread in <span className="font-medium">{item.project.name}</span>
          </span>
        </>
      );
    case "new-thread-picker":
      return (
        <>
          <PlusIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">New thread in…</span>
          <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </>
      );
    case "thread":
      return (
        <>
          <MessageSquareIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="block truncate">{item.thread.title || "Untitled thread"}</span>
            {item.project && (
              <span className="block truncate text-xs text-muted-foreground">
                {item.project.name}
              </span>
            )}
          </div>
        </>
      );
    case "workspace":
      return (
        <>
          <ColumnsIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="block truncate">{item.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {item.threadCount} {item.threadCount === 1 ? "pane" : "panes"}
            </span>
          </div>
        </>
      );
    case "project":
      return (
        <>
          <FolderIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="block truncate">{item.project.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{item.project.cwd}</span>
          </div>
        </>
      );
  }
}
