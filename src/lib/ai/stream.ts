import "server-only";
import { streamText, type CoreMessage } from "ai";
import { eq, asc, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { getActiveProvider } from "./provider";
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
};

export type StreamChatResult =
  | { ok: true; response: Response }
  | { ok: false; status: number; body: unknown };

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

export async function streamChatResponse(
  input: StreamChatInput,
): Promise<StreamChatResult> {
  const { conversationId, userId, userMessage } = input;

  const owned = await assertOwnership(conversationId, userId);
  if (!owned) {
    return {
      ok: false,
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "Conversation not found" } },
    };
  }

  const provider = await getActiveProvider();
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

  let history: CoreMessage[];
  try {
    history = await loadHistory(conversationId);
  } catch (err) {
    log.error({ err, conversationId }, "failed to load message history");
    clearTimeout(timedOut);
    if (inFlight.get(conversationId) === controller) {
      inFlight.delete(conversationId);
    }
    return {
      ok: false,
      status: 500,
      body: {
        error: { code: "PROVIDER_FAILED", message: "DB read failed" },
      },
    };
  }

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
    clearTimeout(timedOut);
    if (inFlight.get(conversationId) === controller) {
      inFlight.delete(conversationId);
    }
    return {
      ok: false,
      status: 500,
      body: {
        error: { code: "PROVIDER_FAILED", message: "DB write failed" },
      },
    };
  }

  const allMessages: CoreMessage[] = [
    ...history,
    { role: "user", content: userMessage },
  ];

  let accumulated = "";

  try {
    const result = streamText({
      model: provider.model,
      messages: allMessages,
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
    clearTimeout(timedOut);
    if (inFlight.get(conversationId) === controller) {
      inFlight.delete(conversationId);
    }
  }
}

export function _internalInFlightMap(): Map<string, AbortController> {
  return inFlight;
}