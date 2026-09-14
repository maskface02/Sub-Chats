"use client";

import { useEffect, useRef } from "react";
import { focusTreeSearch } from "@/lib/state/tree-search";

export interface ShortcutHandlers {
  onNewChat: () => void;
  onToggleSplit: () => void;
  onShowShortcuts: () => void;
  /**
   * Esc pressed with focus inside a split pane while no dialog is open.
   * Return true when the pane close was handled (US-409 §9 precedence:
   * dialog > search > pane — dialogs and the search input own their Esc).
   */
  onEscapePane?: (paneIndex: 1 | 2) => boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Global keyboard shortcuts (US-409 §9 map). Suppressed while focus is in an
 * input/textarea/contenteditable or while any dialog is open — except Esc,
 * which is forwarded to the pane-close handler only when no dialog owns it.
 */
export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current;
      const mod = e.metaKey || e.ctrlKey;
      const dialogOpen =
        document.querySelector('[role="dialog"]') !== null;
      const typing = isTypingTarget(e.target);
      const suppressed = typing || dialogOpen;

      if (mod && (e.key === "k" || e.key === "K")) {
        if (suppressed) return;
        e.preventDefault();
        h.onNewChat();
        return;
      }
      if (mod && e.key === "\\") {
        if (suppressed) return;
        e.preventDefault();
        h.onToggleSplit();
        return;
      }
      if (e.key === "Escape") {
        if (typing || dialogOpen) return;
        const paneEl =
          e.target instanceof HTMLElement
            ? e.target.closest("[data-chat-pane]")
            : null;
        if (paneEl) {
          const index = Number(paneEl.getAttribute("data-chat-pane"));
          if ((index === 1 || index === 2) && h.onEscapePane?.(index)) {
            e.preventDefault();
          }
        }
        return;
      }
      if (suppressed) return;
      if (e.key === "/") {
        e.preventDefault();
        focusTreeSearch();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        h.onShowShortcuts();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
