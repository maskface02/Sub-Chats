import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { allowGuestAccess } from "@/lib/config/flags";
import { listChats, getHealth } from "@/lib/api-client/chats";
import { AppShell } from "@/components/layout/AppShell";
import { NewChatButton } from "@/components/chat/NewChatButton";
import type {
  ChatListItem,
  HealthResponse,
  ProviderInfo,
} from "@/lib/api-client/types";

export const dynamic = "force-dynamic";

async function safeListChats(): Promise<{
  items: ChatListItem[];
  error: boolean;
}> {
  try {
    const r = await listChats();
    return { items: r.items, error: false };
  } catch {
    return { items: [], error: true };
  }
}

async function safeHealth(): Promise<ProviderInfo> {
  try {
    const r: HealthResponse = await getHealth();
    return r.provider;
  } catch {
    return { type: null, model: null, baseUrl: null };
  }
}

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin?callbackUrl=%2F");
  }

  const [listResult, providerInfo] = await Promise.all([
    safeListChats(),
    safeHealth(),
  ]);

  return (
    <AppShell
      user={{
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? null,
        image: session.user.image ?? null,
      }}
      guestMode={allowGuestAccess()}
      chats={listResult.items}
      chatsError={listResult.error}
      currentChatId={null}
      providerInfo={providerInfo}
    >
      <HomeEmpty hasChats={listResult.items.length > 0 && !listResult.error} />
    </AppShell>
  );
}

function HomeEmpty({ hasChats }: { hasChats: boolean }) {
  if (hasChats) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <h2 className="text-lg font-medium">Pick a conversation</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Choose a chat from the sidebar, or start a new one.
        </p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full border bg-muted px-4 py-1 text-xs uppercase tracking-wide text-muted-foreground">
        Welcome
      </div>
      <h2 className="text-xl font-semibold">No chats yet — start your first conversation</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Start a thread and the AI will respond in real time.
      </p>
      <NewChatButton />
      <p className="text-xs text-muted-foreground">
        Or read the{" "}
        <Link
          href="https://github.com/anomalyco/opencode"
          className="underline underline-offset-2"
          target="_blank"
          rel="noreferrer"
        >
          docs
        </Link>
        .
      </p>
    </div>
  );
}