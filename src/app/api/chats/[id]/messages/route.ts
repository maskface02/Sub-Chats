import { type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import type { Session } from "next-auth";
import {
  jsonError,
  SendMessageRequestSchema,
  type ErrorCode,
} from "@/lib/types/api";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { deriveTitle, streamChatResponse } from "@/lib/ai/stream";
import { checkMessagesRateLimit } from "@/lib/auth/rate-limit";
import { withRequestLogging } from "@/lib/obs/request-logging";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function sendMessage(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

  const rl = checkMessagesRateLimit(userId);
  if (!rl.allowed) {
    const seconds = Math.ceil(rl.retryAfterMs / 1000);
    return jsonError(
      429,
      "RATE_LIMITED",
      `Too many messages. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(422, "INVALID_INPUT");
  }

  const parsed = SendMessageRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? "_";
      if (!(key in fields)) fields[key] = issue.message;
    }
    return jsonError(422, "INVALID_INPUT", undefined, fields);
  }

  // Resolve the target conversation + ownership (404 on cross-user).
  const convRows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.userId, userId),
        // Soft-deleted ids behave exactly like missing ids (US-401 AC.5).
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);
  if (convRows.length === 0) {
    return jsonError(404, "NOT_FOUND", "Conversation not found");
  }
  const conv = convRows[0]!;

  // Title auto-derive on the first user message of a conversation whose
  // title is still the placeholder. Triggered immediately (no AI latency).
  if (conv.title === "New chat") {
    const derivedTitle = deriveTitle(parsed.data.content);
    if (derivedTitle !== "New chat") {
      try {
        await db
          .update(conversations)
          .set({ title: derivedTitle })
          .where(eq(conversations.id, conv.id));
      } catch (err) {
        log.error(
          { err, conversationId: conv.id },
          "failed to auto-derive title",
        );
        // non-fatal — stream still proceeds with placeholder
      }
    }
  }

  const result = await streamChatResponse({
    conversationId: id,
    userId,
    userMessage: parsed.data.content,
    clientMessageId: parsed.data.clientMessageId,
    depth: conv.depth,
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

export const POST = withRequestLogging(sendMessage);
