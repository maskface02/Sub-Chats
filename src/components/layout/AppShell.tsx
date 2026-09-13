import Link from "next/link";
import type { ReactNode } from "react";
import { UserMenu } from "@/components/layout/UserMenu";
import { NewChatButton } from "@/components/chat/NewChatButton";
import { ProviderBanner } from "@/components/chat/ProviderBanner";
import { RetryButton } from "@/components/layout/RetryButton";
import { formatRelativeTime, cn } from "@/lib/utils";
import type {
  ChatListItem,
  ProviderInfo,
  SessionUser,
} from "@/lib/api-client/types";

export interface AppShellProps {
  user: SessionUser;
  chats: ChatListItem[];
  chatsError?: boolean;
  currentChatId?: string | null;
  providerInfo: ProviderInfo;
  headerSlot?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  user,
  chats,
  chatsError = false,
  currentChatId = null,
  providerInfo,
  headerSlot,
  children,
}: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-semibold tracking-tight">
            Sub-chats
          </Link>
          <div className="hidden md:block">
            <NewChatButton fullWidth={false} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {headerSlot}
          <UserMenu email={user.email} name={user.name} />
        </div>
      </header>

      <ProviderBanner provider={providerInfo} />

      <div className="flex flex-1 overflow-hidden">
        <aside
          aria-label="Conversations"
          className="hidden w-72 shrink-0 border-r bg-muted/20 md:flex md:flex-col"
        >
          <div className="border-b p-3">
            <NewChatButton />
          </div>
          <nav className="flex-1 overflow-y-auto p-2">
            {chatsError ? (
              <ErrorState />
            ) : chats.length === 0 ? (
              <EmptyListState />
            ) : (
              <ul className="space-y-1">
                {chats.map((chat) => {
                  const isActive = currentChatId === chat.id;
                  return (
                    <li key={chat.id}>
                      <Link
                        href={`/c/${chat.id}`}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "block rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                          isActive && "bg-accent text-accent-foreground",
                        )}
                      >
                        <div className="truncate font-medium">
                          {chat.title || "New chat"}
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="truncate">
                            {chat.preview ?? "No messages yet"}
                          </span>
                          <span className="ml-2 shrink-0">
                            {formatRelativeTime(chat.updatedAt)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function EmptyListState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <p className="text-sm font-medium">No chats yet</p>
      <p className="text-xs text-muted-foreground">
        Start your first conversation with the button above.
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <p className="text-sm font-medium text-destructive">
        Could not load chats
      </p>
      <RetryButton className="mt-2" />
    </div>
  );
}