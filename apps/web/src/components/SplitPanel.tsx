import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { ThreadId } from "@t3tools/contracts";
import {
  type SplitNode,
  type SplitPane,
  type SplitBranch,
  type DropZone,
  computeClosestDropZone,
  useSplitViewStore,
  findPane,
  findPaneByThreadId,
} from "../splitViewStore";

// ── Shared callback types ───────────────────────────────────────────

type SplitDropHandler = (
  paneId: string,
  threadId: ThreadId | null,
  projectId: string | null,
  zone: DropZone,
) => void;

const SPLIT_GAP_PX = 8;

// ── Resize handle ───────────────────────────────────────────────────

function ResizeHandle({
  branchId,
  direction,
}: {
  branchId: string;
  direction: "horizontal" | "vertical";
}) {
  const setRatio = useSplitViewStore((s) => s.setRatio);
  const handleRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const handle = handleRef.current;
      if (!handle) return;
      const parent = handle.parentElement;
      if (!parent) return;

      const parentRect = parent.getBoundingClientRect();

      const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
        let ratio: number;
        if (direction === "horizontal") {
          ratio = (moveEvent.clientX - parentRect.left) / parentRect.width;
        } else {
          ratio = (moveEvent.clientY - parentRect.top) / parentRect.height;
        }
        setRatio(branchId, ratio);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [branchId, direction, setRatio],
  );

  return (
    <div
      ref={handleRef}
      onMouseDown={onMouseDown}
      className={`relative z-10 flex-none shrink-0 bg-transparent transition-colors duration-75 hover:bg-primary/20 active:bg-primary/30 ${
        direction === "horizontal" ? "cursor-col-resize" : "cursor-row-resize"
      }`}
      style={direction === "horizontal" ? { width: SPLIT_GAP_PX } : { height: SPLIT_GAP_PX }}
    />
  );
}

// ── Split drop preview ──────────────────────────────────────────────

/** Placeholder shown where a new split pane will appear during drag or palette preview. */
export function SplitPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed border-primary/30 bg-primary/5" />
  );
}

/**
 * Wraps content in a CSS grid with 4 independently animated placeholder
 * slots (top, left, right, bottom). When a drop zone is active the
 * corresponding grid track grows from 0fr → 1fr while the others stay at
 * 0fr, so transitions between any two zones (even perpendicular ones like
 * left → top) animate smoothly without a flex-direction snap.
 */
export function SplitDropPreview({
  zone,
  children,
}: {
  zone: DropZone | null;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden rounded-[inherit] ${
        zone ? "bg-muted dark:bg-card" : ""
      }`}
      style={{
        gridTemplateColumns: `${zone === "left" ? 1 : 0}fr ${zone === "left" ? SPLIT_GAP_PX : 0}px 1fr ${zone === "right" ? SPLIT_GAP_PX : 0}px ${zone === "right" ? 1 : 0}fr`,
        gridTemplateRows: `${zone === "top" ? 1 : 0}fr ${zone === "top" ? SPLIT_GAP_PX : 0}px 1fr ${zone === "bottom" ? SPLIT_GAP_PX : 0}px ${zone === "bottom" ? 1 : 0}fr`,
        transition: "grid-template-columns 200ms ease-out, grid-template-rows 200ms ease-out",
      }}
    >
      {/* Top placeholder */}
      <div style={{ gridRow: 1, gridColumn: "1 / -1" }} className="min-h-0 overflow-hidden">
        {zone === "top" && <SplitPlaceholder />}
      </div>
      {/* Left placeholder */}
      <div style={{ gridRow: 3, gridColumn: 1 }} className="min-h-0 min-w-0 overflow-hidden">
        {zone === "left" && <SplitPlaceholder />}
      </div>
      {/* Content */}
      <div
        style={{ gridRow: 3, gridColumn: 3 }}
        className={`relative flex min-h-0 min-w-0 overflow-hidden ${
          zone ? "rounded-lg bg-background" : "rounded-[inherit]"
        }`}
      >
        {children}
        {zone === "center" && (
          <div className="absolute inset-0 p-2">
            <SplitPlaceholder />
          </div>
        )}
      </div>
      {/* Right placeholder */}
      <div style={{ gridRow: 3, gridColumn: 5 }} className="min-h-0 min-w-0 overflow-hidden">
        {zone === "right" && <SplitPlaceholder />}
      </div>
      {/* Bottom placeholder */}
      <div style={{ gridRow: 5, gridColumn: "1 / -1" }} className="min-h-0 overflow-hidden">
        {zone === "bottom" && <SplitPlaceholder />}
      </div>
    </div>
  );
}

// ── Pane ─────────────────────────────────────────────────────────────

interface PaneProps {
  pane: SplitPane;
  isFocused: boolean;
  isZoomed: boolean;
  isSinglePane: boolean;
  showDropZones: boolean;
  renderThread: (threadId: ThreadId, paneId: string) => ReactNode;
  onSplitDrop: SplitDropHandler | undefined;
}

function SplitPaneView({
  pane,
  isFocused,
  isZoomed,
  isSinglePane,
  showDropZones,
  renderThread,
  onSplitDrop,
}: PaneProps) {
  const setFocusedPane = useSplitViewStore((s) => s.setFocusedPane);
  const setDragOver = useSplitViewStore((s) => s.setDragOver);
  const clearDragOver = useSplitViewStore((s) => s.clearDragOver);
  const activeZone = useSplitViewStore(
    (s) => (s.dragOver?.paneId === pane.id ? s.dragOver.zone : null),
  );

  return (
    <div
      data-split-pane-id={pane.id}
      tabIndex={-1}
      className={`group/split-pane relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background transition-opacity duration-150 ${
        isSinglePane || isZoomed
          ? "opacity-100"
          : isFocused
            ? "rounded-lg ring-2 ring-primary/30 ring-inset opacity-100"
            : "rounded-lg opacity-60"
      }`}
      onMouseDown={() => setFocusedPane(pane.id)}
      onFocus={() => setFocusedPane(pane.id)}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const { clientX, clientY } = e;
        if (
          clientX <= rect.left ||
          clientX >= rect.right ||
          clientY <= rect.top ||
          clientY >= rect.bottom
        ) {
          clearDragOver();
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        const zone = activeZone;
        clearDragOver();
        if (!zone || !onSplitDrop) return;
        const droppedThreadId = e.dataTransfer.getData("application/t3-thread-id") || null;
        const droppedProjectId = e.dataTransfer.getData("application/t3-project-id") || null;
        const dragType = e.dataTransfer.getData("application/t3-drag-type");
        if (dragType === "project") {
          onSplitDrop(pane.id, null, droppedProjectId, zone);
        } else if (droppedThreadId) {
          onSplitDrop(pane.id, droppedThreadId as ThreadId, droppedProjectId, zone);
        }
      }}
    >
      {/* Invisible drag zone detector — captures drag events to compute drop zone */}
      {showDropZones && (
        <div
          className="absolute inset-0 z-30"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const zone = computeClosestDropZone(e.clientX, e.clientY, rect);
            setDragOver(pane.id, zone);
          }}
        />
      )}
      <SplitDropPreview zone={activeZone}>
        {renderThread(pane.threadId, pane.id)}
      </SplitDropPreview>
    </div>
  );
}

// ── Branch (recursive split) ────────────────────────────────────────

interface BranchPaneProps {
  branch: SplitBranch;
  focusedPaneId: string;
  isSinglePane: boolean;
  showDropZones: boolean;
  renderThread: (threadId: ThreadId, paneId: string) => ReactNode;
  onSplitDrop: SplitDropHandler | undefined;
}

function BranchPane({
  branch,
  focusedPaneId,
  isSinglePane,
  showDropZones,
  renderThread,
  onSplitDrop,
}: BranchPaneProps) {
  const isHorizontal = branch.direction === "horizontal";
  const firstBasis = `calc(${(branch.ratio * 100).toFixed(4)}% - ${(SPLIT_GAP_PX * branch.ratio).toFixed(4)}px)`;
  const secondBasis = `calc(${((1 - branch.ratio) * 100).toFixed(4)}% - ${(SPLIT_GAP_PX * (1 - branch.ratio)).toFixed(4)}px)`;

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${isHorizontal ? "flex-row" : "flex-col"}`}>
      <div
        className="flex min-h-0 min-w-0"
        style={{
          flexBasis: firstBasis,
          flexGrow: 0,
          flexShrink: 0,
        }}
      >
        <SplitPanelNode
          node={branch.children[0]}
          focusedPaneId={focusedPaneId}
          isSinglePane={false}
          showDropZones={showDropZones}
          renderThread={renderThread}
          onSplitDrop={onSplitDrop}
        />
      </div>
      <ResizeHandle branchId={branch.id} direction={branch.direction} />
      <div
        className="flex min-h-0 min-w-0"
        style={{
          flexBasis: secondBasis,
          flexGrow: 0,
          flexShrink: 0,
        }}
      >
        <SplitPanelNode
          node={branch.children[1]}
          focusedPaneId={focusedPaneId}
          isSinglePane={false}
          showDropZones={showDropZones}
          renderThread={renderThread}
          onSplitDrop={onSplitDrop}
        />
      </div>
    </div>
  );
}

// ── Recursive dispatcher ────────────────────────────────────────────

interface SplitPanelNodeProps {
  node: SplitNode;
  focusedPaneId: string;
  isSinglePane: boolean;
  showDropZones: boolean;
  renderThread: (threadId: ThreadId, paneId: string) => ReactNode;
  onSplitDrop: SplitDropHandler | undefined;
}

function SplitPanelNode({
  node,
  focusedPaneId,
  isSinglePane,
  showDropZones,
  renderThread,
  onSplitDrop,
}: SplitPanelNodeProps) {
  if (node.type === "pane") {
    return (
      <SplitPaneView
        pane={node}
        isFocused={node.id === focusedPaneId}
        isZoomed={false}
        isSinglePane={isSinglePane}
        showDropZones={showDropZones}
        renderThread={renderThread}
        onSplitDrop={onSplitDrop}
      />
    );
  }
  return (
    <BranchPane
      branch={node}
      focusedPaneId={focusedPaneId}
      isSinglePane={isSinglePane}
      showDropZones={showDropZones}
      renderThread={renderThread}
      onSplitDrop={onSplitDrop}
    />
  );
}

// ── Root component ──────────────────────────────────────────────────

export interface SplitPanelRootProps {
  renderThread: (threadId: ThreadId, paneId: string) => ReactNode;
  /**
   * Called when a thread/project is dropped on a pane's drop zone.
   * threadId is null when a project (not thread) is dragged (caller should create a new thread).
   */
  onSplitDrop: SplitDropHandler | undefined;
}

export function SplitPanelRoot({ renderThread, onSplitDrop }: SplitPanelRootProps) {
  const group = useSplitViewStore((s) => s.group);
  const zoomed = useSplitViewStore((s) => s.zoomed);
  const draggingThreadId = useSplitViewStore((s) => s.draggingThreadId);
  const [showDropZones, setShowDropZones] = useState(false);
  const dragCountRef = useRef(0);

  if (!group) return null;

  // Suppress drop zones when dragging a thread that's already in the workspace
  const isDraggingExistingThread =
    draggingThreadId !== null && findPaneByThreadId(group.root, draggingThreadId) !== null;

  const isSinglePane = group.root.type === "pane";

  // When zoomed, only render the focused pane at full size
  const zoomedPane = zoomed ? findPane(group.root, group.focusedPaneId) : null;

  const effectiveShowDropZones = showDropZones && !isDraggingExistingThread;

  const isFullBleed = (isSinglePane || zoomed) && !effectiveShowDropZones;

  return (
    <div
      className={`flex min-h-0 min-w-0 overflow-hidden ${
        isFullBleed ? "absolute inset-0 bg-background" : "h-full w-full"
      }`}
      onDragEnter={(e) => {
        if (
          e.dataTransfer.types.includes("application/t3-thread-id") ||
          e.dataTransfer.types.includes("application/t3-project-id")
        ) {
          dragCountRef.current++;
          if (!isDraggingExistingThread) {
            setShowDropZones(true);
          }
        }
      }}
      onDragLeave={() => {
        dragCountRef.current--;
        if (dragCountRef.current <= 0) {
          dragCountRef.current = 0;
          setShowDropZones(false);
        }
      }}
      onDrop={() => {
        dragCountRef.current = 0;
        setShowDropZones(false);
      }}
      onDragOver={(e) => {
        // Allow drops
        e.preventDefault();
      }}
    >
      {zoomedPane ? (
        <SplitPaneView
          pane={zoomedPane}
          isFocused
          isZoomed
          isSinglePane={isSinglePane && !effectiveShowDropZones}
          showDropZones={effectiveShowDropZones}
          renderThread={renderThread}
          onSplitDrop={onSplitDrop}
        />
      ) : (
        <SplitPanelNode
          node={group.root}
          focusedPaneId={group.focusedPaneId}
          isSinglePane={isSinglePane && !effectiveShowDropZones}
          showDropZones={effectiveShowDropZones}
          renderThread={renderThread}
          onSplitDrop={onSplitDrop}
        />
      )}
    </div>
  );
}
