import { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { Debouncer } from "@tanstack/react-pacer";

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

export interface Workspace {
  /** Stable id for the workspace. */
  readonly id: string;
  /** Human-editable label shown in the sidebar. */
  readonly name: string;
  /** Most recent time the workspace was activated or interacted with. */
  readonly lastVisitedAt?: string;
  /** The root of the split tree. */
  readonly root: SplitNode;
  /** The id of the leaf that currently has focus. */
  readonly focusedLeafId: string;
}

// Kept for backwards compatibility with existing call sites while the file name stays the same.
export type SplitGroup = Workspace;

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

function splitLeafNode(
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
  const left = splitLeafNode(node.children[0], targetLeafId, newThreadId, direction, insertBefore);
  if (left) return { ...node, children: [left, node.children[1]] };
  const right = splitLeafNode(node.children[1], targetLeafId, newThreadId, direction, insertBefore);
  if (right) return { ...node, children: [node.children[0], right] };
  return null;
}

function removeLeaf(node: SplitNode, leafId: string): SplitNode | null {
  if (node.type === "leaf") {
    return node.id === leafId ? null : node;
  }
  const leftResult = removeLeaf(node.children[0], leafId);
  const rightResult = removeLeaf(node.children[1], leafId);
  if (leftResult === node.children[0] && rightResult === node.children[1]) return node;
  if (leftResult === null) return rightResult;
  if (rightResult === null) return leftResult;
  return { ...node, children: [leftResult, rightResult] };
}

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
  if (left === node.children[0] && right === node.children[1]) return node;
  return { ...node, children: [left, right] };
}

export type FocusDirection = "up" | "down" | "left" | "right";

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
  const topH = h * r;
  const bottomH = h * (1 - r);
  const top = computeLeafRects(node.children[0], x, y, w, topH);
  const bottom = computeLeafRects(node.children[1], x, y + topH, w, bottomH);
  return new Map([...top, ...bottom]);
}

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

    let inDirection = false;
    let primaryDist = 0;
    if (isVertical) {
      if (direction === "down") {
        inDirection = rect.y + rect.h > cur.y + cur.h;
        primaryDist = rect.y - (cur.y + cur.h);
        if (primaryDist < 0) primaryDist = 0;
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

    const overlaps = isVertical
      ? rect.x < cur.x + cur.w - 0.001 && rect.x + rect.w > cur.x + 0.001
      : rect.y < cur.y + cur.h - 0.001 && rect.y + rect.h > cur.y + 0.001;

    if ((overlaps && !bestOverlaps) || (overlaps === bestOverlaps && primaryDist < bestPrimary)) {
      bestId = id;
      bestOverlaps = overlaps;
      bestPrimary = primaryDist;
    }
  }

  if (!bestId) return null;
  return findLeaf(root, bestId);
}

export type DropZone = "top" | "bottom" | "left" | "right" | "center";

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

  if (relX > 0.24 && relX < 0.76 && relY > 0.24 && relY < 0.76) {
    return "center";
  }

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

export function dropZoneToSplit(zone: Exclude<DropZone, "center">): {
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

const SPLIT_VIEW_STORAGE_KEY = "t3code:workspaces:v1";
const LEGACY_SPLIT_VIEW_STORAGE_KEY = "t3code:split-view:v1";

interface PersistedSplitViewState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

interface LegacyPersistedSplitViewState {
  group: SplitGroup | null;
}

function isValidWorkspace(workspace: unknown): workspace is Workspace {
  if (!workspace || typeof workspace !== "object") return false;
  const candidate = workspace as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.focusedLeafId !== "string"
  ) {
    return false;
  }
  if (!candidate.root || typeof candidate.root !== "object") return false;
  try {
    const root = candidate.root as SplitNode;
    if (countLeaves(root) < 2) return false;
    if (!findLeaf(root, candidate.focusedLeafId)) return false;
  } catch {
    return false;
  }
  return true;
}

function resolveActiveWorkspace(
  workspaces: readonly Workspace[],
  requestedId: string | null,
): Workspace | null {
  if (!requestedId) return null;
  return workspaces.find((workspace) => workspace.id === requestedId) ?? null;
}

function findWorkspaceContainingThread(
  workspaces: readonly Workspace[],
  threadId: ThreadId,
): Workspace | null {
  return workspaces.find((workspace) => findLeafByThreadId(workspace.root, threadId)) ?? null;
}

function touchWorkspace(workspace: Workspace, lastVisitedAt = new Date().toISOString()): Workspace {
  if (workspace.lastVisitedAt === lastVisitedAt) {
    return workspace;
  }
  return {
    ...workspace,
    lastVisitedAt,
  };
}

function buildNextWorkspaceName(workspaces: readonly Workspace[]): string {
  const prefix = "Workspace ";
  let maxOrdinal = 0;
  for (const workspace of workspaces) {
    if (!workspace.name.startsWith(prefix)) continue;
    const value = Number.parseInt(workspace.name.slice(prefix.length), 10);
    if (!Number.isNaN(value)) {
      maxOrdinal = Math.max(maxOrdinal, value);
    }
  }
  return `${prefix}${maxOrdinal + 1}`;
}

function readPersistedSplitView(): PersistedSplitViewState {
  if (typeof window === "undefined") return { workspaces: [], activeWorkspaceId: null };

  const readModernState = (): PersistedSplitViewState | null => {
    const raw = window.localStorage.getItem(SPLIT_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSplitViewState;
    const workspaces = Array.isArray(parsed.workspaces)
      ? parsed.workspaces.filter((workspace) => isValidWorkspace(workspace))
      : [];
    const activeWorkspace = resolveActiveWorkspace(workspaces, parsed.activeWorkspaceId ?? null);
    return {
      workspaces,
      activeWorkspaceId: activeWorkspace?.id ?? null,
    };
  };

  const readLegacyState = (): PersistedSplitViewState | null => {
    const raw = window.localStorage.getItem(LEGACY_SPLIT_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LegacyPersistedSplitViewState;
    if (!parsed.group || !isValidWorkspace({ ...parsed.group, name: "Workspace 1" })) {
      window.localStorage.removeItem(LEGACY_SPLIT_VIEW_STORAGE_KEY);
      return null;
    }
    const migratedWorkspace: Workspace = {
      ...parsed.group,
      name: "Workspace 1",
    };
    return {
      workspaces: [migratedWorkspace],
      activeWorkspaceId: migratedWorkspace.id,
    };
  };

  try {
    return readModernState() ?? readLegacyState() ?? { workspaces: [], activeWorkspaceId: null };
  } catch {
    return { workspaces: [], activeWorkspaceId: null };
  }
}

function persistSplitView(state: SplitViewState): void {
  if (typeof window === "undefined") return;
  try {
    const data: PersistedSplitViewState = {
      workspaces: [...state.workspaces],
      activeWorkspaceId: state.activeWorkspaceId,
    };
    window.localStorage.setItem(SPLIT_VIEW_STORAGE_KEY, JSON.stringify(data));
    window.localStorage.removeItem(LEGACY_SPLIT_VIEW_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

const debouncedPersist = new Debouncer(persistSplitView, { wait: 300 });

function withWorkspaceCollection(
  workspaces: readonly Workspace[],
  activeWorkspaceId: string | null,
): Pick<SplitViewState, "workspaces" | "activeWorkspaceId" | "group"> {
  const group = resolveActiveWorkspace(workspaces, activeWorkspaceId);
  return {
    workspaces: [...workspaces],
    activeWorkspaceId: group?.id ?? null,
    group,
  };
}

function updateWorkspace(
  workspaces: readonly Workspace[],
  workspaceId: string,
  updater: (workspace: Workspace) => Workspace | null,
): readonly Workspace[] {
  let changed = false;
  const next: Workspace[] = [];
  for (const workspace of workspaces) {
    if (workspace.id !== workspaceId) {
      next.push(workspace);
      continue;
    }
    const updatedWorkspace = updater(workspace);
    if (updatedWorkspace === workspace) {
      next.push(workspace);
      continue;
    }
    changed = true;
    if (updatedWorkspace !== null) {
      next.push(updatedWorkspace);
    }
  }
  return changed ? next : workspaces;
}

function workspaceFocusedThreadId(workspace: Workspace): ThreadId {
  return (
    findLeaf(workspace.root, workspace.focusedLeafId)?.threadId ??
    firstLeaf(workspace.root).threadId
  );
}

export interface SplitViewState {
  workspaces: readonly Workspace[];
  activeWorkspaceId: string | null;
  /**
   * The active workspace. Kept as a first-class field so existing split-view
   * consumers can stay simple while the app transitions to a workspace model.
   */
  group: Workspace | null;
  dragOver: {
    leafId: string;
    zone: DropZone;
  } | null;
  zoomed: boolean;
}

export interface SplitViewActions {
  splitThread: (
    currentThreadId: ThreadId,
    newThreadId: ThreadId,
    direction: SplitDirection,
    insertBefore: boolean,
  ) => void;
  splitLeaf: (
    leafId: string,
    newThreadId: ThreadId,
    direction: SplitDirection,
    insertBefore: boolean,
  ) => void;
  closePane: (leafId: string) => ThreadId | null;
  closeWorkspace: (workspaceId: string) => ThreadId | null;
  renameWorkspace: (workspaceId: string, name: string) => void;
  activateWorkspace: (workspaceId: string) => ThreadId | null;
  deactivateWorkspace: () => void;
  setFocusedLeaf: (leafId: string) => void;
  setRatio: (branchId: string, ratio: number) => void;
  replaceThreadInFocusedLeaf: (newThreadId: ThreadId) => void;
  replaceThreadInLeaf: (leafId: string, newThreadId: ThreadId) => void;
  unsplit: () => ThreadId[];
  setDragOver: (leafId: string, zone: DropZone) => void;
  clearDragOver: () => void;
  isSplit: () => boolean;
  getFocusedThreadId: () => ThreadId | null;
  focusDirection: (direction: FocusDirection) => string | null;
  toggleZoom: () => void;
  reconcileThreads: (validThreadIds: ReadonlySet<ThreadId>) => ThreadId | null;
}

export type SplitViewStore = SplitViewState & SplitViewActions;

const persisted = readPersistedSplitView();

export const useSplitViewStore = create<SplitViewStore>((set, get) => ({
  ...withWorkspaceCollection(persisted.workspaces, persisted.activeWorkspaceId),
  dragOver: null,
  zoomed: false,

  splitThread: (currentThreadId, newThreadId, direction, insertBefore) => {
    set((state) => {
      if (currentThreadId === newThreadId) return state;

      const currentWorkspace = findWorkspaceContainingThread(state.workspaces, currentThreadId);
      if (currentWorkspace) {
        const currentLeaf = findLeafByThreadId(currentWorkspace.root, currentThreadId);
        if (!currentLeaf) return state;

        const existingLeaf = findLeafByThreadId(currentWorkspace.root, newThreadId);
        if (existingLeaf) {
          const updatedWorkspace = touchWorkspace({
            ...currentWorkspace,
            focusedLeafId: existingLeaf.id,
          });
          return {
            ...withWorkspaceCollection(
              updateWorkspace(state.workspaces, currentWorkspace.id, () => updatedWorkspace),
              currentWorkspace.id,
            ),
            zoomed: false,
            dragOver: null,
          };
        }

        const existingWorkspaceForNewThread = findWorkspaceContainingThread(
          state.workspaces,
          newThreadId,
        );
        if (existingWorkspaceForNewThread) {
          const targetLeaf = findLeafByThreadId(existingWorkspaceForNewThread.root, newThreadId);
          if (!targetLeaf) return state;
          const updatedWorkspace = touchWorkspace({
            ...existingWorkspaceForNewThread,
            focusedLeafId: targetLeaf.id,
          });
          return {
            ...withWorkspaceCollection(
              updateWorkspace(
                state.workspaces,
                existingWorkspaceForNewThread.id,
                () => updatedWorkspace,
              ),
              existingWorkspaceForNewThread.id,
            ),
            zoomed: false,
            dragOver: null,
          };
        }

        const newRoot = splitLeafNode(
          currentWorkspace.root,
          currentLeaf.id,
          newThreadId,
          direction,
          insertBefore,
        );
        if (!newRoot) return state;
        const newLeaf = findLeafByThreadId(newRoot, newThreadId);
        const updatedWorkspace = touchWorkspace({
          ...currentWorkspace,
          root: newRoot,
          focusedLeafId: newLeaf?.id ?? currentWorkspace.focusedLeafId,
        });
        return {
          ...withWorkspaceCollection(
            updateWorkspace(state.workspaces, currentWorkspace.id, () => updatedWorkspace),
            currentWorkspace.id,
          ),
          zoomed: false,
          dragOver: null,
        };
      }

      const existingWorkspaceForNewThread = findWorkspaceContainingThread(
        state.workspaces,
        newThreadId,
      );
      if (existingWorkspaceForNewThread) {
        const targetLeaf = findLeafByThreadId(existingWorkspaceForNewThread.root, newThreadId);
        if (!targetLeaf) return state;
        const updatedWorkspace = touchWorkspace({
          ...existingWorkspaceForNewThread,
          focusedLeafId: targetLeaf.id,
        });
        return {
          ...withWorkspaceCollection(
            updateWorkspace(
              state.workspaces,
              existingWorkspaceForNewThread.id,
              () => updatedWorkspace,
            ),
            existingWorkspaceForNewThread.id,
          ),
          zoomed: false,
          dragOver: null,
        };
      }

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
      const workspace: Workspace = {
        id: root.id,
        name: buildNextWorkspaceName(state.workspaces),
        lastVisitedAt: new Date().toISOString(),
        root,
        focusedLeafId: newLeaf.id,
      };
      return {
        ...withWorkspaceCollection([...state.workspaces, workspace], workspace.id),
        zoomed: false,
      };
    });
  },

  splitLeaf: (leafId, newThreadId, direction, insertBefore) => {
    set((state) => {
      if (!state.group) return state;
      const targetLeaf = findLeaf(state.group.root, leafId);
      if (!targetLeaf || targetLeaf.threadId === newThreadId) return state;
      const existingLeaf = findLeafByThreadId(state.group.root, newThreadId);
      if (existingLeaf) {
        const updatedWorkspace = touchWorkspace({
          ...state.group,
          focusedLeafId: existingLeaf.id,
        });
        return {
          ...withWorkspaceCollection(
            updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
            state.group.id,
          ),
          zoomed: false,
          dragOver: null,
        };
      }
      const existingWorkspace = findWorkspaceContainingThread(state.workspaces, newThreadId);
      if (existingWorkspace && existingWorkspace.id !== state.group.id) {
        const targetWorkspaceLeaf = findLeafByThreadId(existingWorkspace.root, newThreadId);
        if (!targetWorkspaceLeaf) return state;
        const updatedWorkspace = touchWorkspace({
          ...existingWorkspace,
          focusedLeafId: targetWorkspaceLeaf.id,
        });
        return {
          ...withWorkspaceCollection(
            updateWorkspace(state.workspaces, existingWorkspace.id, () => updatedWorkspace),
            existingWorkspace.id,
          ),
          zoomed: false,
          dragOver: null,
        };
      }

      const newRoot = splitLeafNode(state.group.root, leafId, newThreadId, direction, insertBefore);
      if (!newRoot) return state;
      const newLeaf = findLeafByThreadId(newRoot, newThreadId);
      const updatedWorkspace: Workspace = {
        ...touchWorkspace(state.group),
        root: newRoot,
        focusedLeafId: newLeaf?.id ?? state.group.focusedLeafId,
      };
      return {
        ...withWorkspaceCollection(
          updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
          state.group.id,
        ),
      };
    });
  },

  closePane: (leafId) => {
    const state = get();
    if (!state.group) return null;

    const remaining = removeLeaf(state.group.root, leafId);
    if (!remaining || remaining.type === "leaf") {
      const fallbackThreadId = remaining?.threadId ?? null;
      const nextWorkspaces = state.workspaces.filter(
        (workspace) => workspace.id !== state.group?.id,
      );
      set({
        ...withWorkspaceCollection(nextWorkspaces, null),
        zoomed: false,
        dragOver: null,
      });
      return fallbackThreadId;
    }

    const needNewFocus = state.group.focusedLeafId === leafId;
    const newFocused = needNewFocus ? firstLeaf(remaining).id : state.group.focusedLeafId;
    const updatedWorkspace: Workspace = {
      ...touchWorkspace(state.group),
      root: remaining,
      focusedLeafId: newFocused,
    };
    set({
      ...withWorkspaceCollection(
        updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
        state.group.id,
      ),
      zoomed: false,
    });
    return null;
  },

  closeWorkspace: (workspaceId) => {
    const state = get();
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) return null;
    const nextWorkspaces = state.workspaces.filter((entry) => entry.id !== workspaceId);
    const fallbackThreadId =
      state.activeWorkspaceId === workspaceId ? workspaceFocusedThreadId(workspace) : null;
    set({
      ...withWorkspaceCollection(
        nextWorkspaces,
        state.activeWorkspaceId === workspaceId ? null : state.activeWorkspaceId,
      ),
      zoomed: state.activeWorkspaceId === workspaceId ? false : state.zoomed,
      dragOver: state.activeWorkspaceId === workspaceId ? null : state.dragOver,
    });
    return fallbackThreadId;
  },

  renameWorkspace: (workspaceId, name) => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    set((state) => {
      const nextWorkspaces = updateWorkspace(state.workspaces, workspaceId, (workspace) =>
        workspace.name === trimmedName ? workspace : { ...workspace, name: trimmedName },
      );
      if (nextWorkspaces === state.workspaces) return state;
      return {
        ...withWorkspaceCollection(nextWorkspaces, state.activeWorkspaceId),
      };
    });
  },

  activateWorkspace: (workspaceId) => {
    const state = get();
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId) ?? null;
    if (!workspace) return null;
    const lastVisitedAt = new Date().toISOString();
    set({
      ...withWorkspaceCollection(
        updateWorkspace(state.workspaces, workspaceId, (entry) =>
          touchWorkspace(entry, lastVisitedAt),
        ),
        workspaceId,
      ),
      zoomed: false,
      dragOver: null,
    });
    return workspaceFocusedThreadId(touchWorkspace(workspace, lastVisitedAt));
  },

  deactivateWorkspace: () => {
    set((state) => {
      if (state.activeWorkspaceId === null && state.group === null) return state;
      return {
        ...withWorkspaceCollection(state.workspaces, null),
        zoomed: false,
        dragOver: null,
      };
    });
  },

  setFocusedLeaf: (leafId) => {
    set((state) => {
      if (!state.group || state.group.focusedLeafId === leafId) return state;
      const updatedWorkspace: Workspace = {
        ...touchWorkspace(state.group),
        focusedLeafId: leafId,
      };
      return {
        ...withWorkspaceCollection(
          updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
          state.group.id,
        ),
      };
    });
  },

  setRatio: (branchId, ratio) => {
    set((state) => {
      if (!state.group) return state;
      const newRoot = updateBranchRatio(state.group.root, branchId, ratio);
      if (!newRoot) return state;
      const updatedWorkspace: Workspace = { ...touchWorkspace(state.group), root: newRoot };
      return {
        ...withWorkspaceCollection(
          updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
          state.group.id,
        ),
      };
    });
  },

  replaceThreadInFocusedLeaf: (newThreadId) => {
    set((state) => {
      if (!state.group) return state;
      const existing = findLeafByThreadId(state.group.root, newThreadId);
      if (existing && existing.id !== state.group.focusedLeafId) {
        const updatedWorkspace = touchWorkspace({
          ...state.group,
          focusedLeafId: existing.id,
        });
        return {
          ...withWorkspaceCollection(
            updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
            state.group.id,
          ),
          zoomed: false,
          dragOver: null,
        };
      }
      const existingWorkspace = findWorkspaceContainingThread(state.workspaces, newThreadId);
      if (existingWorkspace && existingWorkspace.id !== state.group.id) {
        const targetLeaf = findLeafByThreadId(existingWorkspace.root, newThreadId);
        if (!targetLeaf) return state;
        const updatedWorkspace = touchWorkspace({
          ...existingWorkspace,
          focusedLeafId: targetLeaf.id,
        });
        return {
          ...withWorkspaceCollection(
            updateWorkspace(state.workspaces, existingWorkspace.id, () => updatedWorkspace),
            existingWorkspace.id,
          ),
          zoomed: false,
          dragOver: null,
        };
      }
      const newRoot = replaceLeafThread(state.group.root, state.group.focusedLeafId, newThreadId);
      if (!newRoot) return state;
      const updatedWorkspace: Workspace = { ...touchWorkspace(state.group), root: newRoot };
      return {
        ...withWorkspaceCollection(
          updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
          state.group.id,
        ),
      };
    });
  },

  replaceThreadInLeaf: (leafId, newThreadId) => {
    set((state) => {
      if (!state.group) return state;
      const existing = findLeafByThreadId(state.group.root, newThreadId);
      if (existing && existing.id !== leafId) {
        const updatedWorkspace = touchWorkspace({
          ...state.group,
          focusedLeafId: existing.id,
        });
        return {
          ...withWorkspaceCollection(
            updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
            state.group.id,
          ),
          zoomed: false,
          dragOver: null,
        };
      }
      const existingWorkspace = findWorkspaceContainingThread(state.workspaces, newThreadId);
      if (existingWorkspace && existingWorkspace.id !== state.group.id) {
        const targetLeaf = findLeafByThreadId(existingWorkspace.root, newThreadId);
        if (!targetLeaf) return state;
        const updatedWorkspace = touchWorkspace({
          ...existingWorkspace,
          focusedLeafId: targetLeaf.id,
        });
        return {
          ...withWorkspaceCollection(
            updateWorkspace(state.workspaces, existingWorkspace.id, () => updatedWorkspace),
            existingWorkspace.id,
          ),
          zoomed: false,
          dragOver: null,
        };
      }
      const newRoot = replaceLeafThread(state.group.root, leafId, newThreadId);
      if (!newRoot) return state;
      const updatedWorkspace: Workspace = { ...touchWorkspace(state.group), root: newRoot };
      return {
        ...withWorkspaceCollection(
          updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
          state.group.id,
        ),
      };
    });
  },

  unsplit: () => {
    const state = get();
    if (!state.group) return [];
    const threadIds = collectThreadIds(state.group.root);
    const nextWorkspaces = state.workspaces.filter((workspace) => workspace.id !== state.group?.id);
    set({
      ...withWorkspaceCollection(nextWorkspaces, null),
      zoomed: false,
      dragOver: null,
    });
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
    const updatedWorkspace: Workspace = {
      ...touchWorkspace(state.group),
      focusedLeafId: target.id,
    };
    set({
      ...withWorkspaceCollection(
        updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
        state.group.id,
      ),
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
    if (state.workspaces.length === 0) {
      if (state.group === null && state.activeWorkspaceId === null) return null;
      set({
        ...withWorkspaceCollection([], null),
        zoomed: false,
        dragOver: null,
      });
      return null;
    }

    let activeFallbackThreadId: ThreadId | null = null;
    const nextWorkspaces: Workspace[] = [];
    let changed = false;

    for (const workspace of state.workspaces) {
      const nextRoot = pruneInvalidLeaves(workspace.root, validThreadIds);
      if (!nextRoot) {
        changed = true;
        continue;
      }
      if (nextRoot.type === "leaf") {
        if (workspace.id === state.activeWorkspaceId) {
          activeFallbackThreadId = nextRoot.threadId;
        }
        changed = true;
        continue;
      }
      const focusedLeaf = findLeaf(nextRoot, workspace.focusedLeafId) ?? firstLeaf(nextRoot);
      if (nextRoot !== workspace.root || focusedLeaf.id !== workspace.focusedLeafId) {
        changed = true;
      }
      nextWorkspaces.push({
        ...workspace,
        root: nextRoot,
        focusedLeafId: focusedLeaf.id,
      });
    }

    const nextActiveWorkspace = resolveActiveWorkspace(nextWorkspaces, state.activeWorkspaceId);
    if (!changed && nextActiveWorkspace?.id === state.activeWorkspaceId) {
      return nextActiveWorkspace
        ? workspaceFocusedThreadId(nextActiveWorkspace)
        : activeFallbackThreadId;
    }

    set({
      ...withWorkspaceCollection(nextWorkspaces, nextActiveWorkspace?.id ?? null),
      zoomed: false,
      dragOver: null,
    });

    if (nextActiveWorkspace) {
      return workspaceFocusedThreadId(nextActiveWorkspace);
    }
    return activeFallbackThreadId;
  },
}));

useSplitViewStore.subscribe((state) => debouncedPersist.maybeExecute(state));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersist.flush();
  });
}
