"use client";

import { useSyncExternalStore } from "react";

export type SplitOrientation = "horizontal" | "vertical";

interface SplitState {
  splitOpen: boolean;
  orientation: SplitOrientation;
  activePane: 1 | 2;
  primaryId: string | null;
  secondaryId: string | null;
  path: string[];
  windowStart: number;
  direction: "forward" | "back";
}

interface SplitActions {
  openSplit: (primaryId: string, secondaryId: string) => void;
  closeSplit: () => void;
  toggleOrientation: () => void;
  setActivePane: (pane: 1 | 2) => void;
  updateActivePaneId: (conversationId: string) => void;
  openBranch: (parentId: string, childId: string) => void;
  shiftWindow: (direction: "forward" | "back") => void;
  closeBranch: (id: string) => void;
}

export type SplitStore = SplitState & SplitActions;

const SERVER_SNAPSHOT: SplitState = {
  splitOpen: false,
  orientation: "horizontal",
  activePane: 1,
  primaryId: null,
  secondaryId: null,
  path: [],
  windowStart: 0,
  direction: "forward",
};
let state: SplitState = SERVER_SNAPSHOT;

const listeners = new Set<() => void>();

function set(next: Partial<SplitState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function getSnapshot(): SplitState {
  return state;
}

function getServerSnapshot(): SplitState {
  return SERVER_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const actions: SplitActions = {
  openSplit: (primaryId, secondaryId) => {
    if (state.splitOpen) { actions.openBranch(primaryId, secondaryId); return; }
    if (!primaryId || !secondaryId || primaryId === secondaryId) {
      return;
    }
    set({
      splitOpen: true,
      primaryId,
      secondaryId,
      path: [primaryId, secondaryId],
      windowStart: 0,
      direction: "forward",
      activePane: 1,
    });
  },
  closeSplit: () => {
    set({
      splitOpen: false,
      primaryId: null,
      secondaryId: null,
      activePane: 1,
    });
  },
  openBranch: (parentId, childId) => {
    if (!parentId || !childId || parentId === childId) return;
    const existingChild = state.path.indexOf(childId);
    if (state.splitOpen && existingChild >= 0) {
      set({ windowStart: Math.max(0, Math.min(existingChild, state.path.length - 3)), direction: existingChild < state.windowStart ? "back" : "forward" });
      return;
    }
    const index = state.path.indexOf(parentId);
    const path = state.splitOpen && index >= 0
      ? [...state.path.slice(0, index + 1), childId]
      : [parentId, childId];
    set({ splitOpen: true, primaryId: path[0], secondaryId: path[1], path,
      windowStart: Math.max(0, path.length - 3), direction: "forward", activePane: 1 });
  },
  shiftWindow: (direction) => {
    set({ windowStart: Math.max(0, Math.min(Math.max(0, state.path.length - 3), state.windowStart + (direction === "forward" ? 1 : -1))), direction });
  },
  closeBranch: (id) => {
    const index = state.path.indexOf(id);
    if (index < 0) return;
    if (index === 0) { actions.closeSplit(); return; }
    const path = state.path.slice(0, index);
    set({ path, splitOpen: path.length > 1, primaryId: path[0] ?? null,
      secondaryId: path[1] ?? null, windowStart: Math.min(state.windowStart, Math.max(0, path.length - 3)),
      direction: "back", activePane: 1 });
  },
  toggleOrientation: () =>
    set({
      orientation:
        state.orientation === "horizontal" ? "vertical" : "horizontal",
    }),
  setActivePane: (pane) => {
    if (state.activePane !== pane) set({ activePane: pane });
  },
  updateActivePaneId: (conversationId) => {
    if (!state.splitOpen) return;
    if (conversationId === state.primaryId) set({ activePane: 1 });
    else if (conversationId === state.secondaryId) set({ activePane: 2 });
    else if (state.activePane === 1) set({ primaryId: conversationId });
    else set({ secondaryId: conversationId });
  },
};

export function useSplit(): SplitStore {
  const splitState = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return {
    ...splitState,
    ...actions,
  };
}
