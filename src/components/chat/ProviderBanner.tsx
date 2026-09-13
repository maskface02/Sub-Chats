import Link from "next/link";
import type { ProviderInfo } from "@/lib/api-client/types";
import { cn } from "@/lib/utils";

export interface ProviderBannerProps {
  provider: ProviderInfo | null | undefined;
}

export function ProviderBanner({ provider }: ProviderBannerProps) {
  if (provider && provider.type) return null;
  return (
    <div
      role="status"
      className={cn(
        "border-b border-amber-300/40 bg-amber-100/60 px-4 py-2 text-sm text-amber-900",
        "dark:border-amber-700/40 dark:bg-amber-950/60 dark:text-amber-100",
      )}
    >
      <span className="font-medium">No AI provider configured.</span>{" "}
      Set <code className="rounded bg-amber-200/60 px-1 py-0.5 text-xs">OPENAI_API_KEY</code>{" "}
      or run Ollama locally at{" "}
      <code className="rounded bg-amber-200/60 px-1 py-0.5 text-xs">OLLAMA_BASE_URL</code>.{" "}
      See{" "}
      <Link
        href="https://github.com/anomalyco/opencode"
        className="underline underline-offset-2"
        target="_blank"
        rel="noreferrer"
      >
        setup notes
      </Link>
      .
    </div>
  );
}