"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  invalidateTree,
  useConversationTree,
  TreeQueryScope,
} from "@/components/tree/useConversationTree";
import { deleteChat, restoreChat } from "@/lib/api-client/chats";
import { ApiError } from "@/lib/api-client/base";
import { dismissToast, showToast, updateToast } from "./toast";
import type { Conversation, TreeNodeDto } from "@/lib/api-client/types";

const UNDO_WINDOW_MS = 5000;
const DISMISS_LINGER_MS = 1500;

const MENU_ITEM_CLASS =
  "flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50";

export interface DeleteChatMenuItemProps {
  onSelect: () => void;
}

/** Header overflow-menu item; opens the confirm dialog via ChatView state. */
export function DeleteChatMenuItem({ onSelect }: DeleteChatMenuItemProps) {
  return (
    <DropdownMenu.Item
      className={MENU_ITEM_CLASS}
      onSelect={() => onSelect()}
    >
      Delete conversation
    </DropdownMenu.Item>
  );
}

export interface DeleteChatDialogProps {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful delete (subtree ids) so the view can navigate. */
  onDeleted: (result: { deletedIds: string[]; deletedCount: number }) => void;
}

export function DeleteChatDialog({
  conversation,
  open,
  onOpenChange,
  onDeleted,
}: DeleteChatDialogProps) {
  if (!open) return null;
  return (
    <TreeQueryScope>
      <DeleteDialogInner
        conversation={conversation}
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />
    </TreeQueryScope>
  );
}

function DeleteDialogInner({
  conversation,
  onOpenChange,
  onDeleted,
}: Omit<DeleteChatDialogProps, "open">) {
  const router = useRouter();
  const rootId = conversation.rootConversationId || conversation.id;
  const { data } = useConversationTree(rootId);
  const [deleting, setDeleting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const subtreeCount = useMemo(
    () => countDescendants(data?.root, conversation.id),
    [data, conversation.id],
  );

  // Initial focus + focus trap + Esc-cancel (US-402 a11y notes).
  useEffect(() => {
    confirmRef.current?.focus();
    const el = dialogRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!deleting) onOpenChange(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>("button:not(:disabled)"),
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
  }, [deleting, onOpenChange]);

  const title = conversation.title || "New chat";
  const copy =
    subtreeCount > 0
      ? `Delete "${title}" and its ${subtreeCount} sub-chat${subtreeCount === 1 ? "" : "s"}? This can be undone for a few seconds.`
      : `Delete "${title}"? This can be undone for a few seconds.`;

  const confirm = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const result = await deleteChat(conversation.id);
      setDeleting(false);
      onOpenChange(false);
      onDeleted(result);
      startUndoToast(conversation.id, router);
    } catch (err) {
      setDeleting(false);
      if (err instanceof ApiError && err.code === "STREAM_ACTIVE") {
        showToast({
          message: "Stop the current response before deleting",
          role: "alert",
        });
      } else if (err instanceof ApiError && err.code === "RATE_LIMITED") {
        showToast({
          message: "Too many actions — try again in a moment",
          role: "alert",
        });
      } else {
        showToast({ message: "Could not delete — try again", role: "alert" });
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={() => !deleting && onOpenChange(false)}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${title}`}
        className="relative z-10 w-full max-w-sm rounded-lg border bg-background p-4 shadow-xl"
      >
        <h2 className="mb-2 text-sm font-semibold">Delete conversation</h2>
        <p className="text-sm text-muted-foreground">{copy}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
            className="rounded border px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => void confirm()}
            disabled={deleting}
            aria-busy={deleting}
            className="rounded bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Undo toast lifecycle (US-402 AC.4–5): "Chat deleted — Undo" active for 5s,
 * then "Deleted" with a disabled Undo for ~1.5s, then auto-dismiss.
 */
function startUndoToast(
  conversationId: string,
  router: ReturnType<typeof useRouter>,
): void {
  const toastId = showToast({
    message: "Chat deleted",
    ariaLabel: "Chat deleted",
    role: "status",
    duration: UNDO_WINDOW_MS + DISMISS_LINGER_MS,
    action: { label: "Undo", onClick: () => {} },
  });

  let phase: "open" | "undoing" | "expired" = "open";

  const doUndo = () => {
    if (phase !== "open") return;
    phase = "undoing";
    updateToast(toastId, {
      action: { label: "Undoing…", disabled: true, onClick: () => {} },
    });
    void restoreChat(conversationId)
      .then(() => {
        dismissToast(toastId);
        invalidateTree();
        router.refresh();
      })
      .catch(() => {
        updateToast(toastId, {
          message: "Could not undo — try again",
          action: undefined,
        });
        invalidateTree();
        router.refresh();
      });
  };

  updateToast(toastId, { action: { label: "Undo", onClick: doUndo } });

  window.setTimeout(() => {
    if (phase !== "open") return;
    phase = "expired";
    updateToast(toastId, {
      message: "Deleted",
      action: { label: "Undo", disabled: true, onClick: () => {} },
    });
  }, UNDO_WINDOW_MS);
}

function countDescendants(
  root: TreeNodeDto | undefined,
  targetId: string,
): number {
  if (!root) return 0;
  let count = 0;
  const countSubtree = (n: TreeNodeDto): void => {
    for (const c of n.children) {
      count += 1;
      countSubtree(c);
    }
  };
  const walk = (n: TreeNodeDto): boolean => {
    if (n.id === targetId) {
      countSubtree(n);
      return true;
    }
    for (const c of n.children) {
      if (walk(c)) return true;
    }
    return false;
  };
  walk(root);
  return count;
}
