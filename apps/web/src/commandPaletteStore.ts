import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

export type CommandPaletteMode = "default" | "split-right" | "split-down" | "replace-focused";

interface CommandPaletteState {
  open: boolean;
  mode: CommandPaletteMode;
  sourceThreadId: ThreadId | null;
  sourceLeafId: string | null;
  previewThreadId: ThreadId | null;
  previewLeafId: string | null;
}

interface CommandPaletteStore extends CommandPaletteState {
  openPalette: (options?: {
    mode?: CommandPaletteMode;
    sourceThreadId?: ThreadId | null;
    sourceLeafId?: string | null;
    previewThreadId?: ThreadId | null;
    previewLeafId?: string | null;
  }) => void;
  closePalette: () => void;
  toggleDefaultPalette: () => void;
}

const DEFAULT_STATE: CommandPaletteState = {
  open: false,
  mode: "default",
  sourceThreadId: null,
  sourceLeafId: null,
  previewThreadId: null,
  previewLeafId: null,
};

export const useCommandPaletteStore = create<CommandPaletteStore>((set, get) => ({
  ...DEFAULT_STATE,

  openPalette: (options) => {
    set({
      open: true,
      mode: options?.mode ?? "default",
      sourceThreadId: options?.sourceThreadId ?? null,
      sourceLeafId: options?.sourceLeafId ?? null,
      previewThreadId: options?.previewThreadId ?? null,
      previewLeafId: options?.previewLeafId ?? null,
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
      sourceThreadId: null,
      sourceLeafId: null,
      previewThreadId: null,
      previewLeafId: null,
    });
  },
}));
