"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

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
      className="border-b bg-muted/30 px-4 py-3"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              About
              {parentTitle ? (
                <span className="ml-1 normal-case tracking-normal text-foreground/80">
                  · from {parentTitle}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-sm font-medium text-foreground break-words">
              {label ? `“${label}”` : "(no highlight)"}
            </p>
          </div>
          {hasPreview ? (
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls="parent-context-banner-content"
              onClick={() => setExpanded((v) => !(v ?? false))}
              className={cn(
                "shrink-0 rounded-md border bg-background px-2 py-1 text-xs font-medium",
                "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              {isOpen ? "Hide source" : "Show source"}
            </button>
          ) : null}
        </div>
        {hasPreview && isOpen ? (
          <div
            id="parent-context-banner-content"
            data-testid="parent-context-banner-content"
            className="rounded-md border bg-background/70 p-3 text-sm leading-relaxed text-foreground/90"
          >
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
