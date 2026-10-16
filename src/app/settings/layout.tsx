import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { Brand } from "@/components/layout/Brand";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin?callbackUrl=%2Fsettings%2Fproviders");
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background">
      <div className="subtle-grid pointer-events-none absolute inset-0 opacity-50" />
      <header className="relative border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-5xl items-center justify-between px-5 sm:px-8">
          <Brand />
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border bg-card/70 px-3 py-2 text-xs font-semibold text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to chats
          </Link>
        </div>
      </header>
      <div className="relative mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <header className="mb-8 flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <SlidersHorizontal className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.035em]">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tune the workspace to match how you think.
            </p>
          </div>
        </header>
        <div className="rounded-[1.5rem] border border-border/70 bg-card/80 p-5 shadow-xl shadow-foreground/[0.04] backdrop-blur-xl sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
