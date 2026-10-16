"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, PanelLeft, MessageSquare, X, GitBranch } from "lucide-react";
import { Brand } from "./Brand";
import { UserMenu } from "./UserMenu";
import { NewChatButton } from "@/components/chat/NewChatButton";
import { BranchNavigator } from "@/components/tree/BranchNavigator";
import { listChats } from "@/lib/api-client/chats";
import type { ChatListItem, SessionUser } from "@/lib/api-client/types";
import { useSplit } from "@/lib/state/split";
import { cn } from "@/lib/utils";

export function WorkspaceFrame({
  user,
  guestMode,
  initialChats,
  initialError,
  children,
}: {
  user: SessionUser;
  guestMode: boolean;
  initialChats: ChatListItem[];
  initialError: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const conversationId = pathname.match(/^\/c\/([^/]+)$/)?.[1];
  const { splitOpen } = useSplit();
  const [chats, setChats] = useState(initialChats);
  const [error, setError] = useState(initialError);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [sidebarClosed, setSidebarClosed] = useState(false);
  useEffect(() => {
    try { setSidebarClosed(localStorage.getItem("sidebar-closed") === "true"); } catch {}
  }, []);
  useEffect(() => {
    if (splitOpen) {
      setSidebarClosed(true);
      setOpen(false);
    }
  }, [splitOpen]);
  const toggleSidebar = () => setSidebarClosed(value => {
    try { localStorage.setItem("sidebar-closed", String(!value)); } catch {}
    return !value;
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const refresh = () => setRetry(value => value + 1);
    window.addEventListener("chat-history-changed", refresh);
    return () => window.removeEventListener("chat-history-changed", refresh);
  }, []);
  useEffect(() => {
    let current = true;
    setOpen(false);
    void listChats()
      .then((result) => {
        if (current) {
          setChats(result.items);
          setError(false);
        }
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [pathname, retry]);
  const filtered = chats.filter((chat) =>
    `${chat.title} ${chat.preview ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const sidebar = (
    <>
      <div className="flex h-20 shrink-0 items-center justify-between px-5">
        <Brand />
        <button
          className="icon-button md:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close sidebar"
        >
          <X size={18} />
        </button>
      </div>
      <div className="px-4">
        <NewChatButton />
      </div>
      {conversationId && <div className="px-4 pt-3"><BranchNavigator conversationId={conversationId} /></div>}
      <label className="mx-4 mb-6 mt-4 flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-muted-foreground focus-within:border-input focus-within:bg-background">
        <Search size={15} className="shrink-0" />
        <input
          aria-label="Search conversations"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button aria-label="Clear search" onClick={() => setQuery("")}>
            <X size={14} />
          </button>
        )}
      </label>
      <div className="px-6 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Your conversations
      </div>
      <nav
        aria-label="Recent conversations"
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"
      >
        {error ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            Could not load conversations.{" "}
            <button
              onClick={() => setRetry((n) => n + 1)}
              className="font-medium text-primary underline"
            >
              Retry
            </button>
          </div>
        ) : filtered.length ? (
          <ul className="space-y-1">
            {filtered.map((chat) => (
              <li key={chat.id}>
                <Link
                  href={`/c/${chat.id}`}
                  aria-current={
                    pathname === `/c/${chat.id}` ? "page" : undefined
                  }
                  className={cn(
                    "group flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors",
                    pathname === `/c/${chat.id}`
                      ? "bg-white text-foreground shadow-sm ring-1 ring-black/5 dark:bg-muted"
                      : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                  )}
                >
                  <MessageSquare
                    size={15}
                    className="mt-0.5 shrink-0 opacity-65"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {chat.title || "New chat"}
                    </span>
                    {chat.preview && (
                      <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                        {chat.preview}
                      </span>
                    )}
                  </span>
                  {chat.childrenCount > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px]">
                      <GitBranch size={11} />
                      {chat.childrenCount}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-4 text-xs leading-5 text-muted-foreground">
            {query
              ? "No conversations match your search."
              : "A fresh start. Your conversations will appear here."}
          </p>
        )}
      </nav>
      <div className="mx-5 mb-5 rounded-lg border border-border/70 p-3 text-xs leading-5 text-muted-foreground">
        <GitBranch size={15} className="mb-2 text-primary" />
        One conversation. Many directions.
        <br />
        Highlight an answer to start a branch.
      </div>
      <div className="border-t border-border/60 p-3">
        <UserMenu
          email={user.email}
          name={user.name}
          guestMode={guestMode}
          variant="sidebar"
        />
      </div>
    </>
  );
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside
        aria-label="Conversations"
        data-testid="workspace-sidebar"
        inert={sidebarClosed || undefined}
        aria-hidden={sidebarClosed || undefined}
        className={cn("hidden shrink-0 flex-col overflow-hidden border-border/70 bg-[#f3f3ef] transition-[width,opacity] duration-300 motion-reduce:transition-none dark:bg-card md:flex", sidebarClosed ? "w-0 opacity-0" : "w-[248px] border-r opacity-100")}
      >
        {sidebar}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="hidden h-10 shrink-0 items-center gap-2 border-b px-3 md:flex">
          <button type="button" onClick={toggleSidebar} aria-label={sidebarClosed ? "Open chats sidebar" : "Close chats sidebar"} aria-expanded={!sidebarClosed} className="icon-button"><PanelLeft size={17} /></button>
          <span className="text-xs text-muted-foreground">Your workspace</span>
        </div>
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:hidden">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <button aria-label="Open chats sidebar" className="icon-button">
                <PanelLeft size={19} />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/25 backdrop-blur-sm" />
              <Dialog.Content
                aria-describedby={undefined}
                className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[90vw] animate-drawer-in flex-col bg-[#f3f3ef] shadow-xl dark:bg-card"
              >
                <Dialog.Title className="sr-only">Conversations</Dialog.Title>
                {sidebar}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <span className="text-sm font-semibold">Sub-chats</span>
        </div>
        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {children}
        </main>
      </section>
    </div>
  );
}
