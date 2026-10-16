import { HomeCanvas } from "@/components/chat/HomeCanvas";
import { getWorkspaceProvider } from "@/lib/api-client/workspace-provider";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=%2F");
  const provider = await getWorkspaceProvider();
  return <HomeCanvas providerReady={Boolean(provider.type)} draftKey={`home-draft:${session.user.id}`} />;
}
