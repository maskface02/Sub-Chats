import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { allowGuestAccess } from "@/lib/config/flags";
import { listChats } from "@/lib/api-client/chats";
import { WorkspaceFrame } from "@/components/layout/WorkspaceFrame";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=%2F");
  const result = await listChats().catch(() => null);
  return (
    <WorkspaceFrame
      user={{
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? null,
        image: session.user.image ?? null,
      }}
      guestMode={allowGuestAccess()}
      initialChats={result?.items ?? []}
      initialError={!result}
    >
      {children}
    </WorkspaceFrame>
  );
}
