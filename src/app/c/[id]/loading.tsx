import {
  ChatListSkeleton,
  MessageListSkeleton,
} from "@/components/chat/ChatListSkeleton";

export default function ChatLoading() {
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
          <div
            aria-hidden="true"
            data-testid="breadcrumb-skeleton"
            className="border-b bg-background/95 px-4 py-2"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2 text-xs">
              <div className="h-3 w-8 animate-pulse rounded bg-muted" />
              <span aria-hidden="true" className="text-muted-foreground/60">/</span>
              <div className="h-3 w-32 animate-pulse rounded bg-muted" />
            </div>
          </div>
          <div className="flex h-14 items-center border-b px-4">
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          </div>
          <div
            aria-hidden="true"
            data-testid="parent-context-banner-skeleton"
            className="border-b bg-muted/30 px-4 py-3"
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-2">
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
          <MessageListSkeleton rows={3} />
          <div className="border-t bg-background px-4 py-3">
            <div className="mx-auto h-12 max-w-3xl animate-pulse rounded bg-muted" />
          </div>
        </main>
      </div>
    </div>
  );
}
