import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ColumnsIcon,
  FolderIcon,
  GitBranchIcon,
  MessageSquareIcon,
  PlusIcon,
  SquarePenIcon,
} from "lucide-react";
import { type GitStackedAction, type ProjectId, ThreadId } from "@t3tools/contracts";
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
import {
  gitBranchesQueryOptions,
  gitInitMutationOptions,
  gitPullMutationOptions,
  gitRunStackedActionMutationOptions,
  gitStatusQueryOptions,
} from "../lib/gitReactQuery";
import { isMacPlatform, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { findLeafByThreadId, type SplitDirection, useSplitViewStore } from "../splitViewStore";
import { useStore } from "../store";
import { preferredTerminalEditor } from "../terminal-links";
import { renameThreadTitle } from "../threadMeta";
import { DEFAULT_RUNTIME_MODE } from "../types";
import type { Thread } from "../types";
import {
  buildPaletteItemGroups,
  paletteItemKey,
  type PaletteItem,
  type PaletteItemGroup,
} from "./commandPaletteGroups";
import {
  buildMenuItems,
  resolveDefaultBranchActionDialogCopy,
  resolveQuickAction,
  summarizeGitResult,
} from "./GitActionsControl.logic";
import { toastManager } from "./ui/toast";

type RenameDraft =
  | { kind: "thread"; thread: Thread }
  | { kind: "workspace"; workspaceId: string; name: string }
  | null;

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
    throw new Error("Clipboard API unavailable.");
  }
  await navigator.clipboard.writeText(text);
}

function paletteItemSearchText(item: PaletteItem): string {
  switch (item.kind) {
    case "new-thread":
      return `new thread ${item.project.name} ${item.project.cwd}`;
    case "rename-thread":
      return `rename thread ${item.thread.title}`;
    case "mark-thread-unread":
      return `mark thread unread ${item.thread.title}`;
    case "copy-thread-id":
      return `copy thread id ${item.thread.title} ${item.thread.id}`;
    case "rename-workspace":
      return `set workspace name rename workspace ${item.name}`;
    case "open-editor":
      return `open ${item.label} editor`;
    case "open-file-manager":
      return `open ${item.label} file manager`;
    case "git-action":
      return `git ${item.label} ${item.subtitle ?? ""}`;
    case "submit-rename":
      return "save rename";
    case "cancel-rename":
      return "back cancel rename";
    case "workspace":
      return `workspace ${item.name} ${item.threadCount}`;
    case "thread":
      return `${item.thread.title || "untitled thread"} ${item.project?.name ?? ""} ${item.project?.cwd ?? ""}`;
  }
}

function isPaletteItem(value: unknown): value is PaletteItem {
  return value !== null && typeof value === "object" && "kind" in value;
}

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const [renameDraft, setRenameDraft] = useState<RenameDraft>(null);
  const highlightedItemRef = useRef<PaletteItem | null>(null);

  const open = useCommandPaletteStore((state) => state.open);
  const paletteMode = useCommandPaletteStore((state) => state.mode);
  const sourceThreadId = useCommandPaletteStore((state) => state.sourceThreadId);
  const sourceLeafId = useCommandPaletteStore((state) => state.sourceLeafId);
  const previewThreadId = useCommandPaletteStore((state) => state.previewThreadId);
  const previewLeafId = useCommandPaletteStore((state) => state.previewLeafId);
  const closePaletteStore = useCommandPaletteStore((state) => state.closePalette);
  const toggleDefaultPalette = useCommandPaletteStore((state) => state.toggleDefaultPalette);

  const queryClient = useQueryClient();
  const projects = useStore((state) => state.projects);
  const threads = useStore((state) => state.threads);
  const markThreadUnread = useStore((state) => state.markThreadUnread);
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
  const deactivateWorkspace = useSplitViewStore((state) => state.deactivateWorkspace);
  const renameWorkspace = useSplitViewStore((state) => state.renameWorkspace);
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
  const isRenameStep = renameDraft !== null;
  const activeThread =
    routeThreadId !== null ? (threads.find((thread) => thread.id === routeThreadId) ?? null) : null;
  const activeProject =
    activeThread !== null
      ? (projects.find((project) => project.id === activeThread.projectId) ?? null)
      : null;
  const openCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
  const gitCwd = openCwd;
  const shouldLoadGitActions = open && paletteMode === "default" && gitCwd !== null;
  const { data: gitStatus = null } = useQuery({
    ...gitStatusQueryOptions(gitCwd),
    enabled: shouldLoadGitActions,
  });
  const { data: branchList = null } = useQuery({
    ...gitBranchesQueryOptions(gitCwd),
    enabled: shouldLoadGitActions,
  });
  const initGitMutation = useMutation(gitInitMutationOptions({ cwd: gitCwd, queryClient }));
  const pullGitMutation = useMutation(gitPullMutationOptions({ cwd: gitCwd, queryClient }));
  const runGitActionMutation = useMutation(
    gitRunStackedActionMutationOptions({ cwd: gitCwd, queryClient }),
  );
  const isRepo = branchList?.isRepo ?? true;
  const hasOriginRemote = branchList?.hasOriginRemote ?? false;
  const isDefaultBranch = useMemo(() => {
    const branchName = gitStatus?.branch;
    if (!branchName) return false;
    const current = branchList?.branches.find((branch) => branch.name === branchName);
    return current?.isDefault ?? (branchName === "main" || branchName === "master");
  }, [branchList?.branches, gitStatus?.branch]);

  const itemGroups = useMemo(() => {
    if (renameDraft) {
      return [
        {
          label: renameDraft.kind === "thread" ? "Rename Thread" : "Set Workspace Name",
          items: [{ kind: "submit-rename" }, { kind: "cancel-rename" }],
        },
      ];
    }

    const baseGroups = buildPaletteItemGroups({
      paletteMode,
      projects,
      threads,
      workspaces,
      routeThreadId,
      activeWorkspaceId,
      splitGroup,
      projectDraftThreadIdByProjectId,
    });
    const threadActionItems: PaletteItem[] =
      paletteMode === "default" && activeThread
        ? [
            { kind: "mark-thread-unread", thread: activeThread },
            { kind: "copy-thread-id", thread: activeThread },
          ]
        : [];
    const openActionItems: PaletteItem[] =
      paletteMode === "default" && openCwd
        ? [
            {
              kind: "open-editor",
              cwd: openCwd,
              label: activeThread?.worktreePath ? "worktree" : "project",
            },
            {
              kind: "open-file-manager",
              cwd: openCwd,
              label: activeThread?.worktreePath ? "worktree" : "project",
            },
          ]
        : [];
    const gitActionItems: PaletteItem[] = [];
    if (paletteMode === "default" && gitCwd) {
      if (!isRepo) {
        gitActionItems.push({ kind: "git-action", actionId: "init", label: "Initialize Git" });
      } else {
        const quickAction = resolveQuickAction(gitStatus, false, isDefaultBranch, hasOriginRemote);
        if (quickAction.kind === "run_pull") {
          gitActionItems.push({ kind: "git-action", actionId: "pull", label: quickAction.label });
        }
        for (const item of buildMenuItems(gitStatus, false, hasOriginRemote)) {
          if (item.disabled) continue;
          if (item.id === "commit") {
            gitActionItems.push({ kind: "git-action", actionId: "commit", label: item.label });
          } else if (item.id === "push") {
            gitActionItems.push({ kind: "git-action", actionId: "push", label: item.label });
          } else if (item.kind === "open_pr") {
            gitActionItems.push({
              kind: "git-action",
              actionId: "view-pr",
              label: item.label,
              ...(gitStatus?.pr?.url ? { prUrl: gitStatus.pr.url } : {}),
            });
          } else {
            gitActionItems.push({ kind: "git-action", actionId: "create-pr", label: item.label });
          }
        }
      }
    }

    const recentGroup = baseGroups.find((group) => group.label === "Recents");
    const baseActionGroup = baseGroups.find((group) => group.label === "Actions");
    const remainingGroups = baseGroups.filter(
      (group) => group.label !== "Recents" && group.label !== "Actions",
    );
    return [
      ...(recentGroup ? [recentGroup] : []),
      {
        label: "Actions",
        items: [
          ...(baseActionGroup?.items ?? []),
          ...threadActionItems,
          ...openActionItems,
          ...gitActionItems,
        ],
      },
      ...remainingGroups,
    ];
  }, [
    activeWorkspaceId,
    activeThread,
    gitCwd,
    gitStatus,
    hasOriginRemote,
    isDefaultBranch,
    isRepo,
    openCwd,
    paletteMode,
    projectDraftThreadIdByProjectId,
    projects,
    renameDraft,
    routeThreadId,
    splitGroup,
    threads,
    workspaces,
  ]);

  const resetPalette = useCallback(() => {
    closePaletteStore();
    setQuery("");
    setRenameDraft(null);
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
      const workspaceWithThread = workspaces.find((workspace) =>
        findLeafByThreadId(workspace.root, threadId),
      );
      if (workspaceWithThread) {
        const leaf = findLeafByThreadId(workspaceWithThread.root, threadId);
        if (previewLeafId && previewThreadId) {
          closePane(previewLeafId);
          clearDraftThread(previewThreadId);
        }
        resetPalette();
        activateWorkspace(workspaceWithThread.id);
        if (leaf) {
          setFocusedLeaf(leaf.id);
        }
        void navigate({
          to: "/$threadId",
          params: { threadId },
        });
        return;
      }

      if (previewLeafId && previewThreadId) {
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
            void navigate({
              to: "/$threadId",
              params: { threadId },
            });
            return;
          }
          if (sourceLeafId) {
            splitLeaf(sourceLeafId, threadId, splitDirection, false);
            void navigate({
              to: "/$threadId",
              params: { threadId },
            });
            return;
          }
        }

        splitThread(sourceThreadId, threadId, splitDirection, false);
        void navigate({
          to: "/$threadId",
          params: { threadId },
        });
        return;
      }

      if (paletteMode === "replace-focused" && splitGroup) {
        const existingLeaf = findLeafByThreadId(splitGroup.root, threadId);
        if (existingLeaf) {
          setFocusedLeaf(existingLeaf.id);
          void navigate({
            to: "/$threadId",
            params: { threadId },
          });
          return;
        }
        replaceThreadInFocusedLeaf(threadId);
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
      activateWorkspace,
      deactivateWorkspace,
      navigate,
      paletteMode,
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
      workspaces,
    ],
  );

  const handleSelectThread = useCallback(
    (threadId: ThreadId) => {
      activateThread(threadId);
    },
    [activateThread],
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

  const handleStartRenameThread = useCallback((thread: Thread) => {
    setRenameDraft({ kind: "thread", thread });
    setQuery(thread.title);
    highlightedItemRef.current = null;
  }, []);

  const handleStartRenameWorkspace = useCallback((workspaceId: string, name: string) => {
    setRenameDraft({ kind: "workspace", workspaceId, name });
    setQuery(name);
    highlightedItemRef.current = null;
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenameDraft(null);
    setQuery("");
    highlightedItemRef.current = null;
  }, []);

  const handleSubmitRename = useCallback(async () => {
    if (!renameDraft) return;

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      toastManager.add({
        type: "warning",
        title:
          renameDraft.kind === "thread"
            ? "Thread title cannot be empty"
            : "Workspace name cannot be empty",
      });
      return;
    }

    if (renameDraft.kind === "thread") {
      if (trimmed === renameDraft.thread.title) {
        handleCancelRename();
        return;
      }
      try {
        await renameThreadTitle(renameDraft.thread.id, trimmed);
        resetPalette();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      return;
    }

    if (trimmed === renameDraft.name) {
      handleCancelRename();
      return;
    }
    renameWorkspace(renameDraft.workspaceId, trimmed);
    resetPalette();
  }, [handleCancelRename, query, renameDraft, renameWorkspace, resetPalette]);

  const handleMarkThreadUnread = useCallback(
    (threadId: ThreadId) => {
      markThreadUnread(threadId);
      resetPalette();
    },
    [markThreadUnread, resetPalette],
  );

  const handleCopyThreadId = useCallback(
    async (threadId: ThreadId) => {
      try {
        await copyTextToClipboard(threadId);
        toastManager.add({
          type: "success",
          title: "Thread ID copied",
          description: threadId,
        });
        resetPalette();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to copy thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [resetPalette],
  );

  const handleOpenPath = useCallback(
    async (cwd: string, editor: "preferred" | "file-manager") => {
      const api = readNativeApi();
      if (!api) {
        toastManager.add({ type: "error", title: "Open action is unavailable." });
        return;
      }
      try {
        await api.shell.openInEditor(
          cwd,
          editor === "file-manager" ? "file-manager" : preferredTerminalEditor(),
        );
        resetPalette();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Unable to open path",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [resetPalette],
  );

  const handleGitAction = useCallback(
    async (actionId: Extract<PaletteItem, { kind: "git-action" }>) => {
      const api = readNativeApi();
      if (!api || !gitCwd) return;

      if (actionId.actionId === "view-pr") {
        if (!actionId.prUrl) {
          toastManager.add({ type: "error", title: "No open PR found." });
          return;
        }
        try {
          await api.shell.openExternal(actionId.prUrl);
          resetPalette();
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Unable to open PR link",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }

      if (actionId.actionId === "init") {
        const promise = initGitMutation.mutateAsync();
        toastManager.promise(promise, {
          loading: { title: "Initializing Git..." },
          success: () => ({ title: "Initialized Git" }),
          error: (error) => ({
            title: "Git init failed",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        });
        await promise.catch(() => undefined);
        resetPalette();
        return;
      }

      if (actionId.actionId === "pull") {
        const promise = pullGitMutation.mutateAsync();
        toastManager.promise(promise, {
          loading: { title: "Pulling..." },
          success: (result) => ({
            title: result.status === "pulled" ? "Pulled" : "Already up to date",
            description:
              result.status === "pulled"
                ? `Updated ${result.branch} from ${result.upstreamBranch ?? "upstream"}`
                : `${result.branch} is already synchronized.`,
          }),
          error: (error) => ({
            title: "Pull failed",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        });
        await promise.catch(() => undefined);
        resetPalette();
        return;
      }

      const stackedAction: GitStackedAction =
        actionId.actionId === "commit"
          ? "commit"
          : actionId.actionId === "push"
            ? "commit_push"
            : "commit_push_pr";

      if (
        isDefaultBranch &&
        (stackedAction === "commit_push" || stackedAction === "commit_push_pr")
      ) {
        const copy = resolveDefaultBranchActionDialogCopy({
          action: stackedAction,
          branchName: gitStatus?.branch ?? "default branch",
          includesCommit: true,
        });
        const confirmed = await api.dialogs.confirm([copy.title, copy.description].join("\n"));
        if (!confirmed) return;
      }

      const promise = runGitActionMutation.mutateAsync({ action: stackedAction });
      toastManager.promise(promise, {
        loading: { title: `Running ${actionId.label}...` },
        success: (result) => summarizeGitResult(result),
        error: (error) => ({
          title: "Git action failed",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      });
      await promise.catch(() => undefined);
      resetPalette();
    },
    [
      gitCwd,
      gitStatus?.branch,
      initGitMutation,
      isDefaultBranch,
      pullGitMutation,
      resetPalette,
      runGitActionMutation,
    ],
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

  const handleItemClick = useCallback(
    (item: PaletteItem) => {
      switch (item.kind) {
        case "new-thread":
          handleNewThread(item.project.id);
          break;
        case "rename-thread":
          handleStartRenameThread(item.thread);
          break;
        case "mark-thread-unread":
          handleMarkThreadUnread(item.thread.id);
          break;
        case "copy-thread-id":
          void handleCopyThreadId(item.thread.id);
          break;
        case "rename-workspace":
          handleStartRenameWorkspace(item.workspaceId, item.name);
          break;
        case "open-editor":
          void handleOpenPath(item.cwd, "preferred");
          break;
        case "open-file-manager":
          void handleOpenPath(item.cwd, "file-manager");
          break;
        case "git-action":
          void handleGitAction(item);
          break;
        case "submit-rename":
          void handleSubmitRename();
          break;
        case "cancel-rename":
          handleCancelRename();
          break;
        case "workspace":
          handleSelectWorkspace(item.workspaceId);
          break;
        case "thread":
          handleSelectThread(item.thread.id);
          break;
      }
    },
    [
      handleNewThread,
      handleStartRenameThread,
      handleMarkThreadUnread,
      handleCopyThreadId,
      handleStartRenameWorkspace,
      handleOpenPath,
      handleGitAction,
      handleSubmitRename,
      handleCancelRename,
      handleSelectThread,
      handleSelectWorkspace,
    ],
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
          itemToStringValue={(item) => {
            if (!isPaletteItem(item)) return "";
            if (isRenameStep && item.kind === "submit-rename") {
              return `${query} save rename`;
            }
            if (isRenameStep && item.kind === "cancel-rename") {
              return `${query} back cancel rename`;
            }
            return paletteItemSearchText(item);
          }}
          onItemHighlighted={(item) => {
            highlightedItemRef.current = isPaletteItem(item) ? item : null;
          }}
        >
          <CommandInput
            placeholder={
              isRenameStep
                ? renameDraft?.kind === "thread"
                  ? "Type the new thread name…"
                  : "Type the workspace name…"
                : paletteMode === "split-right"
                  ? "Split right with a thread…"
                  : paletteMode === "split-down"
                    ? "Split down with a thread…"
                    : paletteMode === "replace-focused"
                      ? "Replace the focused pane with a thread…"
                      : "Search threads, workspaces, and actions…"
            }
          />
          <CommandPanel
            onKeyDownCapture={(event: React.KeyboardEvent<HTMLDivElement>) => {
              if (isRenameStep && event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                handleCancelRename();
                return;
              }
              if (event.key !== "Enter" || !highlightedItemRef.current) {
                if (isRenameStep && event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleSubmitRename();
                }
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
              {isRenameStep
                ? "save"
                : splitDirection
                  ? "split"
                  : paletteMode === "replace-focused"
                    ? "replace"
                    : "select"}
            </span>
            <span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                esc
              </kbd>{" "}
              {isRenameStep ? "back" : "close"}
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function CommandPaletteResults(props: { onItemClick: (item: PaletteItem) => void }) {
  const filteredItemGroups = useCommandFilteredItems<PaletteItemGroup>();
  const visibleGroups = filteredItemGroups.filter((group) => group.items.length > 0);

  return (
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      {visibleGroups.map((group) => (
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
    case "rename-thread":
      return (
        <>
          <SquarePenIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="block truncate">Rename thread</span>
            <span className="block truncate text-xs text-muted-foreground">
              {item.thread.title || "Untitled thread"}
            </span>
          </div>
        </>
      );
    case "mark-thread-unread":
      return (
        <>
          <MessageSquareIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="block truncate">Mark thread unread</span>
            <span className="block truncate text-xs text-muted-foreground">
              {item.thread.title || "Untitled thread"}
            </span>
          </div>
        </>
      );
    case "copy-thread-id":
      return (
        <>
          <MessageSquareIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="block truncate">Copy thread ID</span>
            <span className="block truncate text-xs text-muted-foreground">{item.thread.id}</span>
          </div>
        </>
      );
    case "rename-workspace":
      return (
        <>
          <SquarePenIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="block truncate">Set workspace name</span>
            <span className="block truncate text-xs text-muted-foreground">{item.name}</span>
          </div>
        </>
      );
    case "submit-rename":
      return (
        <>
          <SquarePenIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Save</span>
        </>
      );
    case "cancel-rename":
      return (
        <>
          <span className="mr-2 size-4 shrink-0 text-center text-muted-foreground">←</span>
          <span className="truncate">Back</span>
        </>
      );
    case "open-editor":
      return (
        <>
          <FolderIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Open {item.label} in editor</span>
        </>
      );
    case "open-file-manager":
      return (
        <>
          <FolderIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">Reveal {item.label} in file manager</span>
        </>
      );
    case "git-action":
      return (
        <>
          <GitBranchIcon className="mr-2 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="block truncate">{item.label}</span>
            {item.subtitle ? (
              <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
            ) : null}
          </div>
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
              {item.threadCount} {item.threadCount === 1 ? "thread" : "threads"}
            </span>
          </div>
        </>
      );
  }
}
