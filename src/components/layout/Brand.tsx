import Link from "next/link";
import { GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/"
      aria-label="Sub-chats home"
      className={cn(
        "group inline-flex items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-[1.03]">
        <span className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.35),transparent_44%)]" />
        <GitBranch className="relative h-[18px] w-[18px]" strokeWidth={2.2} />
      </span>
      {compact ? null : (
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
            Sub-chats
          </span>
        </span>
      )}
    </Link>
  );
}
