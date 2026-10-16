import { redirect } from "next/navigation";
import { GitBranch, Highlighter, Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";
import { Brand } from "@/components/layout/Brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background">
      <div className="subtle-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative mx-auto grid min-h-dvh max-w-7xl lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-r border-border/70 p-12 lg:flex">
          <Brand />
          <div className="relative z-10 max-w-xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/[0.07] px-3 py-1.5 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Conversations that grow with your thinking
            </div>
            <h1 className="text-5xl font-semibold leading-[1.06] tracking-[-0.05em]">
              One idea can lead
              <span className="block text-primary">somewhere brilliant.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
              Keep the main thread clear while you explore every useful tangent.
              Sub-chats carries the context, so your curiosity never creates clutter.
            </p>
            <div className="mt-9 flex items-center gap-3 text-xs font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-2 rounded-xl border bg-card/70 px-3 py-2 shadow-sm">
                <Highlighter className="h-3.5 w-3.5 text-primary" /> Highlight
              </span>
              <span className="h-px w-6 bg-border" />
              <span className="inline-flex items-center gap-2 rounded-xl border bg-card/70 px-3 py-2 shadow-sm">
                <GitBranch className="h-3.5 w-3.5 text-primary" /> Branch
              </span>
              <span className="h-px w-6 bg-border" />
              <span className="inline-flex items-center gap-2 rounded-xl border bg-card/70 px-3 py-2 shadow-sm">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Discover
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A focused workspace for curious minds.
          </p>
          <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        </section>

        <section className="flex min-h-dvh flex-col px-5 py-6 sm:px-8 lg:items-center lg:justify-center lg:px-12">
          <Brand className="mb-12 lg:hidden" />
          <div className="animate-enter mx-auto my-auto w-full max-w-md">
            {children}
            <p className="mt-6 text-center text-[11px] leading-5 text-muted-foreground">
              Your conversations stay private to your account.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
