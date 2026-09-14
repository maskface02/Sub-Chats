import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin?callbackUrl=/settings/providers");
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to chats
        </Link>
      </div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
      </header>
      {children}
    </main>
  );
}
