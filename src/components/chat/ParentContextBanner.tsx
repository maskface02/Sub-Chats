"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, GitBranch, Quote } from "lucide-react";

export interface ParentContextBannerProps {
  highlightText: string | null;
  highlightContext: string | null;
  parentMessageContent?: string | null;
  parentTitle?: string | null;
  parentMessageId?: string | null;
}

const PREVIEW_LIMIT = 500;
const LABEL_LIMIT = 200;

export function ParentContextBanner({
  highlightText,
  highlightContext,
  parentMessageContent,
  parentTitle,
}: ParentContextBannerProps) {
  const [expanded, setExpanded] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (expanded !== null) return;
    setExpanded(window.matchMedia("(min-width: 768px)").matches);
  }, [expanded]);

  const label = truncate(highlightText ?? "", LABEL_LIMIT);
  const previewSource = parentMessageContent ?? highlightContext ?? "";
  const preview = previewSource || highlightText || "";
  const hasPreview = preview.length > 0;
  const isOpen = expanded ?? false;

  return (
    <section
      aria-label="Parent context"
      data-testid="parent-context-banner"
      className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.055] via-violet-500/[0.035] to-transparent px-4 py-3 sm:px-6"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <GitBranch className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/80">
                Branched thought
                {parentTitle ? (
                  <span className="ml-1 normal-case tracking-normal text-muted-foreground">
                    · from {parentTitle}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 line-clamp-2 break-words text-sm font-medium text-foreground">
                {label ? `“${label}”` : "(no highlight)"}
              </p>
            </div>
          </div>
          {hasPreview ? (
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls="parent-context-banner-content"
              onClick={() => setExpanded((v) => !(v ?? false))}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-xl border bg-background/75 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground shadow-sm",
                "transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              {isOpen ? "Hide source" : "Show source"}
              <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", isOpen && "rotate-180")} />
            </button>
          ) : null}
        </div>
        {hasPreview && isOpen ? (
          <div
            id="parent-context-banner-content"
            data-testid="parent-context-banner-content"
            className="animate-enter ml-11 rounded-2xl border border-border/70 bg-background/75 p-3.5 text-sm leading-6 text-foreground/90 shadow-sm"
          >
            <Quote className="mb-1.5 h-3.5 w-3.5 text-primary/60" />
            {renderHighlightedPreview(
              preview.length > PREVIEW_LIMIT
                ? preview.slice(0, PREVIEW_LIMIT)
                : preview,
              highlightText,
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return `${s.slice(0, Math.max(0, limit - 1))}…`;
}

function renderHighlightedPreview(text: string, highlight: string | null) {
  if (!highlight) {
    return <span data-no-branch="true">{text}</span>;
  }
  const idx = text.indexOf(highlight);
  if (idx === -1) {
    return <span data-no-branch="true">{text}</span>;
  }
  const before = text.slice(0, idx);
  const hit = text.slice(idx, idx + highlight.length);
  const after = text.slice(idx + highlight.length);
  return (
    <span data-no-branch="true">
      {before}
      <mark
        className={cn(
          "rounded-sm bg-yellow-100 px-0.5 decoration-yellow-500 decoration-2 underline-offset-2",
          "dark:bg-yellow-900/30",
        )}
        data-no-branch="true"
      >
        {hit}
      </mark>
      {after}
    </span>
  );
}
