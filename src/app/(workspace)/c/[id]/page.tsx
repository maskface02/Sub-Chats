import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getChat } from "@/lib/api-client/chats";
import { getWorkspaceProvider } from "@/lib/api-client/workspace-provider";
import { ApiError } from "@/lib/api-client/base";
import { AppShell } from "@/components/layout/AppShell";
import { SplitChatArea } from "@/components/split/SplitView";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user)
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/c/${id}`)}`);
  const [conversation, providerInfo] = await Promise.all([
    getChat(id).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    getWorkspaceProvider(),
  ]);
  return (
    <AppShell providerInfo={providerInfo}>
      {conversation ? (
        <SplitChatArea key={conversation.id} conversation={conversation} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-lg font-semibold">Conversation not found</h2>
          <p className="text-sm text-muted-foreground">
            It may have been deleted or never existed.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back to chats</Link>
          </Button>
        </div>
      )}
    </AppShell>
  );
}
