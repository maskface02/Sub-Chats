"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createBranch } from "@/lib/api-client/branches";
import {
  setPendingQuestion,
} from "@/lib/state/pending-question";
import { invalidateTree } from "@/components/tree/useConversationTree";
import { ApiError } from "@/lib/api-client/base";
import { useSplit } from "@/lib/state/split";
import { createPortal } from "react-dom";

const PILL_VERTICAL_GAP = 8;
const PILL_HORIZONTAL_PADDING = 8;
const SELECTION_DEBOUNCE_MS = 50;
const TOAST_TIMEOUT_MS = 5000;

interface DetectedSelection {
  messageId: string;
  messageRole: "assistant" | "user" | "system";
  text: string;
  rect: DOMRect;
  charStart: number;
  charEnd: number;
  sourceContent: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  selection: DetectedSelection;
}

type PillState =
  | { kind: "hidden" }
  | { kind: "visible"; selection: DetectedSelection }
  | { kind: "loading" }
  | { kind: "error"; message: string };

/** Post-ship UX change: creation is gated behind a question dialog. */
interface QuestionDialogState {
  selection: DetectedSelection;
}

export interface SelectionMenuProps {
  conversationId: string;
  /**
   * Whether the right-click custom menu and the floating pill are enabled.
   * In a sub-chat composer, the parent-context banner preview should NOT
   * trigger another sub-chat. We keep the menu active for the live message
   * list and rely on `data-no-branch` attributes to suppress it where needed.
   */
  enabled?: boolean;
  /**
   * Split-view pane this instance belongs to. When set, selections only
   * register if they fall inside that pane's DOM subtree, keeping multiple
   * simultaneous instances isolated (US-205 AC.5).
   */
  paneIndex?: number;
}

export function SelectionMenu({
  conversationId,
  enabled = true,
  paneIndex,
}: SelectionMenuProps) {
  const split = useSplit();
  const router = useRouter();
  const [pill, setPill] = useState<PillState>({ kind: "hidden" });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [questionDialog, setQuestionDialog] = useState<QuestionDialogState | null>(
    null,
  );
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    placement: "above" | "below";
  } | null>(null);

  const latestSelectionRef = useRef<DetectedSelection | null>(null);
  const pillButtonRef = useRef<HTMLButtonElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refreshPillPosition = useCallback(() => {
    const sel = latestSelectionRef.current;
    if (!sel) return;
    setPosition(computePosition(sel.rect, pillRef.current));
  }, []);

  const clearAll = useCallback(() => {
    latestSelectionRef.current = null;
    setPill({ kind: "hidden" });
    setContextMenu(null);
    setPosition(null);
  }, []);

  const handleSelectionDetected = useCallback(
    (detected: DetectedSelection | null) => {
      if (!detected) {
        latestSelectionRef.current = null;
        setPill({ kind: "hidden" });
        setPosition(null);
        return;
      }
      if (detected.messageRole !== "assistant") {
        latestSelectionRef.current = null;
        setPill({ kind: "hidden" });
        setPosition(null);
        return;
      }
      latestSelectionRef.current = detected;
      setPill({ kind: "visible", selection: detected });
      setPosition(computePosition(detected.rect, pillRef.current));
    },
    [],
  );

  const scheduleDetection = useCallback(() => {
    if (!enabled) return;
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      handleSelectionDetected(detectSelection(paneIndex));
    }, SELECTION_DEBOUNCE_MS);
  }, [enabled, paneIndex, handleSelectionDetected]);

  // Global listeners: selectionchange, mouseup, keyup, scroll, resize
  useEffect(() => {
    if (!enabled) return;

    const onSelectionChange = () => {
      // Skip if focus is inside the composer
      const active = document.activeElement;
      if (
        active &&
        active instanceof HTMLElement &&
        (active.tagName === "TEXTAREA" ||
          active.tagName === "INPUT" ||
          active.getAttribute("aria-label") === "Message input")
      ) {
        return;
      }
      scheduleDetection();
    };
    const onMouseUp = () => scheduleDetection();
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === "Shift") scheduleDetection();
    };
    const onScroll = () => {
      if (!latestSelectionRef.current) return;
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        refreshPillPosition();
      });
    };
    const onResize = () => refreshPillPosition();

    const onContextMenu = (e: MouseEvent) => {
      if (!enabled) return;
      const target = e.target as Node | null;
      if (!target) return;
      // Suppress when the right-click lands inside the composer
      const inComposer = (target as HTMLElement).closest?.(
        '[aria-label="Message composer"]',
      );
      if (inComposer) return;
      const bubble = (target as HTMLElement).closest?.(
        '[data-message-id][data-message-role]',
      );
      if (!bubble) return;
      const role = bubble.getAttribute("data-message-role");
      if (role !== "assistant") return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const detected = detectSelection(paneIndex);
      if (!detected || detected.messageRole !== "assistant") return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, selection: detected });
      // Clear pill so they don't fight
      latestSelectionRef.current = null;
      setPill({ kind: "hidden" });
      setPosition(null);
    };

    const onPointerDown = (e: MouseEvent) => {
      if (!contextMenu) return;
      const target = e.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      setContextMenu(null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearAll();
      }
    };

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [
    enabled,
    paneIndex,
    scheduleDetection,
    refreshPillPosition,
    clearAll,
    contextMenu,
  ]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Selection must originate inside THIS instance's pane when a paneIndex
  // is given (two panes each run their own SelectionMenu instance).
  const inScopedPane = useCallback((bubble: HTMLElement): boolean => {
    if (paneIndex == null) return true;
    const scope = document.querySelector(`[data-chat-pane="${paneIndex}"]`);
    return !!scope && scope.contains(bubble);
  }, [paneIndex]);

  /**
   * Post-ship UX change: the pill and the right-click menu no longer create
   * a sub-chat directly. Both open the question dialog; the sub-chat is
   * created only when the user submits a question (Enter), and it opens
   * with that question already sent (full parent context via the ancestor
   * walk).
   */
  const openQuestionDialog = useCallback((selection: DetectedSelection) => {
    setContextMenu(null);
    setQuestionDialog({ selection });
  }, []);

  const createSubChatWithQuestion = useCallback(
    async (selection: DetectedSelection, question: string) => {
      setQuestionDialog(null);
      setPill({ kind: "loading" });
      const highlightContext = buildHighlightContext(
        selection.sourceContent,
        selection.charStart,
        selection.charEnd,
        selection.text,
      );
      try {
        const result = await createBranch(conversationId, {
          messageId: selection.messageId,
          selectedText: selection.text,
          charStart: selection.charStart,
          charEnd: selection.charEnd,
          clientHighlightContext: highlightContext,
        });
        // The question rides ahead of navigation; ChatView consumes it on
        // mount and auto-sends through the normal streaming path.
        setPendingQuestion(result.id, question);
        // A new sub-chat appeared in the tree map — refetch (US-202 AC.3).
        invalidateTree();
        setPill({ kind: "hidden" });
        latestSelectionRef.current = null;
        window.getSelection()?.removeAllRanges();
        split.openBranch(conversationId, result.id);
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.code === "NOT_FOUND"
              ? "Could not create sub-chat — try again"
              : err.code === "INVALID_SELECTION"
                ? Object.values(err.fields ?? {})[0] ?? "Select text within the response and try again."
                : err.code === "RATE_LIMITED"
                  ? "Too many sub-chats — try again later"
                  : "Could not create sub-chat — try again"
            : "Could not create sub-chat — try again";
        setPill({ kind: "error", message });
        if (toastTimerRef.current !== null) {
          clearTimeout(toastTimerRef.current);
        }
        toastTimerRef.current = setTimeout(() => {
          toastTimerRef.current = null;
          setPill((prev) =>
            prev.kind === "error" ? { kind: "hidden" } : prev,
          );
        }, TOAST_TIMEOUT_MS);
      }
    },
    [conversationId, router],
  );

  const onPillClick = useCallback(() => {
    const sel = latestSelectionRef.current;
    if (!sel) return;
    openQuestionDialog(sel);
  }, [openQuestionDialog]);

  const onPillKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const sel = latestSelectionRef.current;
        if (!sel) return;
        openQuestionDialog(sel);
      } else if (e.key === "Escape") {
        e.preventDefault();
        clearAll();
      }
    },
    [openQuestionDialog, clearAll],
  );

  const onMenuAction = useCallback(
    (kind: "branch" | "copy") => {
      const cm = contextMenu;
      if (!cm) return;
      if (kind === "copy") {
        const sel = window.getSelection();
        if (sel) {
          const text = sel.toString();
          if (text && navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(text);
          }
        }
        setContextMenu(null);
        return;
      }
      void openQuestionDialog(cm.selection);
    },

    [contextMenu, openQuestionDialog],
  );
  const onMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setContextMenu(null);
      }
    },
    [],
  );

  const showPill = pill.kind === "visible" || pill.kind === "loading";
  const showErrorToast = pill.kind === "error";
  const menuPos = contextMenu
    ? computeMenuPosition(contextMenu.x, contextMenu.y, menuRef.current)
    : null;

  return (
    <>
      {showPill && position ? (
        <div
          ref={pillRef}
          data-testid="selection-pill-container"
          className="pointer-events-none fixed z-40"
          style={{ top: position.top, left: position.left }}
        >
          <button
            ref={pillButtonRef}
            type="button"
            aria-label="Ask about this — sub-chat"
            aria-busy={pill.kind === "loading"}
            disabled={pill.kind === "loading"}
            onClick={onPillClick}
            onKeyDown={onPillKeyDown}
            className={cn(
              "pointer-events-auto inline-flex animate-soft-pop items-center gap-1.5 rounded-full border border-primary/15 bg-background/95 px-3 py-1.5 text-xs font-semibold text-primary shadow-lg shadow-primary/10 backdrop-blur-lg",
              "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {pill.kind === "loading" ? (
              <>
                <Spinner />
                <span>Creating sub-chat…</span>
              </>
            ) : (
              <>
                <SparkleIcon />
                <span>Ask about this</span>
              </>
            )}
          </button>
        </div>
      ) : null}

      {contextMenu && menuPos ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Sub-chat about selection, or copy"
          onKeyDown={onMenuKeyDown}
          className={cn(
            "fixed z-50 min-w-[14rem] animate-soft-pop rounded-xl border bg-popover/95 p-1.5 text-popover-foreground shadow-xl backdrop-blur-xl",
          )}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <button
            type="button"
            role="menuitem"
            aria-label={`Sub-chat about selection, ${contextMenu.selection.text.length} characters`}
            onClick={() => onMenuAction("branch")}
            className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
          >
            <SparkleIcon />
            <span>Sub-chat about selection</span>
          </button>
          <button
            type="button"
            role="menuitem"
            aria-label="Copy selection to clipboard"
            onClick={() => onMenuAction("copy")}
            className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
          >
            <CopyIcon />
            <span>Copy</span>
          </button>
        </div>
      ) : null}

      {showErrorToast ? (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4"
        >
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-md">
            <span aria-hidden="true">⚠</span>
            <span>{pill.kind === "error" ? pill.message : null}</span>
          </div>
        </div>
      ) : null}

      {questionDialog ? createPortal(
        <SubChatQuestionDialog
          selection={questionDialog.selection}
          pending={pill.kind === "loading"}
          onSubmit={(question) =>
            void createSubChatWithQuestion(questionDialog.selection, question)
          }
          onCancel={() => setQuestionDialog(null)}
        />,
        document.body,
      ) : null}
    </>
  );
}

/**
 * Minimal question dialog shown BEFORE a sub-chat is created (post-ship UX
 * change): select → right-click/pill → type the question → Enter creates
 * the sub-chat and opens it with the question already sent.
 */
function SubChatQuestionDialog({
  selection,
  pending,
  onSubmit,
  onCancel,
}: {
  selection: DetectedSelection;
  pending: boolean;
  onSubmit: (question: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onCancel]);

  // Minimal focus trap (Tab cycles inside the dialog).
  const onTrapKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      "textarea, button",
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const submit = () => {
    const value = inputRef.current?.value.trim() ?? "";
    if (!value || pending) return;
    onSubmit(value);
  };

  const preview =
    selection.text.length > 120
      ? `${selection.text.slice(0, 119)}…`
      : selection.text;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-fade-in bg-foreground/35 backdrop-blur-[2px]"
        onClick={pending ? undefined : onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="New sub-chat question"
        onKeyDown={onTrapKeyDown}
        className="relative w-full max-w-md animate-modal-in rounded-[1.5rem] border border-border/70 bg-popover/95 p-5 text-popover-foreground shadow-2xl backdrop-blur-xl"
      >
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          New sub-chat about
        </p>
        <p className="mb-4 line-clamp-2 rounded-xl border border-primary/10 bg-primary/[0.05] px-3 py-2 text-sm italic text-muted-foreground">
          “{preview}”
        </p>
        <textarea
          ref={inputRef}
          rows={3}
          disabled={pending}
          aria-label="Your question for the sub-chat"
          placeholder="What do you want to ask about this?"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            aria-busy={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {pending ? (
              <>
                <Spinner />
                <span>Creating sub-chat…</span>
              </>
            ) : (
              <span>Ask in sub-chat</span>
            )}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Enter to open the sub-chat · Shift+Enter for a new line · Esc to cancel
        </p>
      </div>
    </div>
  );
}

function detectSelection(paneIndex?: number): DetectedSelection | null {
  if (typeof window === "undefined") return null;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const text = sel.toString();
  if (!text || !text.trim()) return null;

  const anchorEl = (range.startContainer.nodeType === Node.ELEMENT_NODE
    ? (range.startContainer as Element)
    : range.startContainer.parentElement) as Element | null;
  const focusEl = (range.endContainer.nodeType === Node.ELEMENT_NODE
    ? (range.endContainer as Element)
    : range.endContainer.parentElement) as Element | null;
  if (!anchorEl || !focusEl) return null;

  const anchorBubble = anchorEl.closest<HTMLElement>(
    "[data-message-id][data-message-role]",
  );
  const focusBubble = focusEl.closest<HTMLElement>(
    "[data-message-id][data-message-role]",
  );
  if (!anchorBubble || !focusBubble) return null;
  if (anchorBubble !== focusBubble) return null;
  if (paneIndex != null) {
    const scope = document.querySelector(`[data-chat-pane="${paneIndex}"]`);
    if (!scope || !scope.contains(anchorBubble)) return null;
  }
  // Suppress in user messages and the banner preview
  if (anchorBubble.dataset.messageRole !== "assistant") return null;
  if (anchorBubble.dataset.noBranch === "true") return null;

  const messageId = anchorBubble.dataset.messageId;
  const messageRole = anchorBubble.dataset.messageRole as
    | "assistant"
    | "user"
    | "system";
  if (!messageId) return null;

  const sourceContent = anchorBubble.dataset.messageSource ?? "";
  if (!sourceContent) return null;

  const sourceOffset = (node: Node, offset: number): number | null => {
    const el = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const span = el?.closest<HTMLElement>("[data-source-start]");
    if (!span) return null;
    const start = Number(span.dataset.sourceStart);
    const end = Number(span.dataset.sourceEnd);
    // Escaped/entities text has different source length; use exact-match fallback.
    if (sourceContent.slice(start, end) !== span.textContent) return null;
    const prefix = document.createRange();
    prefix.selectNodeContents(span);
    prefix.setEnd(node, offset);
    return start + prefix.toString().length;
  };
  let charStart = sourceOffset(range.startContainer, range.startOffset);
  let charEnd = sourceOffset(range.endContainer, range.endOffset);
  if (charStart === null || charEnd === null) {
    // Plain code text and element-boundary selections: never guess among duplicates.
    const exact = sourceContent.indexOf(text);
    if (exact < 0 || sourceContent.indexOf(text, exact + 1) !== -1) return null;
    charStart = exact;
    charEnd = exact + text.length;
  }
  if (charStart < 0 || charEnd <= charStart) return null;

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  return {
    messageId,
    messageRole,
    text: sourceContent.slice(charStart, charEnd),
    rect,
    charStart,
    charEnd,
    sourceContent,
  };
}

function collectBubbleText(bubble: HTMLElement): string {
  // textContent preserves block boundaries as whitespace which matches
  // the spec's whitespace-tolerant comparison.
  return bubble.textContent ?? "";
}

function computeCharOffsets(
  bubble: HTMLElement,
  range: Range,
  sourceContent: string,
): { charStart: number; charEnd: number } {
  // Walk text nodes from bubble start to each range endpoint, counting chars.
  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null);
  let charCount = 0;
  let start = -1;
  let end = -1;
  let node = walker.nextNode();
  while (node) {
    const t = node as Text;
    const nodeLen = t.data.length;
    const nodeStart = charCount;
    const inThis =
      range.startContainer === t ||
      (range.startContainer.nodeType === Node.ELEMENT_NODE &&
        (range.startContainer as Element).contains(t));
    if (inThis && start === -1) {
      const offset =
        range.startContainer === t
          ? range.startOffset
          : textOffsetWithin(t, range.startContainer as Element);
      start = nodeStart + Math.max(0, Math.min(offset, nodeLen));
    }
    const inEnd =
      range.endContainer === t ||
      (range.endContainer.nodeType === Node.ELEMENT_NODE &&
        (range.endContainer as Element).contains(t));
    if (inEnd && end === -1) {
      const offset =
        range.endContainer === t
          ? range.endOffset
          : textOffsetWithin(t, range.endContainer as Element);
      end = nodeStart + Math.max(0, Math.min(offset, nodeLen));
    }
    if (start !== -1 && end !== -1) break;
    charCount += nodeLen;
    node = walker.nextNode();
  }
  if (start === -1) start = 0;
  if (end === -1) end = start;
  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  if (start > sourceContent.length) start = sourceContent.length;
  if (end > sourceContent.length) end = sourceContent.length;
  return { charStart: start, charEnd: end };
}

function textOffsetWithin(textNode: Text, element: Element): number {
  let total = 0;
  for (const child of Array.from(element.childNodes)) {
    if (child === textNode) return total;
    total += child.textContent?.length ?? 0;
  }
  return total;
}

function computePosition(
  rect: DOMRect,
  pillEl: HTMLDivElement | null,
): { top: number; left: number; placement: "above" | "below" } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pillW = pillEl?.offsetWidth ?? 180;
  const pillH = pillEl?.offsetHeight ?? 32;

  const fitsAbove = rect.top - pillH - PILL_VERTICAL_GAP >= 0;
  const placement: "above" | "below" = fitsAbove ? "above" : "below";

  let top =
    placement === "above"
      ? rect.top - pillH - PILL_VERTICAL_GAP
      : rect.bottom + PILL_VERTICAL_GAP;

  let left = rect.left + rect.width / 2 - pillW / 2;
  if (left < PILL_HORIZONTAL_PADDING) {
    left = PILL_HORIZONTAL_PADDING;
  }
  if (left + pillW + PILL_HORIZONTAL_PADDING > vw) {
    left = Math.max(
      PILL_HORIZONTAL_PADDING,
      vw - pillW - PILL_HORIZONTAL_PADDING,
    );
  }
  if (placement === "below" && top + pillH > vh) {
    // last-resort clamp: shift up so it stays in viewport
    top = Math.max(PILL_HORIZONTAL_PADDING, vh - pillH - PILL_HORIZONTAL_PADDING);
  }
  if (placement === "above" && top < 0) {
    top = PILL_HORIZONTAL_PADDING;
  }

  return { top, left, placement };
}

function computeMenuPosition(
  clientX: number,
  clientY: number,
  menuEl: HTMLDivElement | null,
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = menuEl?.offsetWidth ?? 220;
  const h = menuEl?.offsetHeight ?? 80;
  let left = clientX;
  let top = clientY;
  if (left + w + PILL_HORIZONTAL_PADDING > vw) {
    left = vw - w - PILL_HORIZONTAL_PADDING;
  }
  if (left < PILL_HORIZONTAL_PADDING) left = PILL_HORIZONTAL_PADDING;
  if (top + h + PILL_HORIZONTAL_PADDING > vh) {
    top = Math.max(PILL_HORIZONTAL_PADDING, vh - h - PILL_HORIZONTAL_PADDING);
  }
  if (top < PILL_HORIZONTAL_PADDING) top = PILL_HORIZONTAL_PADDING;
  return { top, left };
}

function buildHighlightContext(
  content: string,
  start: number,
  end: number,
  selectedText: string,
): string {
  if (!content) return selectedText.slice(0, 500);
  const sentenceSplit = content.split(/(\s*[^.!?]+[.!?]+)/g).filter(Boolean);
  let containing = -1;
  let acc = 0;
  for (let i = 0; i < sentenceSplit.length; i++) {
    const seg = sentenceSplit[i]!;
    const segStart = acc;
    const segEnd = acc + seg.length;
    if (start >= segStart && end <= segEnd + 1) {
      containing = i;
      break;
    }
    acc = segEnd;
  }
  const startIdx = containing === -1 ? 0 : Math.max(0, containing - 1);
  const endIdx =
    containing === -1 ? sentenceSplit.length : containing + 1;
  const window = sentenceSplit.slice(startIdx, endIdx).join("").trim();
  const capped = window.length > 500 ? window.slice(0, 500) : window;
  return capped || content.slice(0, 500);
}

function SparkleIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      className="shrink-0"
    >
      <path
        fill="currentColor"
        d="M8 1.5l1.6 3.4 3.4 1.6-3.4 1.6L8 11.5 6.4 8.1 3 6.5l3.4-1.6L8 1.5zM3 11l.7 1.4L5 13l-1.3.6L3 15l-.7-1.4L1 13l1.3-.6L3 11zm10 0l.7 1.4L15 13l-1.3.6L13 15l-.7-1.4L11 13l1.3-.6L13 11z"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      className="shrink-0"
    >
      <path
        fill="currentColor"
        d="M5 2h7a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1zm0 1v9h7V3H5zM3 5v9a1 1 0 001 1h6v-1H4V5H3z"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      className="shrink-0 animate-spin"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity="0.25"
      />
      <path
        d="M14 8a6 6 0 00-6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
