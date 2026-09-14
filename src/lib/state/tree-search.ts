"use client";

type FocusFn = () => boolean;

const registrations = new Set<FocusFn>();

/**
 * Registers a tree-search focus target. Multiple sidebars can be mounted at
 * once (desktop panel + mobile drawer); focusTreeSearch tries each until one
 * reports success (hidden inputs report failure via offsetParent).
 */
export function registerTreeSearchFocus(fn: FocusFn): () => void {
  registrations.add(fn);
  return () => {
    registrations.delete(fn);
  };
}

export function focusTreeSearch(): void {
  for (const fn of registrations) {
    if (fn()) return;
  }
}
