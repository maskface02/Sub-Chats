"use client";

import { useEffect, useMemo, useRef } from "react";
import { TreeQueryScope, useConversationTree } from "@/components/tree/useConversationTree";
import { cn } from "@/lib/utils";
import type { Conversation, TreeResponse } from "@/lib/api-client/types";

export interface SplitPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The conversation that owns the "Split" button (left pane). */
  conversation: Conversation;
  onPick: (id: string) => void;
}

function flatten(dto: TreeResponse["root"]): { id: string; title: string; depth: number; parentId: string | null }[] {
  const out: { id: string; title: string; depth: number; parentId: string | null }[] = [];
  const walk = (n: TreeResponse["root"], parentId: string | null) => {
    out.push({ id: n.id, title: n.title || "New chat", depth: n.depth, parentId });
    for (const c of n.children) walk(c, n.id);
  };
  walk(dto, null);
  return out;
}

export function SplitPicker(props: SplitPickerDialogProps) {
  return (
    <TreeQueryScope>
      <PickerInner {...props} />
    </TreeQueryScope>
  );
}

function PickerInner({ open, onOpenChange, conversation, onPick }: SplitPickerDialogProps) {
  const rootId = conversation.rootConversationId || conversation.id;
  const { data, isLoading } = useConversationTree(rootId);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const items = useMemo(
    () => (data ? flatten(data.root).filter((n) => n.id !== data.currentId) : []),
    [data],
  );
  void conversation;

  // Parent preselect: default highlight when opening.
  useEffect(() => {
    if (!open || !data) return;
    const target = conversation.parentId ?? rootId;
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-picker-id="${target}"]`)
        ?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data]);

  // Focus trap + Esc cancel.
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>("button"),
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
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
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

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
        aria-label="Choose conversation for second pane"
        aria-busy={isLoading ? "true" : "false"}
        className="relative z-10 w-full max-w-md rounded-lg border bg-background p-4 shadow-xl motion-safe:animate-in motion-safe:fade-in"
      >
        <h2 className="mb-2 text-sm font-semibold">Choose conversation for second pane</h2>
        {isLoading ? (
          <div className="flex justify-center py-8" aria-busy="true">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No other conversations in this tree
          </p>
        ) : (
          <div ref={listRef} className="max-h-80 overflow-y-auto">
            <ul role="listbox" aria-label="Conversations" className="space-y-0.5">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    data-picker-id={item.id}
                    onClick={() => {
                      onPick(item.id);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none",
                    )}
                    style={{ paddingLeft: 8 + item.depth * 14 }}
                  >
                    <span className="truncate">{item.title}</span>
                    {item.id === conversation.parentId ? (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">parent</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded border px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export { flatten as flattenTree };
