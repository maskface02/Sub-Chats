"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Columns2, GitBranch, X } from "lucide-react";
import { getChat } from "@/lib/api-client/chats";
import type { TreeNodeDto } from "@/lib/api-client/types";
import { useSplit } from "@/lib/state/split";

export function BranchHighlight({ branches, parentId, children, start, end }: {
  branches: TreeNodeDto[]; parentId: string; children: ReactNode; start?: number; end?: number;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); };
  const show = () => {
    cancel();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 348)), top: rect.bottom + 10 });
    setOpen(true);
  };
  const leave = () => { cancel(); timer.current = setTimeout(() => setOpen(false), 180); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const height = card.current?.getBoundingClientRect().height ?? 0;
    setPosition(p => ({ ...p, top: Math.max(12, Math.min(p.top, window.innerHeight - height - 12)) }));
    const outside = (e: PointerEvent) => { if (!trigger.current?.contains(e.target as Node) && !card.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    const scroll = (e: Event) => { if (!card.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", scroll); };
  }, [open]);
  return <>
    <span ref={trigger} role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Explore subchat: ${branches.map(b => b.title).join(", ")}`}
      data-source-start={start} data-source-end={end} data-branch-highlight="true"
      className="cursor-pointer rounded-sm border-b-2 border-primary/40 bg-primary/10 py-0.5 text-inherit transition-colors duration-200 hover:border-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onMouseEnter={show} onMouseLeave={leave} onClick={() => { if (!window.getSelection()?.toString()) show(); }}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); requestAnimationFrame(() => card.current?.querySelector<HTMLButtonElement>("button")?.focus()); } }}>
      {children}
    </span>
    {open && createPortal(<div ref={card} role="dialog" aria-label="Subchat preview" onMouseEnter={cancel} onMouseLeave={leave}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
      style={position} className="branch-preview-enter fixed z-50 max-h-[min(420px,80dvh)] w-[336px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-border bg-[hsl(var(--popover))] p-3 text-[hsl(var(--popover-foreground))] shadow-2xl motion-reduce:animate-none">
      <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-primary"><span className="flex items-center gap-2"><GitBranch size={14} /> Linked subchat{branches.length > 1 ? "s" : ""}</span><button aria-label="Close subchat preview" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent"><X size={14} /></button></div>
      {branches.map(branch => <Preview key={branch.id} branch={branch} parentId={parentId} close={() => setOpen(false)} />)}
    </div>, document.body)}
  </>;
}

function Preview({ branch, parentId, close }: { branch: TreeNodeDto; parentId: string; close: () => void }) {
  const router = useRouter();
  const split = useSplit();
  const { data, isError, refetch } = useQuery({ queryKey: ["chat-detail", branch.id], queryFn: () => getChat(branch.id), staleTime: 5000 });
  const excerpt = data?.messages.find(m => m.role === "assistant")?.content ?? data?.messages.find(m => m.role === "user")?.content;
  return <div className="space-y-3 rounded-xl bg-muted p-3 [&+&]:mt-2">
    <h3 className="truncate text-sm font-semibold">{data?.title ?? branch.title}</h3>
    <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-foreground">{isError ? "Preview unavailable. You can still open this subchat." : !data ? "Loading preview…" : excerpt?.slice(0, 400) || "No messages yet. Continue this thought in the subchat."}</p>
    {isError && <button onClick={() => void refetch()} className="text-xs underline">Retry preview</button>}
    <div className="grid grid-cols-2 gap-2">
      <button onClick={() => { close(); split.closeSplit(); router.push(`/c/${encodeURIComponent(branch.id)}`); }} className="flex items-center justify-center gap-1.5 rounded-lg border bg-background px-2 py-2 text-xs font-medium transition-colors hover:bg-accent"><ArrowUpRight size={14} /> Open here</button>
      <button onClick={() => { close(); split.openBranch(parentId, branch.id); }} className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"><Columns2 size={14} /> Open on the right</button>
    </div>
  </div>;
}
