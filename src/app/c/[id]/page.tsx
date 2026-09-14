import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { allowGuestAccess } from "@/lib/config/flags";
import { getChat, getHealth, listChats } from "@/lib/api-client/chats";
import { ApiError } from "@/lib/api-client/base";
import { AppShell } from "@/components/layout/AppShell";
import { SplitChatArea } from "@/components/split/SplitView";
import { Button } from "@/components/ui/button";
import type { ChatListItem, Conversation, ProviderInfo } from "@/lib/api-client/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function safeGetChat(id: string): Promise<{
  conversation: Conversation | null;
  notFound: boolean;
}> {
  try {
    const conv = await getChat(id);
    return { conversation: conv, notFound: false };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) {
        return { conversation: null, notFound: true };
      }
    }
    throw err;
  }
}

async function safeHealth(): Promise<ProviderInfo> {
  try {
    const r = await getHealth();
    return r.provider;
  } catch {
    return { type: null, model: null, baseUrl: null };
  }
}

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

export default async function ChatPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) {
    const { id } = await params;
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/c/${id}`)}`);
  }

  const { id } = await params;
  const [{ conversation, notFound }, providerInfo, listResult] =
    await Promise.all([safeGetChat(id), safeHealth(), safeListChats()]);

  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  };

  if (notFound || !conversation) {
    return (
      <AppShell
        user={user}
        guestMode={allowGuestAccess()}
        chats={listResult.items}
        chatsError={listResult.error}
        currentChatId={id}
        providerInfo={providerInfo}
      >
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-lg font-semibold">Conversation not found</h2>
          <p className="text-sm text-muted-foreground">
            It may have been deleted or never existed.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back to chats</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      user={user}
      guestMode={allowGuestAccess()}
      chats={listResult.items}
      chatsError={listResult.error}
      currentChatId={id}
      providerInfo={providerInfo}
      conversation={conversation}
    >
      <SplitChatArea conversation={conversation} />
    </AppShell>
  );
}