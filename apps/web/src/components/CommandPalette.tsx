import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { FolderIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
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
  findLeafByThreadId,
  type SplitDirection,
  useSplitViewStore,
} from "../splitViewStore";
import { useStore } from "../store";
import { DEFAULT_RUNTIME_MODE } from "../types";
import type { Project, Thread } from "../types";

type PaletteItem =
  | { kind: "new-thread"; project: Project }
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
  const sourceLeafId = useCommandPaletteStore((state) => state.sourceLeafId);
  const previewThreadId = useCommandPaletteStore((state) => state.previewThreadId);
  const previewLeafId = useCommandPaletteStore((state) => state.previewLeafId);
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
  const closePane = useSplitViewStore((state) => state.closePane);
  const splitThread = useSplitViewStore((state) => state.splitThread);
  const splitLeaf = useSplitViewStore((state) => state.splitLeaf);
  const replaceThreadInLeaf = useSplitViewStore((state) => state.replaceThreadInLeaf);
  const replaceThreadInFocusedLeaf = useSplitViewStore((state) => state.replaceThreadInFocusedLeaf);
  const setFocusedLeaf = useSplitViewStore((state) => state.setFocusedLeaf);

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

  const itemGroups = useMemo(() => {
    const projectMap = new Map(projects.map((project) => [project.id, project]));
    const openThreadIds = new Set<ThreadId>(
      splitGroup ? collectThreadIds(splitGroup.root) : routeThreadId ? [routeThreadId] : [],
    );

    const newThreadItems: PaletteItem[] = projects
      .filter((project) => {
        const draftThreadId = projectDraftThreadIdByProjectId[project.id];
        return !draftThreadId || !openThreadIds.has(draftThreadId);
      })
      .map((project) => ({
        kind: "new-thread",
        project,
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
      { label: "Threads", items: threadItems },
      { label: "Projects", items: projectItems },
    ];
  }, [projectDraftThreadIdByProjectId, projects, routeThreadId, splitGroup, threads]);

  const resetPalette = useCallback(() => {
    closePaletteStore();
    setQuery("");
    highlightedItemRef.current = null;
  }, [closePaletteStore]);

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
    if (previewLeafId && previewThreadId) {
      remainingThreadId = closePane(previewLeafId);
      clearDraftThread(previewThreadId);
    }
    resetPalette();
    if (remainingThreadId) {
      void navigate({
        to: "/$threadId",
        params: { threadId: remainingThreadId },
      });
    }
  }, [clearDraftThread, closePane, navigate, previewLeafId, previewThreadId, resetPalette]);

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

  const splitDirection = useMemo<SplitDirection | null>(() => {
    switch (paletteMode) {
      case "split-right":
        return "horizontal";
      case "split-down":
        return "vertical";
      default:
        return null;
    }
  }, [paletteMode]);

  const activateThread = useCallback(
    (threadId: ThreadId) => {
      if (previewLeafId && previewThreadId) {
        const existingLeaf = splitGroup ? findLeafByThreadId(splitGroup.root, threadId) : null;
        if (existingLeaf && existingLeaf.id !== previewLeafId) {
          closePane(previewLeafId);
          clearDraftThread(previewThreadId);
          setFocusedLeaf(existingLeaf.id);
          resetPalette();
          void navigate({
            to: "/$threadId",
            params: { threadId },
          });
          return;
        }

        replaceThreadInLeaf(previewLeafId, threadId);
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
          const existingLeaf = findLeafByThreadId(splitGroup.root, threadId);
          if (existingLeaf) {
            setFocusedLeaf(existingLeaf.id);
            return;
          }
          if (sourceLeafId) {
            splitLeaf(sourceLeafId, threadId, splitDirection, false);
            return;
          }
        }

        splitThread(sourceThreadId, threadId, splitDirection, false);
        return;
      }

      if (splitGroup) {
        const existingLeaf = findLeafByThreadId(splitGroup.root, threadId);
        if (existingLeaf) {
          setFocusedLeaf(existingLeaf.id);
          return;
        }
        replaceThreadInFocusedLeaf(threadId);
        return;
      }

      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [
      clearDraftThread,
      closePane,
      navigate,
      previewLeafId,
      previewThreadId,
      replaceThreadInFocusedLeaf,
      replaceThreadInLeaf,
      resetPalette,
      setFocusedLeaf,
      sourceLeafId,
      sourceThreadId,
      splitDirection,
      splitGroup,
      splitLeaf,
      splitThread,
    ],
  );

  const handleSelectThread = useCallback(
    (threadId: ThreadId) => {
      activateThread(threadId);
    },
    [activateThread],
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
        case "thread":
          handleSelectThread(item.thread.id);
          break;
        case "project":
          handleSelectProject(item.project.id);
          break;
      }
    },
    [handleNewThread, handleSelectProject, handleSelectThread],
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
          <CommandInput
            placeholder={
              paletteMode === "split-right"
                ? "Split right with a thread or project…"
                : paletteMode === "split-down"
                  ? "Split down with a thread or project…"
                  : "Search threads and projects…"
            }
          />
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
              {splitDirection ? "split" : "select"}
            </span>
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
