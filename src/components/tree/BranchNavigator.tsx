"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitBranch, MessageSquare, Trash2, X, ChevronRight, Columns2 } from "lucide-react";
import { useSplit } from "@/lib/state/split";
import { TreeQueryScope, useConversationTree } from "./useConversationTree";
import { DeleteChatDialog } from "@/components/chat/DeleteChatButton";
import { getChat } from "@/lib/api-client/chats";
import type { Conversation, TreeNodeDto } from "@/lib/api-client/types";
import { cn } from "@/lib/utils";

export function BranchNavigator({ conversationId }: { conversationId: string }) {
  return <TreeQueryScope><Navigator conversationId={conversationId} /></TreeQueryScope>;
}

function Navigator({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const split = useSplit();
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useConversationTree(open ? conversationId : null);
  const rows: { node: TreeNodeDto; depth: number; continuing: boolean[] }[] = [];
  const walk = (node: TreeNodeDto, depth: number, continuing: boolean[] = []) => {
    rows.push({ node, depth, continuing });
    if (query || !collapsed.has(node.id)) node.children.forEach((child, index) =>
      walk(child, depth + 1, [...continuing, index < node.children.length - 1]),
    );
  };
  if (data) walk(data.root, 0);
  const matching = rows.filter(({ node }) => `${node.title} ${node.highlightText ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const requestDelete = async (id: string) => {
    setBusyId(id);
    setError("");
    try {
      const target = await getChat(id);
      setOpen(false);
      setDeleting(target);
    } catch {
      setError("Could not load this conversation. Please try again.");
    } finally { setBusyId(null); }
  };

  return <>
    <Dialog.Root open={open} onOpenChange={next => { setOpen(next); if (next) { setQuery(""); setError(""); void refetch(); } }}>
      <Dialog.Trigger asChild>
        <button type="button" className="flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <GitBranch size={15} /> Branch map <ChevronRight size={14} className="ml-auto" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-full flex-col border-l bg-background shadow-2xl">
          <header className="flex items-start justify-between border-b p-5">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-lg font-semibold"><GitBranch size={20} className="text-primary" /> Branch map</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs leading-5 text-muted-foreground">Follow an idea. Jump between the main chat and its branches.</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close conversation tree" className="rounded-lg p-2 hover:bg-accent"><X size={18} /></Dialog.Close>
          </header>
          <div className="border-b px-5 py-4">
            <input aria-label="Search tree" placeholder="Find a conversation or highlight…" value={query} onChange={e => setQuery(e.target.value)} className="h-10 w-full rounded-lg border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{data ? `${data.totalNodes} conversations` : "Your conversation tree"}</span><button type="button" onClick={() => setCollapsed(new Set())} className="hover:text-foreground">Expand all</button></div>
          </div>
          <nav aria-label="Conversation tree" className="min-h-0 flex-1 overflow-auto p-4">
            {isLoading ? <p role="status" className="p-4 text-sm text-muted-foreground">Loading branches…</p> : isError ? <div role="alert" className="p-4 text-sm">Could not load branches. <button type="button" onClick={() => void refetch()} className="underline">Retry</button></div> : <ul className="space-y-2">
              {matching.map(({ node, depth, continuing }) => <li key={node.id} style={{ marginLeft: depth * 18 }} className={cn("relative flex items-center gap-1 rounded-xl border p-1", node.id === conversationId ? "border-primary/30 bg-primary/5" : "border-border bg-card")}>
                {depth > 0 && !query && <>
                  {continuing.slice(0, -1).map((continues, level) => continues && <span key={level} aria-hidden="true" data-testid="branch-ancestor-line" className="pointer-events-none absolute -top-[9px] -bottom-[9px] border-l border-primary/35" style={{ left: -(depth - level) * 18 + 6 }} />)}
                  <span aria-hidden="true" data-testid="branch-sibling-line" className="pointer-events-none absolute -left-3 -top-[9px] border-l border-primary/35" style={{ bottom: continuing[depth - 1] ? -9 : "50%" }} />
                  <span aria-hidden="true" className="pointer-events-none absolute -left-3 top-1/2 w-3 border-t border-primary/35" />
                </>}
                {node.children.length > 0 ? <button type="button" aria-label={`${collapsed.has(node.id) ? "Expand" : "Collapse"} ${node.title || "New chat"}`} aria-expanded={query ? true : !collapsed.has(node.id)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })} className="shrink-0 rounded p-1 hover:bg-accent"><ChevronRight size={14} className={cn("transition-transform", (query || !collapsed.has(node.id)) && "rotate-90")} /></button> : <span className="w-6 shrink-0" />}
                <Link href={`/c/${node.id}`} onClick={() => setOpen(false)} aria-current={node.id === conversationId ? "page" : undefined} className="min-w-0 flex-1 rounded-lg px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{depth ? <GitBranch size={12} /> : <MessageSquare size={12} />}{depth ? `Branch · level ${depth}` : "Main conversation"}{node.id === conversationId && <span className="ml-auto text-primary">Current</span>}</span>
                  <span className="block truncate text-sm font-medium">{node.title || "New chat"}</span>
                  {node.highlightText && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">“{node.highlightText}”</span>}
                </Link>
                <div className="flex shrink-0 flex-col">
                  {node.id !== conversationId && <button type="button" aria-label={`Split with ${node.title || "New chat"}`} onClick={() => { setOpen(false); split.openSplit(conversationId, node.id); }} className="rounded-lg p-2 text-muted-foreground hover:bg-accent"><Columns2 size={15} /></button>}
                  <button type="button" aria-label={`Delete ${node.title || "New chat"}`} disabled={busyId !== null} onClick={() => void requestDelete(node.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"><Trash2 size={15} /></button>
                </div>
              </li>)}
            </ul>}
            {!isLoading && !isError && matching.length === 0 && <p className="p-4 text-sm text-muted-foreground">No matching conversations.</p>}
            {data?.truncated && <p className="p-3 text-xs text-muted-foreground">This tree is too large to display in full.</p>}
            {error && <p role="alert" className="p-3 text-sm text-destructive">{error}</p>}
          </nav>
          <p className="border-t px-5 py-4 text-xs leading-5 text-muted-foreground">Select text in an answer to start a subchat. Deleting a branch also removes its descendants; you’ll be asked to confirm.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    {deleting && createPortal(<DeleteChatDialog conversation={deleting} open onOpenChange={next => { if (!next) { setDeleting(null); setOpen(true); } }} onDeleted={result => {
      setDeleting(null);
      if (result.deletedIds.includes(conversationId)) router.push(deleting.parentId && !result.deletedIds.includes(deleting.parentId) ? `/c/${deleting.parentId}` : "/");
      else { setOpen(true); void refetch(); }
    }} />, document.body)}
  </>;
}
