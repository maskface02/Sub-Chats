import Link from "next/link";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  id: string | null;
  title: string;
  /**
   * If true, the crumb is rendered as plain text (no link) and the link
   * target is not known (e.g. foreign-owned ancestor or root). Use with
   * `id: null` or a "Private" title.
   */
  unlinked?: boolean;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Conversation path"
      data-testid="breadcrumb"
      className="border-b bg-background/95 px-4 py-2 text-xs"
    >
      <ol className="mx-auto flex max-w-3xl flex-wrap items-center gap-1 text-muted-foreground">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          const isCurrent = isLast;
          const showTruncatedMobile =
            !isCurrent && item.title.length > 40;
          const displayTitle = showTruncatedMobile
            ? `${item.title.slice(0, 39)}…`
            : item.title;
          return (
            <li key={`${idx}-${item.id ?? "u"}`} className="flex items-center gap-1">
              {isCurrent || item.unlinked || !item.id ? (
                <span
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "rounded px-1 py-0.5",
                    isCurrent
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                  title={item.title}
                >
                  {displayTitle || "Unknown"}
                </span>
              ) : (
                <Link
                  href={`/c/${item.id}`}
                  className={cn(
                    "rounded px-1 py-0.5 hover:bg-accent hover:text-accent-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  title={item.title}
                >
                  <span className="hidden md:inline">{item.title}</span>
                  <span className="md:hidden">{displayTitle}</span>
                </Link>
              )}
              {!isLast ? (
                <span aria-hidden="true" className="text-muted-foreground/60">
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
