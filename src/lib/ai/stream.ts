import "server-only";
import { streamText, type CoreMessage } from "ai";
import { eq, asc, and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { getActiveProviderFor, SsrfBlockedError } from "./provider";
import { log } from "@/lib/log";

const globalForInFlight = globalThis as unknown as {
  __chatInFlight?: Map<string, AbortController>;
};

const inFlight: Map<string, AbortController> =
  globalForInFlight.__chatInFlight ?? new Map<string, AbortController>();
globalForInFlight.__chatInFlight = inFlight;

const ABORT_GRACE_MS = 100;
const PARTIAL_PERSIST_TIMEOUT_MS = 30_000;

export type StreamChatInput = {
  conversationId: string;
  userId: string;
  userMessage: string;
  clientMessageId?: string;
  depth?: number;
};

export type StreamChatResult =
  | { ok: true; response: Response }
  | { ok: false; status: number; body: unknown };

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type ConversationRow = {
  id: string;
  userId: string;
  parentId: string | null;
  rootConversationId: string;
  depth: number;
  title: string;
  highlightText: string | null;
};

export type MessageRow = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
};

async function assertOwnership(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const owned = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
      ),
    )
    .limit(1);
  return owned.length > 0;
}

async function loadHistory(
  conversationId: string,
): Promise<CoreMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  return rows.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));
}

// ---------- sub-chat helpers (exported, testable) ----------

const DEFAULT_SUBSCHAT_SYSTEM_PROMPT =
  'You are answering a follow-up question in a sub-chat. The user branched from {parentTitle} at the phrase: "{highlightText}". The following conversation history provides context; respond to the latest user message.';

export function buildSubChatSystemNote(args: {
  parentTitle: string | null;
  highlightText: string | null;
}): string {
  const tmpl =
    process.env.SUBSCHAT_SYSTEM_PROMPT ?? DEFAULT_SUBSCHAT_SYSTEM_PROMPT;
  return tmpl
    .replace(/\{parentTitle\}/g, args.parentTitle ?? "a parent chat")
    .replace(/\{highlightText\}/g, args.highlightText ?? "a highlighted passage");
}

const SENTENCE_SPLIT_RE = /\s*[^.!?]+[.!?]+/g;

export function extractSentenceContext(
  content: string,
  charStart: number,
  charEnd: number,
  maxChars = 500,
): string {
  if (!content) return "";
  const sentences: Array<{ text: string; start: number; end: number }> = [];
  const re = new RegExp(SENTENCE_SPLIT_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    sentences.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }

  const fallback = () => {
    if (content.length <= maxChars) return content;
    const budget = Math.max(1, maxChars - 1);
    const truncated = content.slice(0, budget);
    const lastSpace = truncated.lastIndexOf(" ");
    const base = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
    return base.trimEnd() + "…";
  };

  if (sentences.length === 0) return fallback();

  const idx = sentences.findIndex(
    (s) => charStart >= s.start && charStart < s.end,
  );
  if (idx < 0) return fallback();

  const startIdx = Math.max(0, idx - 1);
  const endIdx = Math.min(sentences.length - 1, idx + 1);
  const text = sentences
    .slice(startIdx, endIdx + 1)
    .map((s) => s.text)
    .join("")
    .trim();
  if (text.length <= maxChars) return text;

  const budget = Math.max(1, maxChars - 1);
  const truncated = text.slice(0, budget);
  const lastSpace = truncated.lastIndexOf(" ");
  const base = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
  return base.trimEnd() + "…";
}

export type BranchValidationResult =
  | { ok: true }
  | { ok: false; fields: Record<string, string> };

export function validateBranchSelection(args: {
  messageContent: string;
  selectedText: string;
  charStart: number;
  charEnd: number;
  clientHighlightContext?: string;
}): BranchValidationResult {
  const fields: Record<string, string> = {};
  const trimmedSelected = args.selectedText.trim();

  if (trimmedSelected.length === 0) {
    fields.selectedText = "Selection must not be empty";
  } else if (trimmedSelected.length > 2000) {
    fields.selectedText = "Selection too long (max 2000 chars)";
  }

  if (
    !Number.isInteger(args.charStart) ||
    args.charStart < 0
  ) {
    fields.charStart = "charStart must be a non-negative integer";
  }
  if (
    !Number.isInteger(args.charEnd) ||
    args.charEnd <= (Number.isInteger(args.charStart) ? args.charStart : 0)
  ) {
    fields.charEnd = "charEnd must be an integer greater than charStart";
  }

  const inBounds =
    Number.isInteger(args.charStart) &&
    Number.isInteger(args.charEnd) &&
    args.charStart >= 0 &&
    args.charStart < args.charEnd &&
    args.charEnd <= args.messageContent.length;

  if (inBounds && !fields.selectedText) {
    const sliced = args.messageContent.slice(args.charStart, args.charEnd);
    if (sliced.trim() !== trimmedSelected) {
      fields.selectedText =
        "Selected text does not match the slice at the given range";
    }
  } else if (
    Number.isInteger(args.charStart) &&
    Number.isInteger(args.charEnd) &&
    args.charStart >= 0 &&
    args.charEnd > args.messageContent.length
  ) {
    fields.charEnd =
      fields.charEnd ?? "charEnd exceeds the message content length";
  }

  if (
    args.clientHighlightContext !== undefined &&
    args.clientHighlightContext.length > 500
  ) {
    fields.clientHighlightContext =
      "clientHighlightContext too long (max 500 chars)";
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true };
}

export function deriveTitle(content: string): string {
  const words = content.trim().split(/\s+/).filter(Boolean);
  const first6 = words.slice(0, 6).join(" ");
  if (first6.length === 0) return "New chat";
  if (first6.length <= 60) return first6;
  const truncated = first6.slice(0, 59).trimEnd();
  return truncated + "…";
}

export type AncestorFetcher = {
  fetchConvById: (id: string) => Promise<ConversationRow | null>;
  fetchMessagesByConvIds: (ids: string[]) => Promise<MessageRow[]>;
};

/**
 * Walk the ancestor chain root → ... → parent and assemble the model
 * message array. Pure-ish (DB calls via fetcher); testable by passing a
 * fake fetcher.
 *
 * Throws HttpError(404) if the target is missing or not owned by the user.
 * Throws HttpError(503 ANCESTOR_UNAVAILABLE) if any ancestor is missing or
 * foreign-owned.
 *
 * Performance: ancestor conversations are fetched sequentially (one per level)
 * because the parent_id of each ancestor is needed to know the next one.
 * For deep trees, use MAX_ANCESTOR_TOKENS to cap (env var, documented in
 * spec §11 Q6). Messages are fetched in a single batched call.
 */
export async function walkAncestors(args: {
  target: ConversationRow;
  sessionUserId: string;
  fetcher: AncestorFetcher;
  newUserMessage: string;
}): Promise<CoreMessage[]> {
  const { target, sessionUserId, fetcher, newUserMessage } = args;

  if (target.userId !== sessionUserId) {
    throw new HttpError(404, "NOT_FOUND", "Conversation not found");
  }

  const ancestorIds: string[] = [];
  let directParent: ConversationRow | null = null;

  let cursor: ConversationRow | null = null;
  if (target.parentId) {
    cursor = await fetcher.fetchConvById(target.parentId);
    if (!cursor) {
      throw new HttpError(
        503,
        "ANCESTOR_UNAVAILABLE",
        "Ancestor conversation is missing",
      );
    }
    directParent = cursor;
  }

  while (cursor) {
    if (cursor.userId !== sessionUserId) {
      throw new HttpError(
        503,
        "ANCESTOR_UNAVAILABLE",
        "Ancestor conversation is unavailable",
      );
    }
    ancestorIds.unshift(cursor.id);
    if (cursor.parentId) {
      const next = await fetcher.fetchConvById(cursor.parentId);
      if (!next) {
        throw new HttpError(
          503,
          "ANCESTOR_UNAVAILABLE",
          "Ancestor conversation is missing",
        );
      }
      cursor = next;
    } else {
      cursor = null;
    }
  }

  const allConvIds = [...ancestorIds, target.id];
  const allMessages = await fetcher.fetchMessagesByConvIds(allConvIds);

  const messagesByConv = new Map<string, MessageRow[]>();
  for (const m of allMessages) {
    const list = messagesByConv.get(m.conversationId) ?? [];
    list.push(m);
    messagesByConv.set(m.conversationId, list);
  }
  for (const list of messagesByConv.values()) {
    list.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  const flat: CoreMessage[] = [];
  for (const convId of allConvIds) {
    const convMsgs = messagesByConv.get(convId) ?? [];
    for (const m of convMsgs) {
      flat.push({ role: m.role, content: m.content });
    }
  }

  const systemNote = buildSubChatSystemNote({
    parentTitle: directParent?.title ?? null,
    highlightText: target.highlightText,
  });

  flat.push({ role: "user", content: newUserMessage });
  return [{ role: "system", content: systemNote }, ...flat];
}

export async function buildModelContext(input: {
  targetConversationId: string;
  newUserMessage: string;
  sessionUserId: string;
}): Promise<CoreMessage[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, input.targetConversationId))
    .limit(1);
  const target = rows[0] as ConversationRow | undefined;
  if (!target) {
    throw new HttpError(404, "NOT_FOUND", "Conversation not found");
  }

  return walkAncestors({
    target,
    sessionUserId: input.sessionUserId,
    fetcher: {
      fetchConvById: async (id) => {
        const r = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, id))
          .limit(1);
        return (r[0] as ConversationRow | undefined) ?? null;
      },
      fetchMessagesByConvIds: async (ids) => {
        if (ids.length === 0) return [];
        const r = await db
          .select()
          .from(messages)
          .where(inArray(messages.conversationId, ids))
          .orderBy(asc(messages.createdAt));
        return r.map((m) => ({
          id: m.id,
          conversationId: m.conversationId,
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
          createdAt: m.createdAt,
        }));
      },
    },
    newUserMessage: input.newUserMessage,
  });
}

// ---------- streaming ----------

export async function streamChatResponse(
  input: StreamChatInput,
): Promise<StreamChatResult> {
  const {
    conversationId,
    userId,
    userMessage,
    depth = 0,
  } = input;

  const owned = await assertOwnership(conversationId, userId);
  if (!owned) {
    return {
      ok: false,
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "Conversation not found" } },
    };
  }

  let provider: Awaited<ReturnType<typeof getActiveProviderFor>>;
  try {
    provider = await getActiveProviderFor(userId);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      log.warn(
        { err, conversationId, userId },
        "provider blocked by SSRF guard at send time",
      );
      return {
        ok: false,
        status: 502,
        body: {
          error: {
            code: "PROVIDER_FAILED",
            message: "Provider endpoint blocked — update it in provider settings",
          },
        },
      };
    }
    throw err;
  }
  if (!provider) {
    return {
      ok: false,
      status: 503,
      body: {
        error: {
          code: "NO_PROVIDER",
          message: "No AI provider configured",
        },
      },
    };
  }

  const existing = inFlight.get(conversationId);
  if (existing) {
    log.info({ conversationId }, "aborting previous in-flight stream");
    existing.abort();
    await new Promise((r) => setTimeout(r, ABORT_GRACE_MS));
  }

  const controller = new AbortController();
  const timedOut = setTimeout(() => {
    controller.abort(new Error("per-token timeout"));
  }, PARTIAL_PERSIST_TIMEOUT_MS);

  inFlight.set(conversationId, controller);

  const userMsgId = crypto.randomUUID();
  const assistantMsgId = crypto.randomUUID();
  let assistantSaved = false;

  const releaseLock = () => {
    clearTimeout(timedOut);
    if (inFlight.get(conversationId) === controller) {
      inFlight.delete(conversationId);
    }
  };

  const persistAssistant = async (content: string): Promise<void> => {
    if (assistantSaved) return;
    if (!content || content.length === 0) return;
    assistantSaved = true;
    try {
      await db.insert(messages).values({
        id: assistantMsgId,
        conversationId,
        role: "assistant",
        content,
        model: provider.modelId,
        providerId: provider.id,
        createdAt: new Date(),
      });
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    } catch (err) {
      log.error(
        { err, conversationId, assistantMsgId },
        "failed to persist assistant message",
      );
    }
  };

  try {
    await db.insert(messages).values({
      id: userMsgId,
      conversationId,
      role: "user",
      content: userMessage,
      createdAt: new Date(),
    });
  } catch (err) {
    log.error({ err, conversationId, userMsgId }, "failed to persist user message");
    releaseLock();
    return {
      ok: false,
      status: 500,
      body: {
        error: { code: "PROVIDER_FAILED", message: "DB write failed" },
      },
    };
  }

  let modelMessages: CoreMessage[];
  if (depth >= 1) {
    try {
      modelMessages = await buildModelContext({
        targetConversationId: conversationId,
        newUserMessage: userMessage,
        sessionUserId: userId,
      });
    } catch (err) {
      releaseLock();
      if (err instanceof HttpError) {
        log.warn(
          {
            code: err.code,
            status: err.status,
            conversationId,
          },
          "ancestor walk failed",
        );
        return {
          ok: false,
          status: err.status,
          body: { error: { code: err.code, message: err.message } },
        };
      }
      log.error({ err, conversationId }, "ancestor walk threw");
      return {
        ok: false,
        status: 500,
        body: {
          error: {
            code: "PROVIDER_FAILED",
            message: "Ancestor walk failed",
          },
        },
      };
    }
  } else {
    try {
      const history = await loadHistory(conversationId);
      modelMessages = [
        ...history,
        { role: "user", content: userMessage },
      ];
    } catch (err) {
      log.error({ err, conversationId }, "failed to load message history");
      releaseLock();
      return {
        ok: false,
        status: 500,
        body: {
          error: { code: "PROVIDER_FAILED", message: "DB read failed" },
        },
      };
    }
  }

  let accumulated = "";

  try {
    const result = streamText({
      model: provider.model,
      messages: modelMessages,
      abortSignal: controller.signal,
      system:
        "You are a helpful assistant. Answer concisely and accurately. " +
        "Preserve markdown formatting where useful.",
      onChunk({ chunk }) {
        if (
          chunk.type === "text-delta" &&
          typeof chunk.textDelta === "string"
        ) {
          accumulated += chunk.textDelta;
        }
      },
      async onFinish({ text }) {
        await persistAssistant(text);
      },
    });

    controller.signal.addEventListener("abort", () => {
      void persistAssistant(accumulated);
    });

    const response = result.toDataStreamResponse();
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Accel-Buffering", "no");
    return { ok: true, response };
  } catch (err) {
    log.error(
      { err, conversationId, accumulatedLength: accumulated.length },
      "streamText setup failed",
    );
    await persistAssistant(accumulated);
    return {
      ok: false,
      status: 502,
      body: {
        error: {
          code: "PROVIDER_FAILED",
          message: "AI provider error — try again",
        },
      },
    };
  } finally {
    releaseLock();
  }
}

export function _internalInFlightMap(): Map<string, AbortController> {
  return inFlight;
}
