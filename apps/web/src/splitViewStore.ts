import { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { Debouncer } from "@tanstack/react-pacer";

export type SplitDirection = "horizontal" | "vertical";

/** A pane node that displays a single thread. */
export interface SplitThreadPane {
  readonly type: "pane";
  /** Discriminator — absent or `"thread"` means a thread pane (backward compat). */
  readonly kind?: "thread";
  /** Stable identifier for this pane (used for focus tracking & keying). */
  readonly id: string;
  /** The thread displayed in this pane. */
  readonly threadId: ThreadId;
}

export type SplitPane = SplitThreadPane;

/** Type guard: is this pane a thread pane? */
export function isThreadPane(pane: SplitPane): pane is SplitThreadPane {
  return true;
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

export type SplitNode = SplitPane | SplitBranch;

export interface Workspace {
  /** Stable id for the workspace. */
  readonly id: string;
  /** Human-editable label shown in the sidebar. */
  readonly name: string;
  /** The root of the split tree. */
  readonly root: SplitNode;
  /** The id of the pane that currently has focus. */
  readonly focusedPaneId: string;
}

// Kept for backwards compatibility with existing call sites while the file name stays the same.
export type SplitGroup = Workspace;

let _nextId = 0;
export function splitNodeId(): string {
  return `split_${Date.now().toString(36)}_${(++_nextId).toString(36)}`;
}

/** Collect all thread IDs present in a split tree. */
export function collectThreadIds(node: SplitNode): ThreadId[] {
  if (node.type === "pane") return [node.threadId];
  return [...collectThreadIds(node.children[0]), ...collectThreadIds(node.children[1])];
}

/** Collect all panes in a split tree. */
export function collectPanes(node: SplitNode): SplitPane[] {
  if (node.type === "pane") return [node];
  return [...collectPanes(node.children[0]), ...collectPanes(node.children[1])];
}

/** Count the number of panes. */
export function countPanes(node: SplitNode): number {
  if (node.type === "pane") return 1;
  return countPanes(node.children[0]) + countPanes(node.children[1]);
}

/** Find the pane with a given id. */
export function findPane(node: SplitNode, paneId: string): SplitPane | null {
  if (node.type === "pane") return node.id === paneId ? node : null;
  return findPane(node.children[0], paneId) ?? findPane(node.children[1], paneId);
}

/** Find a pane by thread id. */
export function findPaneByThreadId(node: SplitNode, threadId: ThreadId): SplitThreadPane | null {
  if (node.type === "pane") return node.threadId === threadId ? node : null;
  return (
    findPaneByThreadId(node.children[0], threadId) ?? findPaneByThreadId(node.children[1], threadId)
  );
}

/** Find the first pane (top-left-most). */
export function firstPane(node: SplitNode): SplitPane {
  if (node.type === "pane") return node;
  return firstPane(node.children[0]);
}

/** Find the first thread pane in a tree. */
export function firstThreadPane(node: SplitNode): SplitThreadPane | null {
  if (node.type === "pane") return node;
  return firstThreadPane(node.children[0]) ?? firstThreadPane(node.children[1]);
}

function replacePaneThread(
  node: SplitNode,
  paneId: string,
  newThreadId: ThreadId,
): SplitNode | null {
  if (node.type === "pane") {
    if (node.id === paneId) {
      return { ...node, threadId: newThreadId };
    }
    return null;
  }
  const left = replacePaneThread(node.children[0], paneId, newThreadId);
  if (left) return { ...node, children: [left, node.children[1]] };
  const right = replacePaneThread(node.children[1], paneId, newThreadId);
  if (right) return { ...node, children: [node.children[0], right] };
  return null;
}

function splitPaneNode(
  node: SplitNode,
  targetPaneId: string,
  newPaneOrThreadId: ThreadId | SplitPane,
  direction?: SplitDirection,
  insertBefore?: boolean,
): SplitNode | null {
  if (node.type === "pane") {
    if (node.id !== targetPaneId) return null;
    const newPane: SplitPane =
      typeof newPaneOrThreadId === "object"
        ? newPaneOrThreadId
        : { type: "pane", id: splitNodeId(), threadId: newPaneOrThreadId };
    const dir = direction ?? "horizontal";
    const before = insertBefore ?? false;
    const first = before ? newPane : node;
    const second = before ? node : newPane;
    return {
      type: "branch",
      id: splitNodeId(),
      direction: dir,
      children: [first, second],
      ratio: 0.5,
    };
  }
  const left = splitPaneNode(node.children[0], targetPaneId, newPaneOrThreadId, direction, insertBefore);
  if (left) return { ...node, children: [left, node.children[1]] };
  const right = splitPaneNode(node.children[1], targetPaneId, newPaneOrThreadId, direction, insertBefore);
  if (right) return { ...node, children: [node.children[0], right] };
  return null;
}

function removePane(node: SplitNode, paneId: string): SplitNode | null {
  if (node.type === "pane") {
    return node.id === paneId ? null : node;
  }
  const leftResult = removePane(node.children[0], paneId);
  const rightResult = removePane(node.children[1], paneId);
  if (leftResult === node.children[0] && rightResult === node.children[1]) return node;
  if (leftResult === null) return rightResult;
  if (rightResult === null) return leftResult;
  return { ...node, children: [leftResult, rightResult] };
}

function updateBranchRatio(node: SplitNode, branchId: string, ratio: number): SplitNode | null {
  if (node.type === "pane") return null;
  if (node.id === branchId) {
    return { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
  }
  const left = updateBranchRatio(node.children[0], branchId, ratio);
  if (left) return { ...node, children: [left, node.children[1]] };
  const right = updateBranchRatio(node.children[1], branchId, ratio);
  if (right) return { ...node, children: [node.children[0], right] };
  return null;
}

function pruneInvalidPanes(
  node: SplitNode,
  validThreadIds: ReadonlySet<ThreadId>,
): SplitNode | null {
  if (node.type === "pane") {
    return validThreadIds.has(node.threadId) ? node : null;
  }

  const left = pruneInvalidPanes(node.children[0], validThreadIds);
  const right = pruneInvalidPanes(node.children[1], validThreadIds);
  if (left === null) return right;
  if (right === null) return left;
  return { ...node, children: [left, right] };
}

export type FocusDirection = "up" | "down" | "left" | "right";

function computePaneRects(
  node: SplitNode,
  x = 0,
  y = 0,
  w = 1,
  h = 1,
): Map<string, { x: number; y: number; w: number; h: number }> {
  if (node.type === "pane") {
    return new Map([[node.id, { x, y, w, h }]]);
  }
  const r = node.ratio;
  if (node.direction === "horizontal") {
    const leftW = w * r;
    const rightW = w * (1 - r);
    const left = computePaneRects(node.children[0], x, y, leftW, h);
    const right = computePaneRects(node.children[1], x + leftW, y, rightW, h);
    return new Map([...left, ...right]);
  }
  const topH = h * r;
  const bottomH = h * (1 - r);
  const top = computePaneRects(node.children[0], x, y, w, topH);
  const bottom = computePaneRects(node.children[1], x, y + topH, w, bottomH);
  return new Map([...top, ...bottom]);
}

export function findPaneInDirection(
  root: SplitNode,
  currentPaneId: string,
  direction: FocusDirection,
): SplitPane | null {
  const rects = computePaneRects(root);
  const cur = rects.get(currentPaneId);
  if (!cur) return null;

  const isVertical = direction === "up" || direction === "down";

  let bestId: string | null = null;
  let bestOverlaps = false;
  let bestPrimary = Infinity;

  for (const [id, rect] of rects) {
    if (id === currentPaneId) continue;

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
  return findPane(root, bestId);
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
    typeof candidate.focusedPaneId !== "string"
  ) {
    return false;
  }
  if (!candidate.root || typeof candidate.root !== "object") return false;
  try {
    const root = candidate.root as SplitNode;
    if (countPanes(root) < 1) return false;
    const paneId = candidate.focusedPaneId as string;
    if (!findPane(root, paneId)) return false;
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
    const legacyWorkspace: Workspace = {
      ...parsed.group,
      name: "Workspace 1",
    };
    return {
      workspaces: [legacyWorkspace],
      activeWorkspaceId: legacyWorkspace.id,
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
    workspaces,
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
    changed = true;
    if (updatedWorkspace) {
      next.push(updatedWorkspace);
    }
  }
  return changed ? next : workspaces;
}

function workspaceFocusedThreadId(workspace: Workspace): ThreadId | null {
  const focused = findPane(workspace.root, workspace.focusedPaneId);
  if (focused) return focused.threadId;
  return firstThreadPane(workspace.root)?.threadId ?? null;
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
    paneId: string;
    zone: DropZone;
  } | null;
  /** The thread ID currently being dragged (set on native drag start, cleared on drag end). */
  draggingThreadId: ThreadId | null;
  zoomed: boolean;
}

export interface SplitViewActions {
  splitThread: (
    currentThreadId: ThreadId,
    newThreadId: ThreadId,
    direction: SplitDirection,
    insertBefore: boolean,
  ) => void;
  splitPane: (
    paneId: string,
    newThreadId: ThreadId,
    direction: SplitDirection,
    insertBefore: boolean,
  ) => void;
  closePane: (paneId: string) => ThreadId | null;
  closeWorkspace: (workspaceId: string) => ThreadId | null;
  renameWorkspace: (workspaceId: string, name: string) => void;
  createWorkspace: (threadId: ThreadId) => void;
  activateWorkspace: (workspaceId: string) => ThreadId | null;
  deactivateWorkspace: () => void;
  setFocusedPane: (paneId: string) => void;
  setRatio: (branchId: string, ratio: number) => void;
  replaceThreadInFocusedPane: (newThreadId: ThreadId) => void;
  replaceThreadInPane: (paneId: string, newThreadId: ThreadId) => void;
  unsplit: () => ThreadId[];
  setDragOver: (paneId: string, zone: DropZone) => void;
  clearDragOver: () => void;
  setDraggingThreadId: (threadId: ThreadId | null) => void;
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
  draggingThreadId: null,
  zoomed: false,

  splitThread: (currentThreadId, newThreadId, direction, insertBefore) => {
    set((state) => {
      if (currentThreadId === newThreadId) return state;

      const existingPane: SplitPane = {
        type: "pane",
        id: splitNodeId(),
        threadId: currentThreadId,
      };
      const newPane: SplitPane = {
        type: "pane",
        id: splitNodeId(),
        threadId: newThreadId,
      };
      const first = insertBefore ? newPane : existingPane;
      const second = insertBefore ? existingPane : newPane;
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
        root,
        focusedPaneId: newPane.id,
      };
      return {
        ...withWorkspaceCollection([...state.workspaces, workspace], workspace.id),
        zoomed: false,
      };
    });
  },

  splitPane: (paneId, newThreadId, direction, insertBefore) => {
    set((state) => {
      if (!state.group) return state;
      const targetPane = findPane(state.group.root, paneId);
      if (!targetPane || targetPane.threadId === newThreadId) return state;
      if (findPaneByThreadId(state.group.root, newThreadId)) return state;

      const newRoot = splitPaneNode(state.group.root, paneId, newThreadId, direction, insertBefore);
      if (!newRoot) return state;
      const newPane = findPaneByThreadId(newRoot, newThreadId);
      const updatedWorkspace: Workspace = {
        ...state.group,
        root: newRoot,
        focusedPaneId: newPane?.id ?? state.group.focusedPaneId,
      };
      return {
        ...withWorkspaceCollection(
          updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
          state.group.id,
        ),
      };
    });
  },

  closePane: (paneId) => {
    const state = get();
    if (!state.group) return null;

    const remaining = removePane(state.group.root, paneId);

    // Workspace has no panes left, or reduced to a single pane — drop it.
    if (!remaining || remaining.type === "pane") {
      const nextWorkspaces = state.workspaces.filter(
        (workspace) => workspace.id !== state.group?.id,
      );
      set({
        ...withWorkspaceCollection(nextWorkspaces, null),
        zoomed: false,
        dragOver: null,
      });
      if (remaining) {
        return remaining.threadId;
      }
      return null;
    }

    const needNewFocus = state.group.focusedPaneId === paneId;
    const newFocused = needNewFocus ? firstPane(remaining).id : state.group.focusedPaneId;
    const updatedWorkspace: Workspace = {
      ...state.group,
      root: remaining,
      focusedPaneId: newFocused,
    };
    set({
      ...withWorkspaceCollection(
        updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
        state.group.id,
      ),
      zoomed: false,
    });
    const focusedPane = findPane(remaining, newFocused);
    return focusedPane ? focusedPane.threadId : null;
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

  createWorkspace: (threadId) => {
    set((state) => {
      const pane: SplitPane = {
        type: "pane",
        id: splitNodeId(),
        threadId,
      };
      const workspace: Workspace = {
        id: splitNodeId(),
        name: buildNextWorkspaceName(state.workspaces),
        root: pane,
        focusedPaneId: pane.id,
      };
      return {
        ...withWorkspaceCollection([...state.workspaces, workspace], workspace.id),
        zoomed: false,
      };
    });
  },

  activateWorkspace: (workspaceId) => {
    const state = get();
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId) ?? null;
    if (!workspace) return null;
    set({
      ...withWorkspaceCollection(state.workspaces, workspaceId),
      zoomed: false,
      dragOver: null,
    });
    return workspaceFocusedThreadId(workspace);
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

  setFocusedPane: (paneId) => {
    set((state) => {
      if (!state.group || state.group.focusedPaneId === paneId) return state;
      const updatedWorkspace: Workspace = { ...state.group, focusedPaneId: paneId };
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
      const updatedWorkspace: Workspace = { ...state.group, root: newRoot };
      return {
        ...withWorkspaceCollection(
          updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
          state.group.id,
        ),
      };
    });
  },

  replaceThreadInFocusedPane: (newThreadId) => {
    set((state) => {
      if (!state.group) return state;
      const existing = findPaneByThreadId(state.group.root, newThreadId);
      if (existing && existing.id !== state.group.focusedPaneId) return state;
      const newRoot = replacePaneThread(state.group.root, state.group.focusedPaneId, newThreadId);
      if (!newRoot) return state;
      const updatedWorkspace: Workspace = { ...state.group, root: newRoot };
      return {
        ...withWorkspaceCollection(
          updateWorkspace(state.workspaces, state.group.id, () => updatedWorkspace),
          state.group.id,
        ),
      };
    });
  },

  replaceThreadInPane: (paneId, newThreadId) => {
    set((state) => {
      if (!state.group) return state;
      const existing = findPaneByThreadId(state.group.root, newThreadId);
      if (existing && existing.id !== paneId) return state;
      const newRoot = replacePaneThread(state.group.root, paneId, newThreadId);
      if (!newRoot) return state;
      const updatedWorkspace: Workspace = { ...state.group, root: newRoot };
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

  setDragOver: (paneId, zone) => {
    set((state) => {
      if (state.dragOver?.paneId === paneId && state.dragOver.zone === zone) {
        return state;
      }
      return { dragOver: { paneId, zone } };
    });
  },

  clearDragOver: () => {
    set((state) => (state.dragOver ? { dragOver: null } : state));
  },

  setDraggingThreadId: (threadId) => {
    set({ draggingThreadId: threadId });
  },

  isSplit: () => get().group !== null,

  getFocusedThreadId: () => {
    const state = get();
    if (!state.group) return null;
    const pane = findPane(state.group.root, state.group.focusedPaneId);
    if (!pane) return null;
    return pane.threadId;
  },

  focusDirection: (direction) => {
    const state = get();
    if (!state.group) return null;
    const target = findPaneInDirection(state.group.root, state.group.focusedPaneId, direction);
    if (!target) return null;
    const updatedWorkspace: Workspace = { ...state.group, focusedPaneId: target.id };
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

    const nextWorkspaces: Workspace[] = [];

    for (const workspace of state.workspaces) {
      const nextRoot = pruneInvalidPanes(workspace.root, validThreadIds);
      if (!nextRoot) {
        continue;
      }
      const focusedPane = findPane(nextRoot, workspace.focusedPaneId) ?? firstPane(nextRoot);
      nextWorkspaces.push({
        ...workspace,
        root: nextRoot,
        focusedPaneId: focusedPane.id,
      });
    }

    const nextActiveWorkspace = resolveActiveWorkspace(nextWorkspaces, state.activeWorkspaceId);
    set({
      ...withWorkspaceCollection(nextWorkspaces, nextActiveWorkspace?.id ?? null),
      zoomed: false,
      dragOver: null,
    });

    if (nextActiveWorkspace) {
      return workspaceFocusedThreadId(nextActiveWorkspace);
    }
    return null;
  },
}));

let _lastPersistedWorkspaces: readonly Workspace[] | null = null;
let _lastPersistedActiveId: string | null | undefined;
useSplitViewStore.subscribe((state) => {
  if (
    state.workspaces === _lastPersistedWorkspaces &&
    state.activeWorkspaceId === _lastPersistedActiveId
  ) {
    return;
  }
  _lastPersistedWorkspaces = state.workspaces;
  _lastPersistedActiveId = state.activeWorkspaceId;
  debouncedPersist.maybeExecute(state);
});

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersist.flush();
  });
}
