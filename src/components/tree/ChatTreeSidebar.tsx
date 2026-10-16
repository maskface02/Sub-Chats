"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { listChats } from "@/lib/api-client/chats";
import { getConversationTree } from "@/lib/api-client/tree";
import type { TreeNodeDto } from "@/lib/api-client/types";
import { TreeQueryScope } from "@/components/tree/useConversationTree";
import { formatRelativeTime, cn } from "@/lib/utils";
import { NewChatButton } from "@/components/chat/NewChatButton";

/**
 * Slide-in navigation sidebar (post-ship UX change): a file-explorer-style
 * tree of conversations. Roots are listed flat; a chevron on a parent lazily
 * fetches that root's subtree (GET /api/chats/:id/tree) and expands it,
 * revealing nested child chats with their own chevrons.
 *
 * Query keys intentionally match the existing tree-cache convention
 * (["tree", rootId]) so invalidateTree() — called after branch creation and
 * delete — refreshes this sidebar for free.
 */

export function ChatTreeSidebar({
  currentChatId,
}: {
  currentChatId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const navigate = useCallback(
    (id: string) => {
      setOpen(false);
      router.push(`/c/${encodeURIComponent(id)}`);
    },
    [router],
  );

  return (
    <TreeQueryScope>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open chats sidebar"
        data-testid="chats-sidebar-trigger"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true">☰</span>
        <span>Chats</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 animate-fade-in bg-foreground/35 backdrop-blur-[2px]"
            aria-hidden="true"
            onClick={close}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Conversation tree"
            tabIndex={-1}
            data-testid="chats-sidebar"
            className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] animate-drawer-in flex-col border-r border-border/70 bg-background/95 shadow-2xl outline-none backdrop-blur-xl"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
              <span className="text-sm font-semibold tracking-tight">
                Conversations
              </span>
              <button
                type="button"
                onClick={close}
                aria-label="Close sidebar"
                className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                ×
              </button>
            </div>
            <div className="border-b border-border/70 p-3">
              <NewChatButton />
            </div>
            <ChatTreeList
              currentChatId={currentChatId ?? null}
              onNavigate={navigate}
            />
          </div>
        </div>
      ) : null}
    </TreeQueryScope>
  );
}

function ChatTreeList({
  currentChatId,
  onNavigate,
}: {
  currentChatId: string | null;
  onNavigate: (id: string) => void;
}) {
  const roots = useQuery({
    queryKey: ["chats", "roots", 1],
    queryFn: () => listChats(),
    staleTime: 15_000,
  });

  if (roots.isLoading) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" data-testid="sidebar-skeleton">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  if (roots.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-sm text-muted-foreground">Could not load chats.</p>
        <button
          type="button"
          onClick={() => void roots.refetch()}
          className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Retry
        </button>
      </div>
    );
  }

  const items = roots.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
        <p className="text-sm font-medium">No chats yet</p>
        <p className="text-xs text-muted-foreground">
          Start a chat and select text in a reply to branch.
        </p>
      </div>
    );
  }

  return (
    <nav aria-label="Conversation tree" className="flex-1 overflow-y-auto p-2">
      <ul className="space-y-0.5">
        {items.map((root) => (
          <li key={root.id}>
            <RootRow
              rootId={root.id}
              title={root.title}
              createdAt={root.updatedAt}
              childrenCount={root.childrenCount}
              currentChatId={currentChatId}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
      {roots.data?.nextCursor ? (
        <p className="p-2 text-center text-[11px] text-muted-foreground">
          Older chats not shown (most recent 50).
        </p>
      ) : null}
    </nav>
  );
}

function RootRow({
  rootId,
  title,
  createdAt,
  childrenCount,
  currentChatId,
  onNavigate,
}: {
  rootId: string;
  title: string;
  createdAt: string;
  childrenCount: number;
  currentChatId: string | null;
  onNavigate: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tree = useQuery({
    queryKey: ["tree", rootId],
    queryFn: () => getConversationTree(rootId),
    enabled: expanded,
    staleTime: 30_000,
  });

  const children = tree.data?.root.children ?? [];
  const isCurrent = currentChatId === rootId;
  const hasChildren = childrenCount > 0 || children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-0.5 rounded-md pr-1",
          isCurrent ? "bg-accent" : "hover:bg-accent/60",
        )}
      >
        {hasChildren || expanded || tree.isLoading ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            className="flex h-7 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-block transition-transform",
                expanded ? "rotate-90" : "rotate-0",
              )}
            >
              ▸
            </span>
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        )}
        <Link
          href={`/c/${encodeURIComponent(rootId)}`}
          onClick={() => onNavigate(rootId)}
          aria-current={isCurrent ? "page" : undefined}
          className="flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded py-1.5 pr-1 text-sm hover:bg-accent/60"
        >
          <span className="truncate font-medium" title={title}>
            {title || "New chat"}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatRelativeTime(createdAt)}
          </span>
        </Link>
      </div>

      {expanded ? (
        <div className="ml-4 border-l pl-1">
          {tree.isLoading ? (
            <div className="space-y-1.5 p-2" aria-busy="true">
              <div className="h-6 rounded bg-muted" />
              <div className="h-6 rounded bg-muted" />
            </div>
          ) : tree.isError ? (
            <p className="p-2 text-xs text-destructive">
              Could not load sub-chats.{" "}
              <button
                type="button"
                onClick={() => void tree.refetch()}
                className="underline hover:no-underline"
              >
                Retry
              </button>
            </p>
          ) : children.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              No sub-chats yet
            </p>
          ) : (
            <ul className="space-y-0.5">
              {children.map((child) => (
                <li key={child.id}>
                  <TreeNodeRow
                    node={child}
                    depth={1}
                    currentChatId={currentChatId}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  currentChatId,
  onNavigate,
}: {
  node: TreeNodeDto;
  depth: number;
  currentChatId: string | null;
  onNavigate: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isCurrent = currentChatId === node.id;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-0.5 rounded-md pr-1",
          isCurrent ? "bg-accent" : "hover:bg-accent/60",
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
            className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-block text-[10px] transition-transform",
                expanded ? "rotate-90" : "rotate-0",
              )}
            >
              ▸
            </span>
          </button>
        ) : (
          <span className="w-5 shrink-0 text-center text-[10px] text-muted-foreground/60" aria-hidden="true">
            ↳
          </span>
        )}
        <Link
          href={`/c/${encodeURIComponent(node.id)}`}
          onClick={() => onNavigate(node.id)}
          aria-current={isCurrent ? "page" : undefined}
          className="flex min-w-0 flex-1 items-baseline justify-between gap-1.5 rounded py-1 pr-1 text-[13px] hover:bg-accent/60"
        >
          <span className="truncate" title={node.title}>
            {node.highlightText ? "📌 " : ""}
            {node.title || "New chat"}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatRelativeTime(node.createdAt)}
          </span>
        </Link>
      </div>

      {hasChildren && expanded ? (
        <div className="ml-3.5 border-l pl-1">
          <ul className="space-y-0.5">
            {node.children.map((child) => (
              <li key={child.id}>
                <TreeNodeRow
                  node={child}
                  depth={depth + 1}
                  currentChatId={currentChatId}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
