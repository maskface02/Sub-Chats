"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { getChat } from "@/lib/api-client/chats";
import type { Conversation } from "@/lib/api-client/types";
import { useSplit } from "@/lib/state/split";
import { ChatView } from "@/components/chat/ChatView";
import { TreeQueryScope } from "@/components/tree/useConversationTree";
import { cn } from "@/lib/utils";

export function SplitChatArea({ conversation }: { conversation: Conversation }) {
  return <TreeQueryScope><Workspace conversation={conversation} /></TreeQueryScope>;
}

function Workspace({ conversation }: { conversation: Conversation }) {
  const split = useSplit();
  useEffect(() => {
    if (split.splitOpen && !split.path.includes(conversation.id)) split.closeSplit();
  }, [conversation.id]);
  const opened = split.splitOpen && split.path.includes(conversation.id);
  const path = opened ? split.path : [conversation.id];
  const start = opened ? split.windowStart : 0;
  const visible = path.slice(start, start + 3);
  const gridRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    gridRef.current?.querySelectorAll<HTMLElement>("[data-workspace-chat]:not([hidden])").forEach(element => {
      const id = element.dataset.workspaceChat!;
      const rect = element.getBoundingClientRect();
      const previous = positions.current.get(id);
      next.set(id, rect);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      element.animate([
        { transform: previous ? `translate(${previous.left - rect.left}px, ${previous.top - rect.top}px)` : `translateX(${split.direction === "forward" ? -18 : 18}px)`, opacity: previous ? 1 : 0 },
        { transform: "translate(0, 0)", opacity: 1 },
      ], { duration: 300, easing: "cubic-bezier(.22,1,.36,1)" });
    });
    positions.current = next;
  }, [path.join(","), start]);
  return <div className="flex h-full min-h-0 flex-col">
    <div ref={gridRef} className={cn("branch-workspace min-h-0 flex-1", opened && "is-split", visible.length === 3 && "has-three")}>
      {path.map((id, index) => {
        const slot = index - start;
        const shown = slot >= 0 && slot < 3;
        const controls = opened && shown ? <div className="flex shrink-0 items-center gap-1 text-[11px]">
          {slot === 0 && start > 0 && <button type="button" onClick={() => split.shiftWindow("back")} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent"><ArrowLeft size={12} /> Parent</button>}
          {slot === visible.length - 1 && start + 3 < path.length && <button type="button" onClick={() => split.shiftWindow("forward")} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent">Child <ArrowRight size={12} /></button>}
          {slot === 0
            ? <button type="button" onClick={split.closeSplit} className="rounded px-1.5 py-1 hover:bg-accent">Exit split</button>
            : <button type="button" aria-label={`Close pane: level ${index + 1}`} title="Close this pane and its descendant panes" onClick={() => split.closeBranch(id)} className="rounded p-1 hover:bg-accent"><X size={14} /></button>}
        </div> : undefined;
        return <section key={id} data-workspace-chat={id} hidden={!shown} data-chat-pane={opened && shown ? slot + 1 : undefined}
          data-pane-slot={shown ? slot : undefined} role="region" aria-label={`Chat pane ${slot + 1}`}
          className={cn("min-h-0 min-w-0 flex-col overflow-hidden bg-background", shown ? "flex" : "hidden")}>
          <Pane id={id} initial={id === conversation.id ? conversation : undefined} index={opened ? (shown ? slot + 1 : 0) : undefined} controls={controls} />
        </section>;
      })}
    </div>
  </div>;
}

function Pane({ id, initial, index, controls }: { id: string; initial?: Conversation; index?: number; controls?: ReactNode }) {
  const { data, isError, refetch } = useQuery({ queryKey: ["chat-detail", id], queryFn: () => getChat(id), initialData: initial, staleTime: 5000 });
  if (isError && !data) return <div role="alert" className="p-5 text-sm">Could not load conversation. <button onClick={() => void refetch()} className="underline">Retry</button></div>;
  if (!data) return <div role="status" className="p-5 text-sm text-muted-foreground">Loading conversation…</div>;
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><ChatView conversation={data} pane={index === undefined ? undefined : { index, controls }} /></div>;
}
