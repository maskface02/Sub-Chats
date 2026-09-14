import { type NextRequest } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { checkMessagesRateLimit, checkMutationRateLimit } from "@/lib/auth/rate-limit";
import { jsonError, type ErrorCode } from "@/lib/types/api";
import { isStreamActive, streamChatResponse } from "@/lib/ai/stream";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/chats/:id/messages/:messageId/regenerate — US-408
// Deletes the LAST assistant message and re-streams over the same history.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; messageId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;
  const { id, messageId } = await ctx.params;

  const rl = checkMutationRateLimit(userId);
  if (!rl.allowed) {
    const res = jsonError(429, "RATE_LIMITED", "Too many actions — try again later");
    res.headers.set("Retry-After", Math.ceil(rl.retryAfterMs / 1000).toString());
    res.headers.set("X-RateLimit-Limit", "30");
    res.headers.set("X-RateLimit-Remaining", "0");
    res.headers.set(
      "X-RateLimit-Reset",
      new Date(Date.now() + rl.retryAfterMs).toISOString(),
    );
    return res;
  }

  const sendRl = checkMessagesRateLimit(userId);
  if (!sendRl.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many messages. Try again later.");
  }

  const convRows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.userId, userId),
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);
  if (convRows.length === 0) {
    return jsonError(404, "NOT_FOUND", "Conversation not found");
  }
  const conv = convRows[0]!;

  const msgRows = await db
    .select()
    .from(messages)
    .where(
      and(eq(messages.id, messageId), eq(messages.conversationId, conv.id)),
    )
    .limit(1);
  if (msgRows.length === 0) {
    return jsonError(404, "NOT_FOUND", "Message not found");
  }
  const target = msgRows[0]!;

  if (target.role !== "assistant") {
    return jsonError(
      422,
      "NOT_REGENERABLE",
      "Only the latest response can be regenerated",
    );
  }

  const lastRows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(eq(messages.conversationId, conv.id), eq(messages.role, "assistant")),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1);
  if (lastRows.length === 0 || lastRows[0]!.id !== target.id) {
    return jsonError(
      422,
      "NOT_REGENERABLE",
      "Only the latest response can be regenerated",
    );
  }

  if (isStreamActive(conv.id)) {
    return jsonError(409, "STREAM_ACTIVE", "Stop the current response first");
  }

  try {
    await db.transaction(async (tx) => {
      await tx.delete(messages).where(eq(messages.id, target.id));
    });
  } catch (err) {
    log.error({ err, conversationId: conv.id, messageId }, "regenerate delete failed");
    return jsonError(500, "INTERNAL", "Could not delete message");
  }

  const result = await streamChatResponse({
    conversationId: conv.id,
    userId,
    // Not persisted (skipUserPersist); the surviving history ends with the
    // previous user message, which becomes the final model turn.
    userMessage: "",
    depth: conv.depth,
    skipUserPersist: true,
  });

  if (result.ok) {
    return result.response;
  }
  const errorBody = result.body as {
    error: { code: ErrorCode; message?: string };
  };
  const status =
    result.status === 404 || result.status === 502 || result.status === 503
      ? result.status
      : 500;
  return jsonError(status, errorBody.error.code, errorBody.error.message);
}
