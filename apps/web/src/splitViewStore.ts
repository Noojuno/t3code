import { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { Debouncer } from "@tanstack/react-pacer";

// ── Types ────────────────────────────────────────────────────────────

export type SplitDirection = "horizontal" | "vertical";

/** A leaf node displays a single thread. */
export interface SplitLeaf {
  readonly type: "leaf";
  /** Stable identifier for this leaf (used for focus tracking & keying). */
  readonly id: string;
  /** The thread displayed in this pane. */
  readonly threadId: ThreadId;
}

/** A branch node splits two children either horizontally or vertically. */
export interface SplitBranch {
  readonly type: "branch";
  readonly id: string;
  /**
   * `horizontal` → children sit side-by-side (left | right).
   * `vertical`   → children are stacked (top / bottom).
   */
  readonly direction: SplitDirection;
  /** Two children; order matches visual order (first=left/top, second=right/bottom). */
  readonly children: readonly [SplitNode, SplitNode];
  /**
   * Proportion (0–1) of the first child's size.
   * 0.5 = equal split. Persisted per-branch so resize is remembered.
   */
  readonly ratio: number;
}

export type SplitNode = SplitLeaf | SplitBranch;

/**
 * A split group bundles all the thread IDs that are displayed in a single
 * split layout. This is what gets shown as a group in the sidebar.
 */
export interface SplitGroup {
  /** Stable id for the group (matches the root node id). */
  readonly id: string;
  /** The root of the split tree. */
  readonly root: SplitNode;
  /** The id of the leaf that currently has focus. */
  readonly focusedLeafId: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

let _nextId = 0;
export function splitNodeId(): string {
  return `split_${Date.now().toString(36)}_${(++_nextId).toString(36)}`;
}

/** Collect all thread IDs present in a split tree. */
export function collectThreadIds(node: SplitNode): ThreadId[] {
  if (node.type === "leaf") return [node.threadId];
  return [...collectThreadIds(node.children[0]), ...collectThreadIds(node.children[1])];
}

/** Count the number of leaves. */
export function countLeaves(node: SplitNode): number {
  if (node.type === "leaf") return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

/** Find the leaf with a given id. */
export function findLeaf(node: SplitNode, leafId: string): SplitLeaf | null {
  if (node.type === "leaf") return node.id === leafId ? node : null;
  return findLeaf(node.children[0], leafId) ?? findLeaf(node.children[1], leafId);
}

/** Find a leaf by thread id. */
export function findLeafByThreadId(node: SplitNode, threadId: ThreadId): SplitLeaf | null {
  if (node.type === "leaf") return node.threadId === threadId ? node : null;
  return (
    findLeafByThreadId(node.children[0], threadId) ?? findLeafByThreadId(node.children[1], threadId)
  );
}

/** Find the first leaf (top-left-most). */
export function firstLeaf(node: SplitNode): SplitLeaf {
  if (node.type === "leaf") return node;
  return firstLeaf(node.children[0]);
}

/**
 * Replace the thread in a specific leaf, returning a new tree.
 * Returns null if the leaf was not found.
 */
function replaceLeafThread(
  node: SplitNode,
  leafId: string,
  newThreadId: ThreadId,
): SplitNode | null {
  if (node.type === "leaf") {
    if (node.id === leafId) {
      return { ...node, threadId: newThreadId };
    }
    return null;
  }
  const left = replaceLeafThread(node.children[0], leafId, newThreadId);
  if (left) return { ...node, children: [left, node.children[1]] };
  const right = replaceLeafThread(node.children[1], leafId, newThreadId);
  if (right) return { ...node, children: [node.children[0], right] };
  return null;
}

/**
 * Split a leaf into two panes. The existing thread stays in the "first" position
 * (top or left) and the new thread goes in the "second" position (bottom or right),
 * unless `insertBefore` is true, in which case the new thread goes first.
 */
function splitLeaf(
  node: SplitNode,
  targetLeafId: string,
  newThreadId: ThreadId,
  direction: SplitDirection,
  insertBefore: boolean,
): SplitNode | null {
  if (node.type === "leaf") {
    if (node.id !== targetLeafId) return null;
    const newLeaf: SplitLeaf = { type: "leaf", id: splitNodeId(), threadId: newThreadId };
    const first = insertBefore ? newLeaf : node;
    const second = insertBefore ? node : newLeaf;
    return {
      type: "branch",
      id: splitNodeId(),
      direction,
      children: [first, second],
      ratio: 0.5,
    };
  }
  const left = splitLeaf(node.children[0], targetLeafId, newThreadId, direction, insertBefore);
  if (left) return { ...node, children: [left, node.children[1]] };
  const right = splitLeaf(node.children[1], targetLeafId, newThreadId, direction, insertBefore);
  if (right) return { ...node, children: [node.children[0], right] };
  return null;
}

/**
 * Remove a leaf by id from the tree.
 * Returns the pruned tree, or null if the leaf was the only node.
 */
function removeLeaf(node: SplitNode, leafId: string): SplitNode | null {
  if (node.type === "leaf") {
    return node.id === leafId ? null : node;
  }
  const leftResult = removeLeaf(node.children[0], leafId);
  const rightResult = removeLeaf(node.children[1], leafId);
  // If neither child was affected, the leaf wasn't in this subtree
  if (leftResult === node.children[0] && rightResult === node.children[1]) return node;
  // If one child was removed entirely, return the other
  if (leftResult === null) return rightResult;
  if (rightResult === null) return leftResult;
  return { ...node, children: [leftResult, rightResult] };
}

/** Update the ratio of a specific branch node. */
function updateBranchRatio(node: SplitNode, branchId: string, ratio: number): SplitNode | null {
  if (node.type === "leaf") return null;
  if (node.id === branchId) {
    return { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
  }
  const left = updateBranchRatio(node.children[0], branchId, ratio);
  if (left) return { ...node, children: [left, node.children[1]] };
  const right = updateBranchRatio(node.children[1], branchId, ratio);
  if (right) return { ...node, children: [node.children[0], right] };
  return null;
}

function pruneInvalidLeaves(
  node: SplitNode,
  validThreadIds: ReadonlySet<ThreadId>,
): SplitNode | null {
  if (node.type === "leaf") {
    return validThreadIds.has(node.threadId) ? node : null;
  }

  const left = pruneInvalidLeaves(node.children[0], validThreadIds);
  const right = pruneInvalidLeaves(node.children[1], validThreadIds);
  if (left === null) return right;
  if (right === null) return left;
  return { ...node, children: [left, right] };
}

// ── Spatial navigation ───────────────────────────────────────────────

export type FocusDirection = "up" | "down" | "left" | "right";

/**
 * Compute the bounding rectangle of each leaf as a fraction of the root.
 * Returns a map from leafId → { x, y, w, h } in [0,1] space.
 */
function computeLeafRects(
  node: SplitNode,
  x = 0,
  y = 0,
  w = 1,
  h = 1,
): Map<string, { x: number; y: number; w: number; h: number }> {
  if (node.type === "leaf") {
    return new Map([[node.id, { x, y, w, h }]]);
  }
  const r = node.ratio;
  if (node.direction === "horizontal") {
    const leftW = w * r;
    const rightW = w * (1 - r);
    const left = computeLeafRects(node.children[0], x, y, leftW, h);
    const right = computeLeafRects(node.children[1], x + leftW, y, rightW, h);
    return new Map([...left, ...right]);
  }
  // vertical
  const topH = h * r;
  const bottomH = h * (1 - r);
  const top = computeLeafRects(node.children[0], x, y, w, topH);
  const bottom = computeLeafRects(node.children[1], x, y + topH, w, bottomH);
  return new Map([...top, ...bottom]);
}

/**
 * Find the best leaf to focus when navigating in a direction from the current leaf.
 * Prioritises candidates that overlap on the perpendicular axis so that, e.g.,
 * "down" from a top-left pane picks the bottom-left pane (not a full-height right pane).
 */
export function findLeafInDirection(
  root: SplitNode,
  currentLeafId: string,
  direction: FocusDirection,
): SplitLeaf | null {
  const rects = computeLeafRects(root);
  const cur = rects.get(currentLeafId);
  if (!cur) return null;

  const isVertical = direction === "up" || direction === "down";

  let bestId: string | null = null;
  let bestOverlaps = false;
  let bestPrimary = Infinity;

  for (const [id, rect] of rects) {
    if (id === currentLeafId) continue;

    // Check candidate is in the correct direction (edge-to-edge)
    let inDirection = false;
    let primaryDist = 0;
    if (isVertical) {
      if (direction === "down") {
        inDirection = rect.y + rect.h > cur.y + cur.h; // candidate extends below current bottom
        primaryDist = rect.y - (cur.y + cur.h); // distance from current bottom to candidate top
        if (primaryDist < 0) primaryDist = 0; // overlapping vertically, treat as adjacent
      } else {
        inDirection = rect.y < cur.y;
        primaryDist = cur.y - (rect.y + rect.h);
        if (primaryDist < 0) primaryDist = 0;
      }
    } else {
      if (direction === "right") {
        inDirection = rect.x + rect.w > cur.x + cur.w;
        primaryDist = rect.x - (cur.x + cur.w);
        if (primaryDist < 0) primaryDist = 0;
      } else {
        inDirection = rect.x < cur.x;
        primaryDist = cur.x - (rect.x + rect.w);
        if (primaryDist < 0) primaryDist = 0;
      }
    }
    if (!inDirection) continue;

    // Check overlap on the perpendicular axis
    let overlaps: boolean;
    if (isVertical) {
      // Horizontal overlap
      overlaps = rect.x < cur.x + cur.w - 0.001 && rect.x + rect.w > cur.x + 0.001;
    } else {
      // Vertical overlap
      overlaps = rect.y < cur.y + cur.h - 0.001 && rect.y + rect.h > cur.y + 0.001;
    }

    // Prefer overlapping candidates; among same overlap status, prefer closest
    if ((overlaps && !bestOverlaps) || (overlaps === bestOverlaps && primaryDist < bestPrimary)) {
      bestId = id;
      bestOverlaps = overlaps;
      bestPrimary = primaryDist;
    }
  }

  if (!bestId) return null;
  return findLeaf(root, bestId);
}

// ── Drop zone logic ─────────────────────────────────────────────────

export type DropZone = "top" | "bottom" | "left" | "right";

interface SplitRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function computeClosestDropZone(
  clientX: number,
  clientY: number,
  rect: SplitRect,
): DropZone {
  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;
  const distLeft = relX;
  const distRight = 1 - relX;
  const distTop = relY;
  const distBottom = 1 - relY;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  if (minDist === distTop) return "top";
  if (minDist === distBottom) return "bottom";
  if (minDist === distLeft) return "left";
  return "right";
}

export function dropZoneToSplit(zone: DropZone): {
  direction: SplitDirection;
  insertBefore: boolean;
} {
  switch (zone) {
    case "top":
      return { direction: "vertical", insertBefore: true };
    case "bottom":
      return { direction: "vertical", insertBefore: false };
    case "left":
      return { direction: "horizontal", insertBefore: true };
    case "right":
      return { direction: "horizontal", insertBefore: false };
  }
}

// ── Persistence ─────────────────────────────────────────────────────

const SPLIT_VIEW_STORAGE_KEY = "t3code:split-view:v1";

interface PersistedSplitViewState {
  group: SplitGroup | null;
}

/** Basic structural validation of a persisted split group. */
function isValidSplitGroup(group: unknown): group is SplitGroup {
  if (!group || typeof group !== "object") return false;
  const g = group as Record<string, unknown>;
  if (typeof g.id !== "string" || typeof g.focusedLeafId !== "string") return false;
  if (!g.root || typeof g.root !== "object") return false;
  // Ensure the tree has at least 2 leaves (otherwise it's not a valid split)
  try {
    const node = g.root as SplitNode;
    if (countLeaves(node) < 2) return false;
    // Ensure the focused leaf actually exists
    if (!findLeaf(node, g.focusedLeafId)) return false;
  } catch {
    return false;
  }
  return true;
}

function readPersistedSplitView(): PersistedSplitViewState {
  if (typeof window === "undefined") return { group: null };
  try {
    const raw = window.localStorage.getItem(SPLIT_VIEW_STORAGE_KEY);
    if (!raw) return { group: null };
    const parsed = JSON.parse(raw) as PersistedSplitViewState;
    if (parsed.group && !isValidSplitGroup(parsed.group)) {
      // Stale or corrupted state — discard
      window.localStorage.removeItem(SPLIT_VIEW_STORAGE_KEY);
      return { group: null };
    }
    return parsed;
  } catch {
    return { group: null };
  }
}

function persistSplitView(state: SplitViewState): void {
  if (typeof window === "undefined") return;
  try {
    const data: PersistedSplitViewState = { group: state.group };
    window.localStorage.setItem(SPLIT_VIEW_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

const debouncedPersist = new Debouncer(persistSplitView, { wait: 300 });

// ── Store ───────────────────────────────────────────────────────────

export interface SplitViewState {
  /**
   * The active split group, or null if no split is active (single-thread mode).
   * When null, the app behaves exactly as before — the route `$threadId` param
   * determines the displayed thread.
   */
  group: SplitGroup | null;

  /**
   * When dragging a thread/project over a split pane, this tracks what is
   * being hovered so we can show drop zone indicators.
   */
  dragOver: {
    leafId: string;
    zone: DropZone;
  } | null;

  /** When true, the focused leaf is zoomed to fill the entire split area. */
  zoomed: boolean;
}

export interface SplitViewActions {
  /** Enter split view by splitting the current route thread with a new one. */
  splitThread: (
    currentThreadId: ThreadId,
    newThreadId: ThreadId,
    direction: SplitDirection,
    insertBefore: boolean,
  ) => void;

  /** Split a specific leaf in the active split group. */
  splitLeaf: (
    leafId: string,
    newThreadId: ThreadId,
    direction: SplitDirection,
    insertBefore: boolean,
  ) => void;

  /**
   * Close a specific pane in the split. If only one pane remains, exits split
   * view entirely and returns the remaining thread id.
   */
  closePane: (leafId: string) => ThreadId | null;

  /** Set which leaf has focus. */
  setFocusedLeaf: (leafId: string) => void;

  /** Update the split ratio of a branch node (during resize). */
  setRatio: (branchId: string, ratio: number) => void;

  /** Replace the thread in the focused leaf (e.g. when clicking a sidebar thread). */
  replaceThreadInFocusedLeaf: (newThreadId: ThreadId) => void;

  /** Replace the thread in a specific leaf. */
  replaceThreadInLeaf: (leafId: string, newThreadId: ThreadId) => void;

  /** Exit split view entirely, returning all thread IDs that were open. */
  unsplit: () => ThreadId[];

  /** Set drag-over state for drop zone rendering. */
  setDragOver: (leafId: string, zone: DropZone) => void;

  /** Clear drag-over state. */
  clearDragOver: () => void;

  /** Check if we're in split view. */
  isSplit: () => boolean;

  /** Get the focused thread id (in split mode) or null. */
  getFocusedThreadId: () => ThreadId | null;

  /** Move focus to the nearest leaf in a direction. Returns the new focused leaf id or null. */
  focusDirection: (direction: FocusDirection) => string | null;

  /** Toggle zoom on the focused leaf. */
  toggleZoom: () => void;

  /**
   * Remove leaves that no longer correspond to active threads/drafts.
   * Returns the best thread id to keep in the route after reconciliation.
   */
  reconcileThreads: (validThreadIds: ReadonlySet<ThreadId>) => ThreadId | null;
}

export type SplitViewStore = SplitViewState & SplitViewActions;

const persisted = readPersistedSplitView();

export const useSplitViewStore = create<SplitViewStore>((set, get) => ({
  group: persisted.group,
  dragOver: null,
  zoomed: false,

  splitThread: (currentThreadId, newThreadId, direction, insertBefore) => {
    set((state) => {
      // Reject duplicate: same thread cannot appear twice in a split
      if (currentThreadId === newThreadId) return state;
      if (state.group) return state;

      const existingLeaf: SplitLeaf = {
        type: "leaf",
        id: splitNodeId(),
        threadId: currentThreadId,
      };
      const newLeaf: SplitLeaf = {
        type: "leaf",
        id: splitNodeId(),
        threadId: newThreadId,
      };
      const first = insertBefore ? newLeaf : existingLeaf;
      const second = insertBefore ? existingLeaf : newLeaf;
      const root: SplitBranch = {
        type: "branch",
        id: splitNodeId(),
        direction,
        children: [first, second],
        ratio: 0.5,
      };
      return {
        group: {
          id: root.id,
          root,
          focusedLeafId: newLeaf.id,
        },
      };
    });
  },

  splitLeaf: (leafId, newThreadId, direction, insertBefore) => {
    set((state) => {
      if (!state.group) return state;
      const targetLeaf = findLeaf(state.group.root, leafId);
      if (!targetLeaf || targetLeaf.threadId === newThreadId) return state;
      if (findLeafByThreadId(state.group.root, newThreadId)) return state;

      const newRoot = splitLeaf(state.group.root, leafId, newThreadId, direction, insertBefore);
      if (!newRoot) return state;
      const newLeaf = findLeafByThreadId(newRoot, newThreadId);
      return {
        group: {
          ...state.group,
          root: newRoot,
          focusedLeafId: newLeaf?.id ?? state.group.focusedLeafId,
        },
      };
    });
  },

  closePane: (leafId) => {
    const state = get();
    if (!state.group) return null;

    const remaining = removeLeaf(state.group.root, leafId);
    if (!remaining) {
      // Last pane closed
      set({ group: null, zoomed: false });
      return null;
    }
    if (remaining.type === "leaf") {
      // Only one pane left — exit split view
      set({ group: null, zoomed: false });
      return remaining.threadId;
    }
    // Multiple panes remain
    const needNewFocus = state.group.focusedLeafId === leafId;
    const newFocused = needNewFocus ? firstLeaf(remaining).id : state.group.focusedLeafId;
    set({
      group: {
        ...state.group,
        root: remaining,
        focusedLeafId: newFocused,
      },
      zoomed: false,
    });
    return null;
  },

  setFocusedLeaf: (leafId) => {
    set((state) => {
      if (!state.group || state.group.focusedLeafId === leafId) return state;
      return { group: { ...state.group, focusedLeafId: leafId } };
    });
  },

  setRatio: (branchId, ratio) => {
    set((state) => {
      if (!state.group) return state;
      const newRoot = updateBranchRatio(state.group.root, branchId, ratio);
      if (!newRoot) return state;
      return { group: { ...state.group, root: newRoot } };
    });
  },

  replaceThreadInFocusedLeaf: (newThreadId) => {
    set((state) => {
      if (!state.group) return state;
      // Reject if this thread is already in another pane
      const existing = findLeafByThreadId(state.group.root, newThreadId);
      if (existing && existing.id !== state.group.focusedLeafId) return state;
      const newRoot = replaceLeafThread(state.group.root, state.group.focusedLeafId, newThreadId);
      if (!newRoot) return state;
      return { group: { ...state.group, root: newRoot } };
    });
  },

  replaceThreadInLeaf: (leafId, newThreadId) => {
    set((state) => {
      if (!state.group) return state;
      // Reject if this thread is already in another pane
      const existing = findLeafByThreadId(state.group.root, newThreadId);
      if (existing && existing.id !== leafId) return state;
      const newRoot = replaceLeafThread(state.group.root, leafId, newThreadId);
      if (!newRoot) return state;
      return { group: { ...state.group, root: newRoot } };
    });
  },

  unsplit: () => {
    const state = get();
    if (!state.group) return [];
    const threadIds = collectThreadIds(state.group.root);
    set({ group: null, zoomed: false });
    return threadIds;
  },

  setDragOver: (leafId, zone) => {
    set({ dragOver: { leafId, zone } });
  },

  clearDragOver: () => {
    set((state) => (state.dragOver ? { dragOver: null } : state));
  },

  isSplit: () => get().group !== null,

  getFocusedThreadId: () => {
    const state = get();
    if (!state.group) return null;
    const leaf = findLeaf(state.group.root, state.group.focusedLeafId);
    return leaf?.threadId ?? null;
  },

  focusDirection: (direction) => {
    const state = get();
    if (!state.group) return null;
    const target = findLeafInDirection(state.group.root, state.group.focusedLeafId, direction);
    if (!target) return null;
    set({
      group: { ...state.group, focusedLeafId: target.id },
      // Exit zoom when navigating to a different pane
      zoomed: false,
    });
    return target.id;
  },

  toggleZoom: () => {
    set((state) => {
      if (!state.group) return state;
      return { zoomed: !state.zoomed };
    });
  },

  reconcileThreads: (validThreadIds) => {
    const state = get();
    if (!state.group) return null;

    const nextRoot = pruneInvalidLeaves(state.group.root, validThreadIds);
    if (!nextRoot) {
      set({ group: null, zoomed: false, dragOver: null });
      return null;
    }
    if (nextRoot.type === "leaf") {
      set({ group: null, zoomed: false, dragOver: null });
      return nextRoot.threadId;
    }

    const focusedLeaf = findLeaf(nextRoot, state.group.focusedLeafId) ?? firstLeaf(nextRoot);
    set({
      group: {
        ...state.group,
        root: nextRoot,
        focusedLeafId: focusedLeaf.id,
      },
      zoomed: false,
      dragOver: null,
    });
    return focusedLeaf.threadId;
  },
}));

// Persist on change
useSplitViewStore.subscribe((state) => debouncedPersist.maybeExecute(state));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersist.flush();
  });
}
