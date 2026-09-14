"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { SelectionMenu } from "./SelectionMenu";
import { ParentContextBanner } from "./ParentContextBanner";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";
import { SplitPicker } from "@/components/split/SplitPicker";
import {
  DeleteChatDialog,
  DeleteChatMenuItem,
} from "./DeleteChatButton";
import { ExportMenuItems } from "./ExportMenu";
import { ShortcutOverlay } from "./ShortcutOverlay";
import { showToast } from "./toast";
import type { EditSaveResult } from "./EditMessage";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useSplit } from "@/lib/state/split";
import { invalidateTree } from "@/components/tree/useConversationTree";
import { createChatAction } from "@/lib/api-client/auth";
import { editMessage, regenerateMessage } from "@/lib/api-client/messages";
import type { Conversation, Message } from "@/lib/api-client/types";
import { Button } from "@/components/ui/button";

export interface ChatViewProps {
  conversation: Conversation;
  /**
   * When set, this ChatView renders inside a split-view pane (phase 2) and
   * participates in active-pane tracking instead of owning Split entry.
   */
  pane?: { index: 1 | 2 };
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

type StreamResult =
  | { kind: "completed" }
  | { kind: "aborted" }
  | {
      kind: "immediate-failure";
      code: string;
      message: string;
      fieldError?: string;
    };

const STREAM_HEADER = "x-vercel-ai-data-stream";

const MENU_ITEM_CLASS =
  "flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50";
const MENU_SEPARATOR_CLASS = "my-1 h-px bg-border";

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatView({ conversation, breadcrumbOverride, pane }: ChatViewProps) {
  const split = useSplit();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(conversation.messages);
  const [streaming, setStreaming] = useState<string>("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Ephemeral "Stopped" chip state (US-405 AC.3) — in-memory only. */
  const [stoppedIds, setStoppedIds] = useState<ReadonlySet<string>>(() => new Set());
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamingIdRef = useRef<string>("");
  const headerRef = useRef<HTMLHeadingElement | null>(null);
  const splitButtonRef = useRef<HTMLButtonElement | null>(null);

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

  const runStream = useCallback(
    async (opts: {
      /** Initiates the SSE request (send / edit / regenerate). */
      start: (signal: AbortSignal) => Promise<Response>;
      isRetry?: boolean;
      /** Fires once the SSE stream is confirmed to have started. */
      onStarted?: () => void;
    }): Promise<StreamResult> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus({ kind: "sending" });
      setStreaming("");

      let accumulated = "";
      let streamFinished = false;

      try {
        const res = await opts.start(controller.signal);

        if (!res.ok) {
          const errBody = await safeJson(res);
          const err = extractError(errBody);
          return {
            kind: "immediate-failure",
            code: err.code,
            message: err.message ?? friendlyMessageForCode(err.code, res.status),
            fieldError: err.fields?.content,
          };
        }

        if (!res.body) {
          return {
            kind: "immediate-failure",
            code: "HTTP_ERROR",
            message: "Empty response from server",
          };
        }

        opts.onStarted?.();

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
        return { kind: "completed" };
      } catch (err) {
        if (controller.signal.aborted) {
          // Intentional abort (US-405): partial content persists with the
          // ephemeral "Stopped" chip — never the phase-0 error banner.
          if (accumulated && !opts.isRetry) {
            const partialId = streamingIdRef.current || makeId("a");
            setMessages((prev) => [
              ...prev,
              {
                id: partialId,
                role: "assistant",
                content: accumulated,
                createdAt: new Date().toISOString(),
              },
            ]);
            setStoppedIds((prev) => new Set(prev).add(partialId));
          }
          setStreaming("");
          setStatus({ kind: "idle" });
          return { kind: "aborted" };
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
        return {
          kind: "immediate-failure",
          code: "STREAM_FAILED",
          message,
        };
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
      const result = await runStream({
        start: (signal) =>
          fetch(`/api/chats/${encodeURIComponent(conversation.id)}/messages`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              content: trimmed,
              clientMessageId: userMsgId,
            }),
            signal,
          }),
      });
      if (result.kind === "immediate-failure") {
        // The optimistic user message never reached the DB — drop it.
        setMessages((prev) => prev.filter((m) => m.id !== userMsgId));
      }
    },
    [conversation.id, runStream],
  );

  const retry = useCallback(() => {
    if (!lastUserMessage) return;
    void runStream({
      start: (signal) =>
        fetch(`/api/chats/${encodeURIComponent(conversation.id)}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: lastUserMessage.content,
            clientMessageId: lastUserMessage.id,
          }),
          signal,
        }),
      isRetry: true,
    });
  }, [conversation.id, lastUserMessage, runStream]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // US-407: save truncates the local tail immediately, then the SSE response
  // replaces it. Resolves at stream start so the edit UI closes; pre-stream
  // rejections restore the original tail and surface inline/toast errors.
  const handleEditSave = useCallback(
    (messageId: string, content: string): Promise<EditSaveResult> => {
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) {
        showToast({ message: "Message not found", role: "alert" });
        return Promise.resolve({ ok: false, error: "Message not found" });
      }
      const original = messages;
      const target = messages[idx]!;
      const pruned: Message[] = [
        ...messages.slice(0, idx),
        { ...target, content },
      ];
      setMessages(pruned);

      let started = false;
      return new Promise((resolve) => {
        void runStream({
          start: (signal) =>
            editMessage(conversation.id, messageId, content, signal),
          onStarted: () => {
            started = true;
            resolve({ ok: true });
          },
        }).then((result) => {
          if (result.kind !== "immediate-failure" || started) return;
          // Pre-stream rejection. Provider failures (502/503) mean the edit
          // already committed — keep the truncated tail and let the banner
          // + Retry take over (US-407 AC.7).
          const committedFailure =
            result.code === "NO_PROVIDER" ||
            result.code === "PROVIDER_FAILED" ||
            result.code === "STREAM_FAILED";
          if (!committedFailure) setMessages(original);
          if (
            result.code === "INVALID_INPUT" ||
            result.code === "NOT_EDITABLE"
          ) {
            resolve({
              ok: false,
              error: result.fieldError ?? result.message,
            });
          } else if (result.code === "NOT_FOUND") {
            showToast({ message: "Message not found", role: "alert" });
            resolve({ ok: false, error: result.message });
          } else if (result.code === "STREAM_ACTIVE") {
            showToast({
              message: "Stop the current response first",
              role: "alert",
            });
            resolve({ ok: false, error: result.message });
          } else if (result.code === "RATE_LIMITED") {
            showToast({
              message: "Too many actions — try again in a moment",
              role: "alert",
            });
            resolve({ ok: false, error: result.message });
          } else {
            resolve({ ok: true });
          }
        });
      });
    },
    [messages, conversation.id, runStream],
  );

  // US-408: confirm-free regenerate of the last assistant message.
  const handleRegenerate = useCallback(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const original = messages;
    setMessages((prev) => prev.filter((m) => m.id !== last.id));
    void runStream({
      start: (signal) => regenerateMessage(conversation.id, last.id, signal),
    }).then((result) => {
      if (result.kind !== "immediate-failure") return;
      setMessages(original);
      if (result.code === "NOT_FOUND") {
        showToast({ message: "Message not found", role: "alert" });
      } else if (result.code === "STREAM_ACTIVE") {
        showToast({ message: "Stop the current response first", role: "alert" });
      } else if (result.code === "RATE_LIMITED") {
        showToast({
          message: "Too many actions — try again in a moment",
          role: "alert",
        });
      } else if (result.code === "NOT_REGENERABLE") {
        showToast({
          message: "Only the latest response can be regenerated",
          role: "alert",
        });
      }
    });
  }, [messages, conversation.id, runStream]);

  // US-402 AC.3: on delete, prune the tree and leave the deleted view.
  const handleDeleted = useCallback(
    (result: { deletedIds: string[] }) => {
      invalidateTree();
      if (result.deletedIds.includes(conversation.id)) {
        router.push(
          conversation.parentId
            ? `/c/${encodeURIComponent(conversation.parentId)}`
            : "/",
        );
      } else {
        router.refresh();
      }
    },
    [conversation.id, conversation.parentId, router],
  );

  // US-409 AC.4: the split shortcut reuses the split store actions.
  const handleToggleSplit = useCallback(() => {
    if (split.splitOpen) {
      split.closeSplit();
      return;
    }
    if (!conversation.parentId) {
      showToast({ message: "This chat has no parent", role: "status" });
      return;
    }
    split.openSplit(conversation.id, conversation.parentId);
  }, [split, conversation.id, conversation.parentId]);

  const handleEscapePane = useCallback(
    (paneIndex: 1 | 2): boolean => {
      if (!split.splitOpen) return false;
      if (paneIndex === 2) {
        split.closeSplit();
        return true;
      }
      const secondary = split.secondaryId;
      split.closeSplit();
      if (secondary) router.push(`/c/${encodeURIComponent(secondary)}`);
      return true;
    },
    [split, router],
  );

  const isBusy = status.kind === "sending" || status.kind === "streaming";

  // Exactly one instance owns the global shortcuts: the standalone view, or
  // pane 1 while split view is open.
  const isPrimaryPane = !pane || pane.index === 1;
  const [pendingNewChat, startNewChatTransition] = useTransition();

  useShortcuts(
    {
      onNewChat: () => {
        if (pendingNewChat) return; // dedupe while in flight (US-409 AC.3)
        startNewChatTransition(() => createChatAction());
      },
      onToggleSplit: handleToggleSplit,
      onShowShortcuts: () => setShortcutsOpen(true),
      onEscapePane: isPrimaryPane ? handleEscapePane : undefined,
    },
    isPrimaryPane,
  );

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={breadcrumbOverride ?? buildBreadcrumb(conversation)}
      />

      <header className="flex h-14 items-center justify-between gap-2 border-b bg-background px-4">
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
        {!pane ? (
          <>
            <button
              ref={splitButtonRef}
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={isBusy}
              className="hidden rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:inline-flex"
              aria-haspopup="dialog"
            >
              Split
            </button>
            <SplitPicker
              open={pickerOpen}
              onOpenChange={(nextOpen) => {
                setPickerOpen(nextOpen);
                if (!nextOpen) {
                  requestAnimationFrame(() => splitButtonRef.current?.focus());
                }
              }}
              conversation={conversation}
              onPick={(id) => split.openSplit(conversation.id, id)}
            />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label="Conversation menu"
                  aria-haspopup="menu"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    fill="currentColor"
                  >
                    <circle cx="8" cy="3" r="1.4" />
                    <circle cx="8" cy="8" r="1.4" />
                    <circle cx="8" cy="13" r="1.4" />
                  </svg>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 min-w-[12rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                >
                  <ExportMenuItems conversationId={conversation.id} />
                  <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
                  <DeleteChatMenuItem onSelect={() => setDeleteOpen(true)} />
                  <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
                  <DropdownMenu.Item
                    className={MENU_ITEM_CLASS}
                    onSelect={() => setShortcutsOpen(true)}
                  >
                    Keyboard shortcuts
                    <kbd className="ml-auto rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                      ?
                    </kbd>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </>
        ) : null}
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
          stoppedIds={stoppedIds}
          busy={isBusy}
          onEditSave={handleEditSave}
          onRegenerate={handleRegenerate}
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
        streaming={isBusy}
        onStop={handleStop}
        statusLabel={
          status.kind === "sending"
            ? "Sending…"
            : status.kind === "streaming"
              ? "AI responding…"
              : null
        }
        placeholder={composerPlaceholder}
      />

      <SelectionMenu conversationId={conversation.id} paneIndex={pane?.index} />

      {isPrimaryPane ? (
        <>
          <DeleteChatDialog
            conversation={conversation}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeleted={handleDeleted}
          />
          <ShortcutOverlay
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />
        </>
      ) : null}
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

function extractError(body: unknown): {
  code: string;
  message: string | null;
  fields?: Record<string, string>;
} {
  if (body && typeof body === "object" && "error" in body) {
    const e = (
      body as {
        error?: { code?: string; message?: string; fields?: Record<string, string> };
      }
    ).error;
    return {
      code: e?.code ?? "HTTP_ERROR",
      message: e?.message ?? null,
      fields: e?.fields,
    };
  }
  return { code: "HTTP_ERROR", message: null };
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
