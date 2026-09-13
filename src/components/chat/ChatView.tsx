"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { SelectionMenu } from "./SelectionMenu";
import { ParentContextBanner } from "./ParentContextBanner";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";
import type { Conversation, Message } from "@/lib/api-client/types";
import { Button } from "@/components/ui/button";

export interface ChatViewProps {
  conversation: Conversation;
  /**
   * Optional override: how to render breadcrumb ancestors when the API
   * does not return `parentTitle` / `rootTitle`. Caller can supply the chain
   * explicitly (e.g. by walking up via separate fetches). When omitted, the
   * breadcrumb uses whatever the API supplied.
   */
  breadcrumbOverride?: BreadcrumbItem[];
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "streaming" }
  | { kind: "error"; message: string };

const STREAM_HEADER = "x-vercel-ai-data-stream";

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatView({ conversation, breadcrumbOverride }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>(conversation.messages);
  const [streaming, setStreaming] = useState<string>("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamingIdRef = useRef<string>("");
  const headerRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming]);

  // Focus the header on conversation change (per spec §9 focus management).
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    el.focus();
  }, [conversation.id]);

  const lastUserMessage = findLastUser(messages);
  const isSubChat = conversation.depth >= 1;
  const composerPlaceholder = isSubChat
    ? buildHighlightPlaceholder(conversation.highlightText)
    : undefined;

  const streamOnce = useCallback(
    async (opts: {
      content: string;
      clientMessageId: string;
      isRetry: boolean;
    }): Promise<"started" | "immediate-failure" | "aborted"> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus({ kind: "sending" });
      setStreaming("");

      let accumulated = "";
      let streamFinished = false;

      try {
        const res = await fetch(
          `/api/chats/${encodeURIComponent(conversation.id)}/messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              content: opts.content,
              clientMessageId: opts.clientMessageId,
            }),
            signal: controller.signal,
          },
        );

        if (!res.ok) {
          const errBody = await safeJson(res);
          const code =
            (errBody &&
            typeof errBody === "object" &&
            "error" in errBody
              ? (errBody as { error?: { code?: string; message?: string } })
                  .error?.code
              : null) ?? "HTTP_ERROR";
          const message =
            (errBody &&
            typeof errBody === "object" &&
            "error" in errBody
              ? (errBody as { error?: { message?: string } }).error?.message
              : null) ?? friendlyMessageForCode(code, res.status);
          setStatus({ kind: "error", message });
          return "immediate-failure";
        }

        if (!res.body) {
          setStatus({ kind: "error", message: "Empty response from server" });
          return "immediate-failure";
        }

        const isDataStream =
          (res.headers.get("content-type") ?? "").includes("text/plain") ||
          res.headers.get(STREAM_HEADER) !== null;

        setStatus({ kind: "streaming" });
        streamingIdRef.current = makeId("a");

        if (isDataStream) {
          await consumeDataStream(res.body, {
            onTextDelta: (chunk) => {
              accumulated += chunk;
              setStreaming(accumulated);
            },
            signal: controller.signal,
          });
        } else {
          for await (const ev of consumeSse(res.body, controller.signal)) {
            if (ev.event === "error") throw new Error(ev.data);
            accumulated += ev.data;
            setStreaming(accumulated);
          }
        }

        streamFinished = true;
        setMessages((prev) => [
          ...prev,
          {
            id: streamingIdRef.current || makeId("a"),
            role: "assistant",
            content: accumulated,
            createdAt: new Date().toISOString(),
          },
        ]);
        setStreaming("");
        setStatus({ kind: "idle" });
        return "started";
      } catch (err) {
        if (controller.signal.aborted) {
          if (accumulated && !opts.isRetry) {
            appendAssistant(accumulated, setMessages);
          }
          setStreaming("");
          setStatus({ kind: "idle" });
          return "aborted";
        }
        if (accumulated && !opts.isRetry) {
          appendAssistant(accumulated, setMessages);
        }
        const message =
          err instanceof Error && streamFinished
            ? `AI stopped responding — ${err.message}`
            : "AI stopped responding — try again";
        setStreaming("");
        setStatus({ kind: "error", message });
        return "immediate-failure";
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [conversation.id],
  );

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const userMsgId = makeId("u");
      const userMessage: Message = {
        id: userMsgId,
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      const result = await streamOnce({
        content: trimmed,
        clientMessageId: userMsgId,
        isRetry: false,
      });
      if (result === "immediate-failure") {
        // The optimistic user message never reached the DB — drop it.
        setMessages((prev) => prev.filter((m) => m.id !== userMsgId));
      }
    },
    [streamOnce],
  );

  const retry = useCallback(() => {
    if (!lastUserMessage) return;
    void streamOnce({
      content: lastUserMessage.content,
      clientMessageId: lastUserMessage.id,
      isRetry: true,
    });
  }, [lastUserMessage, streamOnce]);

  const isBusy = status.kind === "sending" || status.kind === "streaming";

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={breadcrumbOverride ?? buildBreadcrumb(conversation)}
      />

      <header className="flex h-14 items-center justify-between border-b bg-background px-4">
        <h1
          ref={headerRef}
          tabIndex={-1}
          className="truncate text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={conversation.title}
        >
          {conversation.title || "New chat"}
        </h1>
        <span className="text-xs text-muted-foreground">
          {messages.length} {messages.length === 1 ? "message" : "messages"}
        </span>
      </header>

      {isSubChat ? (
        <ParentContextBanner
          highlightText={conversation.highlightText}
          highlightContext={conversation.highlightContext}
          parentMessageContent={conversation.parentMessageContent ?? null}
          parentTitle={conversation.parentTitle ?? null}
          parentMessageId={conversation.parentMessageId ?? null}
        />
      ) : null}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <MessageList
          messages={messages}
          streamingContent={status.kind === "streaming" ? streaming : null}
          streamingId={streamingIdRef.current}
        />
      </div>

      {status.kind === "error" ? (
        <div
          role="alert"
          className="border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-sm"
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <span className="text-destructive">{status.message}</span>
            {lastUserMessage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={retry}
                aria-label="Retry last message"
              >
                Retry
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <Composer
        onSend={(c) => void send(c)}
        disabled={isBusy}
        statusLabel={
          status.kind === "sending"
            ? "Sending…"
            : status.kind === "streaming"
              ? "AI responding…"
              : null
        }
        placeholder={composerPlaceholder}
      />

      <SelectionMenu conversationId={conversation.id} />
    </div>
  );
}

function buildBreadcrumb(conv: Conversation): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    { id: null, title: "Home", unlinked: true },
  ];
  if (conv.depth === 0) {
    items.push({
      id: conv.id,
      title: conv.title || "Untitled",
      unlinked: true,
    });
    return items;
  }

  // Use the full ancestor chain (ancestorTitles) when the server provides
  // it (depth ≥ 2 — covers the chain from direct parent up to root).
  // Fall back to rootTitle for older responses.
  const chain =
    conv.ancestorTitles && conv.ancestorTitles.length > 0
      ? conv.ancestorTitles
      : conv.rootConversationId !== conv.id && conv.rootTitle
        ? [{ id: conv.rootConversationId, title: conv.rootTitle, depth: 0 }]
        : [];

  for (const a of chain) {
    if (a.title) {
      items.push({ id: a.id, title: a.title });
    } else {
      // Foreign-owned ancestor: title lookup returned null.
      // "Private" (not "Unknown") — consistent with US-107 AC.3 — avoids
      // hinting that the ancestor exists vs is missing.
      items.push({ id: null, title: "Private", unlinked: true });
    }
  }

  items.push({
    id: conv.id,
    title: conv.title || "New chat",
    unlinked: true,
  });
  return items;
}

function buildHighlightPlaceholder(highlight: string | null): string {
  if (!highlight) return "Message the AI…";
  const cleaned = highlight.trim();
  if (!cleaned) return "Message the AI…";
  const words = cleaned.split(/\s+/).slice(0, 3);
  if (words.length === 0) return "Message the AI…";
  return `Ask about ${words.join(" ")}…`;
}

function findLastUser(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return messages[i]!;
  }
  return null;
}

function appendAssistant(
  content: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
) {
  if (!content) return;
  setMessages((prev) => [
    ...prev,
    {
      id: makeId("partial"),
      role: "assistant",
      content,
      createdAt: new Date().toISOString(),
    },
  ]);
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function friendlyMessageForCode(code: string, status: number): string {
  switch (code) {
    case "NO_PROVIDER":
      return "No AI provider configured — check server settings.";
    case "PROVIDER_FAILED":
      return "AI provider is unreachable — check configuration.";
    case "UNAUTHENTICATED":
      return "Please sign in to continue.";
    case "NOT_FOUND":
      return "Conversation not found.";
    default:
      if (status === 401) return "Please sign in to continue.";
      if (status === 502 || status === 503)
        return "AI provider is unreachable — try again.";
      if (status >= 500) return "Server error — try again.";
      return "Could not send — check your connection.";
  }
}

async function consumeDataStream(
  body: ReadableStream<Uint8Array>,
  opts: { onTextDelta: (s: string) => void; signal: AbortSignal },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (opts.signal.aborted) {
        try {
          await reader.cancel();
        } catch {}
        throw new DOMException("Aborted", "AbortError");
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleDataStreamLine(line, opts.onTextDelta);
      }
    }
    if (buffer.length) handleDataStreamLine(buffer, opts.onTextDelta);
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

function handleDataStreamLine(
  line: string,
  onTextDelta: (s: string) => void,
): void {
  if (!line || line.startsWith(":")) return;
  const colon = line.indexOf(":");
  if (colon === -1) return;
  const prefix = line.slice(0, colon);
  const payload = line.slice(colon + 1);
  if (prefix === "0") {
    try {
      const text = JSON.parse(payload) as string;
      if (typeof text === "string") onTextDelta(text);
    } catch {}
  } else if (prefix === "3" || prefix === "e") {
    try {
      const msg = JSON.parse(payload) as unknown;
      const text =
        typeof msg === "string"
          ? msg
          : msg && typeof msg === "object" && "message" in msg
            ? String((msg as { message?: unknown }).message)
            : "Stream error";
      throw new Error(text);
    } catch (err) {
      if (err instanceof SyntaxError) return;
      throw err;
    }
  }
}

async function* consumeSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal.aborted) {
        try {
          await reader.cancel();
        } catch {}
        throw new DOMException("Aborted", "AbortError");
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const ev = parseSseEvent(raw);
        if (ev) yield ev;
      }
    }
    if (buffer.trim()) {
      const ev = parseSseEvent(buffer);
      if (ev) yield ev;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

function parseSseEvent(raw: string): { event: string; data: string } | null {
  const lines = raw.split(/\r?\n/);
  let event = "message";
  const data: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx);
    const value = line.slice(idx + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (!data.length) return null;
  return { event, data: data.join("\n") };
}