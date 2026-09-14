"use client";

import { useEffect, useRef, useState } from "react";

export interface ShortcutOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function detectMac(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  );
}

/**
 * `?` shortcut overlay (US-409 AC.5): role="dialog", focus-trapped, Esc
 * closes, focus restores to the trigger. Modifiers are platform-correct.
 */
export function ShortcutOverlay({ open, onOpenChange }: ShortcutOverlayProps) {
  const [isMac] = useState(detectMac);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const el = dialogRef.current;
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>("button, [href]") ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const mod = isMac ? "Cmd" : "Ctrl";
  const rows: { keys: string[]; desc: string }[] = [
    { keys: [mod, "K"], desc: "New chat" },
    { keys: ["/"], desc: "Focus tree search" },
    { keys: [mod, "\\"], desc: "Toggle split view" },
    {
      keys: ["Esc"],
      desc: "Close dialog · clear search · close focused split pane",
    },
    { keys: ["?"], desc: "Show this shortcut list" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            aria-label="Close shortcuts"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ×
          </button>
        </div>
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.desc}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <span className="text-muted-foreground">{row.desc}</span>
              <span className="flex shrink-0 items-center gap-1">
                {row.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
          Esc never stops a stream — use the Stop button in the composer.
        </p>
      </div>
    </div>
  );
}
