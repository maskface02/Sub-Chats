import { ChatListSkeleton, MessageListSkeleton } from "@/components/chat/ChatListSkeleton";

export function AppShellSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div className="h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-72 shrink-0 border-r bg-muted/20 p-3 md:block">
          <div className="mb-3 h-8 animate-pulse rounded bg-muted" />
          <ChatListSkeleton rows={6} />
        </aside>
        <main className="flex flex-1 flex-col">
          <div className="flex h-14 items-center border-b px-4">
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          </div>
          <MessageListSkeleton rows={6} />
          <div className="border-t bg-background px-4 py-3">
            <div className="mx-auto h-12 max-w-3xl animate-pulse rounded bg-muted" />
          </div>
        </main>
      </div>
    </div>
  );
}