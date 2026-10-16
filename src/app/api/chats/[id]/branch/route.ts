import { type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import type { Session } from "next-auth";
import { withRequestLogging } from "@/lib/obs/request-logging";
import { checkBranchRateLimit } from "@/lib/auth/rate-limit";
import {
  BranchRequestSchema,
  jsonError,
  jsonRaw,
  type BranchResponse,
} from "@/lib/types/api";
import {
  extractSentenceContext,
  validateBranchSelection,
} from "@/lib/ai/stream";
import { log } from "@/lib/log";

export const runtime = "nodejs";

async function branchChat(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

  const rl = checkBranchRateLimit(userId);
  if (!rl.allowed) {
    const minutes = Math.max(1, Math.ceil(rl.retryAfterMs / 60_000));
    const res = jsonError(
      429,
      "RATE_LIMITED",
      `Too many sub-chats — try again in ${minutes} minute${minutes === 1 ? "" : "s"}`,
    );
    res.headers.set("Retry-After", Math.ceil(rl.retryAfterMs / 1000).toString());
    res.headers.set("X-RateLimit-Limit", "30");
    res.headers.set("X-RateLimit-Remaining", "0");
    res.headers.set("X-RateLimit-Reset", new Date(Date.now() + rl.retryAfterMs).toISOString());
    return res;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(422, "INVALID_SELECTION", "Invalid JSON body");
  }

  const parsed = BranchRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? "_";
      if (!(key in fields)) fields[key] = issue.message;
    }
    return jsonError(422, "INVALID_SELECTION", undefined, fields);
  }
  const { messageId, selectedText, charStart, charEnd, clientHighlightContext } =
    parsed.data;

  const convRows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.userId, userId),
        // Branching a deleted conversation → 404 (US-401 AC.5): otherwise the
        // new sub-chat would point parentId at a soft-deleted row.
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);
  if (convRows.length === 0) {
    return jsonError(404, "NOT_FOUND", "Conversation not found");
  }
  const source = convRows[0]!;

  const msgRows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.conversationId, source.id),
      ),
    )
    .limit(1);
  if (msgRows.length === 0 || msgRows[0]!.role !== "assistant") {
    return jsonError(404, "NOT_FOUND", "Source message not found");
  }
  const sourceMessage = msgRows[0]!;

  const validation = validateBranchSelection({
    messageContent: sourceMessage.content,
    selectedText,
    charStart,
    charEnd,
    clientHighlightContext,
  });
  if (!validation.ok) {
    return jsonError(422, "INVALID_SELECTION", undefined, validation.fields);
  }

  const highlightContext =
    clientHighlightContext !== undefined &&
    clientHighlightContext.length > 0 &&
    clientHighlightContext.length <= 500
      ? clientHighlightContext
      : extractSentenceContext(
          sourceMessage.content,
          charStart,
          charEnd,
          500,
        );

  const newId = crypto.randomUUID();
  const now = new Date();
  try {
    await db.insert(conversations).values({
      id: newId,
      userId,
      title: "New chat",
      parentId: source.id,
      rootConversationId: source.rootConversationId,
      depth: source.depth + 1,
      highlightText: selectedText,
      sourceMessageId: messageId,
      sourceStart: charStart,
      sourceEnd: charEnd,
      highlightContext,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    log.error(
      { err, userId, sourceId: source.id },
      "failed to insert sub-chat",
    );
    return jsonError(500, "INTERNAL", "Could not create sub-chat");
  }

  const response: BranchResponse = {
    id: newId,
    parentId: source.id,
    rootConversationId: source.rootConversationId,
    depth: source.depth + 1,
    highlightText: selectedText,
    highlightContext,
    title: "New chat",
    createdAt: now.toISOString(),
  };
  return jsonRaw(response, 201);
}

export const POST = withRequestLogging(branchChat);
