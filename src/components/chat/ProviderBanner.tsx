import Link from "next/link";
import type { ProviderInfo } from "@/lib/api-client/types";
import { cn } from "@/lib/utils";
import { ArrowRight, Sparkles } from "lucide-react";

export interface ProviderBannerProps {
  provider: ProviderInfo | null | undefined;
}

export function ProviderBanner({ provider }: ProviderBannerProps) {
  if (provider && provider.type) return null;
  return (
    <div
      role="status"
      className={cn(
        "border-b border-border/60 bg-muted/40 px-4 py-2 text-muted-foreground",
        "dark:border-amber-700/40 dark:bg-amber-950/60 dark:text-amber-100",
      )}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-5 w-5 shrink-0 place-items-center text-muted-foreground">
            <Sparkles className="h-3 w-3" />
          </span>
          <span className="truncate">
            <span className="font-semibold">No AI provider configured.</span>
            <span className="hidden text-muted-foreground sm:inline">
              {" "}Connect one to start sending messages.
            </span>
          </span>
        </span>
        <Link
          href="/settings/providers"
          aria-label="Connect provider"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Connect provider <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
