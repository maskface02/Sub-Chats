"use client";

import { useSyncExternalStore } from "react";

export type SplitOrientation = "horizontal" | "vertical";

interface SplitState {
  splitOpen: boolean;
  orientation: SplitOrientation;
  activePane: 1 | 2;
  primaryId: string | null;
  secondaryId: string | null;
}

interface SplitActions {
  openSplit: (primaryId: string, secondaryId: string) => void;
  closeSplit: () => void;
  toggleOrientation: () => void;
  setActivePane: (pane: 1 | 2) => void;
  updateActivePaneId: (conversationId: string) => void;
}

export type SplitStore = SplitState & SplitActions;

let state: SplitState = {
  splitOpen: false,
  orientation: "horizontal",
  activePane: 1,
  primaryId: null,
  secondaryId: null,
};

const listeners = new Set<() => void>();

function set(next: Partial<SplitState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function getSnapshot(): SplitState {
  return state;
}

function getServerSnapshot(): SplitState {
  return {
    splitOpen: false,
    orientation: "horizontal",
    activePane: 1,
    primaryId: null,
    secondaryId: null,
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const actions: SplitActions = {
  openSplit: (primaryId, secondaryId) => {
    if (!primaryId || !secondaryId || primaryId === secondaryId) {
      return;
    }
    set({
      splitOpen: true,
      primaryId,
      secondaryId,
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
