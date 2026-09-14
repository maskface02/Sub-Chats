import { type NextRequest } from "next/server";
import { and, eq, gt, or, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import type { Session } from "next-auth";
import { checkMessagesRateLimit, checkMutationRateLimit } from "@/lib/auth/rate-limit";
import {
  EditMessageRequestSchema,
  jsonError,
  type ErrorCode,
} from "@/lib/types/api";
import { isStreamActive, streamChatResponse } from "@/lib/ai/stream";
import { withRequestLogging } from "@/lib/obs/request-logging";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/chats/:id/messages/:messageId/edit — US-407
// Transactional truncate-at-message + re-stream over the phase-0 SSE protocol.
async function editMessage(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; messageId: string }> },
  session: Session | null,
) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(422, "INVALID_INPUT");
  }
  const parsed = EditMessageRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? "_";
      if (!(key in fields)) fields[key] = issue.message;
    }
    return jsonError(422, "INVALID_INPUT", undefined, fields);
  }

  // Edit also draws the LLM send bucket (rate-limit parity with US-407 AC.6).
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

  if (target.role !== "user") {
    return jsonError(
      422,
      "NOT_EDITABLE",
      "Only your own messages can be edited",
    );
  }

  // 409 — destructive truncation must not race an in-flight stream (§8.6).
  if (isStreamActive(conv.id)) {
    return jsonError(409, "STREAM_ACTIVE", "Stop the current response first");
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({ content: parsed.data.content })
        .where(eq(messages.id, target.id));
      await tx.delete(messages).where(
        and(
          eq(messages.conversationId, conv.id),
          // Strictly-after truncation; same-timestamp rows tie-broken by id
          // order (messages with id > target.id that share createdAt are
          // treated as after it — target row never matches).
          or(
            gt(messages.createdAt, target.createdAt),
            and(
              eq(messages.createdAt, target.createdAt),
              gt(messages.id, target.id),
            ),
          ),
        ),
      );
    });
  } catch (err) {
    log.error({ err, conversationId: conv.id, messageId }, "edit truncate failed");
    return jsonError(500, "INTERNAL", "Could not update message");
  }

  const result = await streamChatResponse({
    conversationId: conv.id,
    userId,
    userMessage: parsed.data.content,
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

export const POST = withRequestLogging(editMessage);
