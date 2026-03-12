import { type ProjectId, type ResolvedKeybindingsConfig, ThreadId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useState, useMemo, type ReactNode, useCallback, useEffect } from "react";

import ChatView from "../components/ChatView";
import ThreadTerminalDrawer from "../components/ThreadTerminalDrawer";
import { SplitPanelRoot, SplitDropPreview, SplitPlaceholder } from "../components/SplitPanel";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  clearDiffSearchParams,
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { shortcutLabelForCommand } from "../keybindings";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { projectScriptRuntimeEnv } from "../projectScripts";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { useStore } from "../store";
import { useCommandPaletteStore } from "../commandPaletteStore";
import {
  useSplitViewStore,
  computeClosestDropZone,
  dropZoneToSplit,
  type DropZone,
  findLeaf,
  findLeafByThreadId,
  firstLeaf,
} from "../splitViewStore";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { MAX_THREAD_TERMINAL_COUNT } from "../types";
import { newThreadId, randomUUID } from "../lib/utils";
import { closeTerminalSession } from "../lib/closeTerminalSession";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const DiffPanelSheet = (props: {
  children: ReactNode;
  diffOpen: boolean;
  onCloseDiff: () => void;
}) => {
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-[820px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const DiffLoadingFallback = (props: { inline: boolean }) => {
  if (props.inline) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4 text-center text-xs text-muted-foreground/70">
        Loading diff viewer...
      </div>
    );
  }

  return (
    <aside className="flex h-full w-[560px] shrink-0 items-center justify-center border-l border-border bg-card px-4 text-center text-xs text-muted-foreground/70">
      Loading diff viewer...
    </aside>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <Suspense fallback={<DiffLoadingFallback inline />}>
          <DiffPanel mode="sidebar" />
        </Suspense>
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

/** Renders a single thread pane inside a split leaf. */
function SplitThreadPane({
  threadId,
  onCloseSplitPane,
}: {
  threadId: ThreadId;
  onCloseSplitPane: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <ChatView key={threadId} threadId={threadId} onCloseSplitPane={onCloseSplitPane} />
    </div>
  );
}

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

/**
 * Route-level terminal drawer that renders BELOW the SidebarInset.
 * It auto-switches to show the focused thread's terminal when the split
 * pane focus changes.
 */
function RouteTerminalDrawer({ focusedThreadId }: { focusedThreadId: ThreadId }) {
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const draftThreadsByThreadId = useComposerDraftStore((s) => s.draftThreadsByThreadId);

  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const keybindings = serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;

  const terminalState = useTerminalStateStore((state) =>
    selectThreadTerminalState(state.terminalStateByThreadId, focusedThreadId),
  );
  const terminalFocusRequestId = useTerminalStateStore((s) => s.terminalFocusRequestId);
  const requestTerminalFocus = useTerminalStateStore((s) => s.requestTerminalFocus);
  const storeSetTerminalHeight = useTerminalStateStore((s) => s.setTerminalHeight);
  const storeSplitTerminal = useTerminalStateStore((s) => s.splitTerminal);
  const storeNewTerminal = useTerminalStateStore((s) => s.newTerminal);
  const storeSetActiveTerminal = useTerminalStateStore((s) => s.setActiveTerminal);
  const storeCloseTerminal = useTerminalStateStore((s) => s.closeTerminal);

  // Resolve the thread and project for the focused thread
  const serverThread = threads.find((t) => t.id === focusedThreadId);
  const draftThread = draftThreadsByThreadId[focusedThreadId] ?? null;
  const projectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
  const activeProject = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const worktreePath = serverThread?.worktreePath ?? null;
  const cwd = worktreePath ?? activeProject?.cwd ?? null;

  const threadTerminalRuntimeEnv = useMemo(() => {
    if (!activeProject?.cwd) return {};
    return projectScriptRuntimeEnv({
      project: {
        cwd: activeProject.cwd,
      },
      worktreePath,
    });
  }, [activeProject?.cwd, worktreePath]);

  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split"),
    [keybindings],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new"),
    [keybindings],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close"),
    [keybindings],
  );

  const hasReachedTerminalLimit = terminalState.terminalIds.length >= MAX_THREAD_TERMINAL_COUNT;

  const setTerminalHeight = useCallback(
    (height: number) => {
      storeSetTerminalHeight(focusedThreadId, height);
    },
    [focusedThreadId, storeSetTerminalHeight],
  );
  const splitTerminal = useCallback(() => {
    if (hasReachedTerminalLimit) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeSplitTerminal(focusedThreadId, terminalId);
    requestTerminalFocus();
  }, [focusedThreadId, storeSplitTerminal, hasReachedTerminalLimit, requestTerminalFocus]);
  const createNewTerminal = useCallback(() => {
    if (hasReachedTerminalLimit) return;
    const terminalId = `terminal-${randomUUID()}`;
    storeNewTerminal(focusedThreadId, terminalId);
    requestTerminalFocus();
  }, [focusedThreadId, storeNewTerminal, hasReachedTerminalLimit, requestTerminalFocus]);
  const activateTerminal = useCallback(
    (terminalId: string) => {
      storeSetActiveTerminal(focusedThreadId, terminalId);
      requestTerminalFocus();
    },
    [focusedThreadId, storeSetActiveTerminal, requestTerminalFocus],
  );
  const closeTerminal = useCallback(
    (terminalId: string) => {
      const isFinalTerminal = terminalState.terminalIds.length <= 1;
      void closeTerminalSession({ threadId: focusedThreadId, terminalId, isFinalTerminal }).catch(
        () => undefined,
      );
      storeCloseTerminal(focusedThreadId, terminalId);
      requestTerminalFocus();
    },
    [focusedThreadId, storeCloseTerminal, terminalState.terminalIds.length, requestTerminalFocus],
  );

  const drawerOpen = terminalState.terminalOpen;

  if (!drawerOpen || !cwd || !activeProject) {
    return null;
  }

  return (
    <ThreadTerminalDrawer
      key={focusedThreadId}
      threadId={focusedThreadId}
      cwd={cwd}
      runtimeEnv={threadTerminalRuntimeEnv}
      height={terminalState.terminalHeight}
      terminalIds={terminalState.terminalIds}
      activeTerminalId={terminalState.activeTerminalId}
      terminalGroups={terminalState.terminalGroups}
      activeTerminalGroupId={terminalState.activeTerminalGroupId}
      focusRequestId={terminalFocusRequestId}
      onSplitTerminal={splitTerminal}
      onNewTerminal={createNewTerminal}
      {...(splitTerminalShortcutLabel ? { splitShortcutLabel: splitTerminalShortcutLabel } : {})}
      {...(newTerminalShortcutLabel ? { newShortcutLabel: newTerminalShortcutLabel } : {})}
      {...(closeTerminalShortcutLabel ? { closeShortcutLabel: closeTerminalShortcutLabel } : {})}
      onActiveTerminalChange={activateTerminal}
      onCloseTerminal={closeTerminal}
      onHeightChange={setTerminalHeight}
    />
  );
}

function ChatThreadRouteView() {
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const threads = useStore((store) => store.threads);
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const threadExists = threads.some((thread) => thread.id === threadId);
  const draftThreadExists = Object.hasOwn(draftThreadsByThreadId, threadId);
  const routeThreadExists = threadExists || draftThreadExists;
  const diffOpen = search.diff === "1";
  const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
  const commandPaletteOpen = useCommandPaletteStore((state) => state.open);
  const commandPaletteMode = useCommandPaletteStore((state) => state.mode);
  const commandPalettePreviewLeafId = useCommandPaletteStore((state) => state.previewLeafId);
  const commandPalettePreviewThreadId = useCommandPaletteStore((state) => state.previewThreadId);

  // Split view state
  const splitGroup = useSplitViewStore((s) => s.group);
  const setFocusedLeaf = useSplitViewStore((s) => s.setFocusedLeaf);
  const splitThread = useSplitViewStore((s) => s.splitThread);
  const splitLeaf = useSplitViewStore((s) => s.splitLeaf);
  const replaceThreadInLeaf = useSplitViewStore((s) => s.replaceThreadInLeaf);
  const reconcileThreads = useSplitViewStore((s) => s.reconcileThreads);
  const setProjectDraftThreadId = useComposerDraftStore((s) => s.setProjectDraftThreadId);
  const isSplitView = splitGroup !== null;

  // Drop zone visual state for single-thread mode
  const [initialDropZone, setInitialDropZone] = useState<DropZone | null>(null);

  const createProjectDraftThread = useCallback(
    (projectId: ProjectId): ThreadId => {
      const tid = newThreadId();
      setProjectDraftThreadId(projectId, tid, {
        createdAt: new Date().toISOString(),
        branch: null,
        worktreePath: null,
        envMode: "local",
        runtimeMode: "full-access",
      });
      return tid;
    },
    [setProjectDraftThreadId],
  );

  /** Handle a thread/project dropped onto a split pane's drop zone. */
  const handleSplitDrop = useCallback(
    (
      leafId: string,
      droppedThreadId: ThreadId | null,
      projectId: string | null,
      zone: DropZone,
    ) => {
      if (droppedThreadId) {
        if (zone === "center") {
          if (!isSplitView) {
            void navigate({
              to: "/$threadId",
              params: { threadId: droppedThreadId },
            });
            return;
          }
          const existingLeaf = splitGroup
            ? findLeafByThreadId(splitGroup.root, droppedThreadId)
            : null;
          if (existingLeaf) {
            setFocusedLeaf(existingLeaf.id);
          } else {
            replaceThreadInLeaf(leafId, droppedThreadId);
          }
          return;
        }
        const { direction, insertBefore } = dropZoneToSplit(zone);
        if (isSplitView) {
          splitLeaf(leafId, droppedThreadId, direction, insertBefore);
        } else {
          splitThread(threadId, droppedThreadId, direction, insertBefore);
        }
      } else if (projectId) {
        const tid = createProjectDraftThread(projectId as ProjectId);
        if (zone === "center") {
          if (isSplitView) {
            replaceThreadInLeaf(leafId, tid);
          } else {
            void navigate({
              to: "/$threadId",
              params: { threadId: tid },
            });
          }
          return;
        }
        const { direction, insertBefore } = dropZoneToSplit(zone);
        if (isSplitView) {
          splitLeaf(leafId, tid, direction, insertBefore);
        } else {
          splitThread(threadId, tid, direction, insertBefore);
        }
      }
    },
    [
      createProjectDraftThread,
      isSplitView,
      navigate,
      replaceThreadInLeaf,
      setFocusedLeaf,
      splitGroup,
      splitLeaf,
      splitThread,
      threadId,
    ],
  );

  /** Handle initial drop onto the single-thread view (not yet split). */
  const handleInitialDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const droppedThreadId = e.dataTransfer.getData("application/t3-thread-id") || null;
      const droppedProjectId = e.dataTransfer.getData("application/t3-project-id") || null;
      const dragType = e.dataTransfer.getData("application/t3-drag-type");

      const rect = e.currentTarget.getBoundingClientRect();
      const zone = computeClosestDropZone(e.clientX, e.clientY, rect);
      if (dragType === "project" && droppedProjectId) {
        const tid = createProjectDraftThread(droppedProjectId as ProjectId);
        if (zone === "center") {
          void navigate({
            to: "/$threadId",
            params: { threadId: tid },
          });
          return;
        }
        const { direction, insertBefore } = dropZoneToSplit(zone);
        splitThread(threadId, tid, direction, insertBefore);
      } else if (droppedThreadId && droppedThreadId !== threadId) {
        if (zone === "center") {
          void navigate({
            to: "/$threadId",
            params: { threadId: droppedThreadId as ThreadId },
          });
          return;
        }
        const { direction, insertBefore } = dropZoneToSplit(zone);
        splitThread(threadId, droppedThreadId as ThreadId, direction, insertBefore);
      }
    },
    [createProjectDraftThread, navigate, splitThread, threadId],
  );

  const availableThreadIds = useMemo(() => {
    const next = new Set<ThreadId>();
    for (const thread of threads) {
      next.add(thread.id);
    }
    for (const draftThreadId of Object.keys(draftThreadsByThreadId) as ThreadId[]) {
      next.add(draftThreadId);
    }
    return next;
  }, [draftThreadsByThreadId, threads]);

  const routeFallbackThreadId = useMemo(() => {
    if (!splitGroup) return null;
    const focusedLeaf = findLeaf(splitGroup.root, splitGroup.focusedLeafId);
    return focusedLeaf?.threadId ?? firstLeaf(splitGroup.root).threadId;
  }, [splitGroup]);
  const focusedThreadId = routeFallbackThreadId ?? threadId;

  const closeDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId: focusedThreadId },
      search: (previous) => {
        return clearDiffSearchParams(previous) as unknown as DiffRouteSearch;
      },
    });
  }, [focusedThreadId, navigate]);
  const openDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId: focusedThreadId },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [focusedThreadId, navigate]);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    const remainingThreadId = reconcileThreads(availableThreadIds);
    if (!routeThreadExists && remainingThreadId && remainingThreadId !== threadId) {
      void navigate({
        to: "/$threadId",
        params: { threadId: remainingThreadId },
        replace: true,
      });
    }
  }, [
    availableThreadIds,
    navigate,
    reconcileThreads,
    routeThreadExists,
    threadId,
    threadsHydrated,
  ]);

  useEffect(() => {
    if (!threadsHydrated || routeThreadExists || isSplitView) {
      return;
    }

    if (routeFallbackThreadId && routeFallbackThreadId !== threadId) {
      void navigate({
        to: "/$threadId",
        params: { threadId: routeFallbackThreadId },
        replace: true,
      });
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [isSplitView, navigate, routeFallbackThreadId, routeThreadExists, threadsHydrated, threadId]);

  useEffect(() => {
    if (
      !threadsHydrated ||
      !isSplitView ||
      !routeFallbackThreadId ||
      routeFallbackThreadId === threadId
    ) {
      return;
    }
    if (!availableThreadIds.has(routeFallbackThreadId)) {
      return;
    }
    void navigate({
      to: "/$threadId",
      params: { threadId: routeFallbackThreadId },
      replace: true,
      search: (previous) => previous,
    });
  }, [availableThreadIds, isSplitView, navigate, routeFallbackThreadId, threadId, threadsHydrated]);

  if (!threadsHydrated || (!routeThreadExists && !isSplitView)) {
    return null;
  }

  // ── Split view mode ──────────────────────────────────────────────
  if (isSplitView) {
    const renderThread = (tid: ThreadId, leafId: string) => {
      const isPaletteSplitPreview =
        commandPaletteOpen &&
        commandPaletteMode !== "default" &&
        commandPalettePreviewLeafId === leafId &&
        commandPalettePreviewThreadId === tid;

      if (isPaletteSplitPreview) {
        return (
          <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background p-2 text-foreground">
            <SplitPlaceholder />
          </div>
        );
      }

      const onClose = () => {
        const remaining = useSplitViewStore.getState().closePane(leafId);
        if (remaining) {
          void navigate({
            to: "/$threadId",
            params: { threadId: remaining },
          });
        }
      };
      return <SplitThreadPane threadId={tid} onCloseSplitPane={onClose} />;
    };

    return (
      <div className="flex h-dvh w-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <SidebarInset className="min-h-0 flex-1 overflow-hidden overscroll-y-none bg-muted py-3 pl-2 pr-3 text-foreground dark:bg-card">
            <SplitPanelRoot renderThread={renderThread} onSplitDrop={handleSplitDrop} />
          </SidebarInset>
          {!shouldUseDiffSheet && (
            <DiffPanelInlineSidebar
              diffOpen={diffOpen}
              onCloseDiff={closeDiff}
              onOpenDiff={openDiff}
            />
          )}
          {shouldUseDiffSheet && (
            <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
              <Suspense fallback={<DiffLoadingFallback inline={false} />}>
                <DiffPanel mode="sheet" />
              </Suspense>
            </DiffPanelSheet>
          )}
        </div>
        <RouteTerminalDrawer focusedThreadId={focusedThreadId} />
      </div>
    );
  }

  // ── Single thread mode (original behaviour) ─────────────────────
  // Wrap in a drop target so threads can be dragged here to create an initial split
  const singleThreadPane = (
    <SidebarInset
      className="relative min-h-0 flex-1 overflow-hidden overscroll-y-none bg-muted py-3 pl-2 pr-3 text-foreground dark:bg-card"
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes("application/t3-thread-id") ||
          e.dataTransfer.types.includes("application/t3-project-id")
        ) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          setInitialDropZone(computeClosestDropZone(e.clientX, e.clientY, rect));
        }
      }}
      onDragLeave={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX <= rect.left ||
          e.clientX >= rect.right ||
          e.clientY <= rect.top ||
          e.clientY >= rect.bottom
        ) {
          setInitialDropZone(null);
        }
      }}
      onDrop={(e) => {
        setInitialDropZone(null);
        handleInitialDrop(e);
      }}
    >
      <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden rounded-lg bg-background">
        <SplitDropPreview zone={initialDropZone}>
          <ChatView key={threadId} threadId={threadId} onCloseSplitPane={undefined} />
        </SplitDropPreview>
      </div>
    </SidebarInset>
  );

  if (!shouldUseDiffSheet) {
    return (
      <div className="flex h-dvh w-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {singleThreadPane}
          <DiffPanelInlineSidebar
            diffOpen={diffOpen}
            onCloseDiff={closeDiff}
            onOpenDiff={openDiff}
          />
        </div>
        <RouteTerminalDrawer focusedThreadId={focusedThreadId} />
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {singleThreadPane}
        <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
          <Suspense fallback={<DiffLoadingFallback inline={false} />}>
            <DiffPanel mode="sheet" />
          </Suspense>
        </DiffPanelSheet>
      </div>
      <RouteTerminalDrawer focusedThreadId={focusedThreadId} />
    </div>
  );
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatThreadRouteView,
});
