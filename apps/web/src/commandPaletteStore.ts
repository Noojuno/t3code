import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

export type CommandPaletteMode =
  | "default"
  | "split-right"
  | "split-down"
  | "replace-focused"
  | "new-workspace"
  | "new-thread-project";

interface CommandPaletteState {
  open: boolean;
  mode: CommandPaletteMode;
  /** The mode to return to when pressing back from a sub-stage (e.g. project picker). */
  previousMode: CommandPaletteMode | null;
  sourceThreadId: ThreadId | null;
  sourcePaneId: string | null;
  previewThreadId: ThreadId | null;
  previewPaneId: string | null;
}

interface CommandPaletteStore extends CommandPaletteState {
  /** Backward-compatible setter used by the existing command palette dialog. */
  setOpen: (open: boolean) => void;
  /** Backward-compatible toggle used by existing keybinding handlers. */
  toggleOpen: () => void;
  openPalette: (options?: {
    mode?: CommandPaletteMode;
    previousMode?: CommandPaletteMode | null;
    sourceThreadId?: ThreadId | null;
    sourcePaneId?: string | null;
    previewThreadId?: ThreadId | null;
    previewPaneId?: string | null;
  }) => void;
  closePalette: () => void;
  toggleDefaultPalette: () => void;
}

const DEFAULT_STATE: CommandPaletteState = {
  open: false,
  mode: "default",
  previousMode: null,
  sourceThreadId: null,
  sourcePaneId: null,
  previewThreadId: null,
  previewPaneId: null,
};

export const useCommandPaletteStore = create<CommandPaletteStore>((set, get) => ({
  ...DEFAULT_STATE,

  setOpen: (open) => {
    if (open) {
      set({
        open: true,
        mode: "default",
        previousMode: null,
        sourceThreadId: null,
        sourcePaneId: null,
        previewThreadId: null,
        previewPaneId: null,
      });
    } else {
      const state = get();
      if (!state.open && state.mode === DEFAULT_STATE.mode) {
        return;
      }
      set(DEFAULT_STATE);
    }
  },

  toggleOpen: () => {
    const state = get();
    if (state.open && state.mode === "default") {
      set(DEFAULT_STATE);
      return;
    }
    set({
      open: true,
      mode: "default",
      previousMode: null,
      sourceThreadId: null,
      sourcePaneId: null,
      previewThreadId: null,
      previewPaneId: null,
    });
  },

  openPalette: (options) => {
    set({
      open: true,
      mode: options?.mode ?? "default",
      previousMode: options?.previousMode ?? null,
      sourceThreadId: options?.sourceThreadId ?? null,
      sourcePaneId: options?.sourcePaneId ?? null,
      previewThreadId: options?.previewThreadId ?? null,
      previewPaneId: options?.previewPaneId ?? null,
    });
  },

  closePalette: () => {
    const state = get();
    if (!state.open && state.mode === DEFAULT_STATE.mode) {
      return;
    }
    set(DEFAULT_STATE);
  },

  toggleDefaultPalette: () => {
    const state = get();
    if (state.open && state.mode === "default") {
      set(DEFAULT_STATE);
      return;
    }
    set({
      open: true,
      mode: "default",
      previousMode: null,
      sourceThreadId: null,
      sourcePaneId: null,
      previewThreadId: null,
      previewPaneId: null,
    });
  },
}));
