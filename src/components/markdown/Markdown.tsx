"use client";

import {
  Children,
  memo,
  isValidElement,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";

type PreProps = { children?: ReactNode };

function extractLanguage(children: ReactNode): string {
  const code = Children.toArray(children).find(isValidElement);
  if (!code || typeof code.props !== "object" || code.props === null) {
    return "";
  }
  const className = (code.props as { className?: string }).className ?? "";
  const match = /language-([\w-]+)/.exec(className);
  return match ? match[1] : "";
}

function PreBlock({ children }: PreProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const language = extractLanguage(children);

  const copy = async () => {
    const text = preRef.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — copy is best-effort
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-zinc-100 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <span
          aria-label={`${language || "code"} code`}
          className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="rounded px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        ref={preRef}
        tabIndex={0}
        className="overflow-x-auto px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  a: ({ node, href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="underline underline-offset-2"
      {...props}
    >
      {children}
    </a>
  ),
  img: ({ node, src, alt }) => {
    // Images render as links only (phase 3 decision): no <img> / IP leak surface.
    const url = typeof src === "string" ? src : "";
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="underline underline-offset-2 break-all"
      >
        {url || alt || "image"}
      </a>
    );
  },
  pre: PreBlock,
  table: ({ node, children, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table
        className="w-full border-collapse text-sm [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:font-semibold [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
};

/**
 * Safe react-markdown wrapper. rehype-highlight (CSS-class based, detect
 * disabled — US-406) is the ONLY rehype plugin; no rehype-raw and never
 * dangerouslySetInnerHTML: AI output is untrusted and raw HTML must degrade
 * to text. The default urlTransform neutralizes javascript:/data: URIs.
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div
      className={cn(
        "text-sm",
        "[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold",
        "[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:ml-4 [&_ul_li]:list-disc [&_ol_li]:list-decimal",
        "[&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground",
        "[_hr]:my-2",
        "[&_li.task-list-item]:list-none [&_input[type=checkbox]]:mr-1 [&_del]:opacity-75",
        "[&:not(pre)>code]:rounded [&:not(pre)>code]:bg-muted [&:not(pre)>code]:px-1 [&:not(pre)>code]:py-[1px] [&:not(pre)>code]:font-mono [&:not(pre)>code]:text-[13px]",
        "[&_pre_code]:font-mono [&_pre_code]:text-[13px] [&_pre_code]:leading-snug",
      )}
      data-component="markdown"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
