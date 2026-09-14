import { type NextRequest } from "next/server";
import { and, desc, eq, lt, isNull, sql, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import type { Session } from "next-auth";
import { withRequestLogging } from "@/lib/obs/request-logging";
import {
  ChatListQuerySchema,
  jsonError,
  jsonRaw,
  type ChatListItem,
} from "@/lib/types/api";
import { log } from "@/lib/log";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;

async function listChats(
  req: NextRequest,
  _ctx: unknown,
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;

  const url = new URL(req.url);
  const parsed = ChatListQuerySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? DEFAULT_LIMIT,
  });
  if (!parsed.success) {
    return jsonError(422, "INVALID_INPUT");
  }
  const { cursor, limit } = parsed.data;

  const cursorDate = cursor ? new Date(cursor) : null;

  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      updatedAt: conversations.updatedAt,
      preview: messages.content,
      childrenCount: sql<number>`(
        SELECT COUNT(*)::int FROM conversations c2
        WHERE c2.parent_id = ${conversations.id}
          AND c2.deleted_at IS NULL
      )`,
    })
    .from(conversations)
    .leftJoin(
      messages,
      and(
        eq(messages.conversationId, conversations.id),
        eq(messages.role, "user"),
      ),
    )
    .where(
      and(
        eq(conversations.userId, userId),
        isNull(conversations.parentId),
        // Soft-deleted conversations never appear in the list (US-401 AC.5).
        isNull(conversations.deletedAt),
        cursorDate ? lt(conversations.updatedAt, cursorDate) : undefined,
      ),
    )
    .orderBy(desc(conversations.updatedAt), asc(messages.createdAt))
    .limit(limit + 1);

  // collapse to one row per conversation (first user message as preview)
  const byId = new Map<string, ChatListItem>();
  for (const r of rows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, {
        id: r.id,
        title: r.title,
        updatedAt: r.updatedAt.toISOString(),
        preview: r.preview ? r.preview.slice(0, 120) : null,
        childrenCount: Number(r.childrenCount ?? 0),
      });
    }
  }
  const items = Array.from(byId.values()).slice(0, limit);
  const nextCursor =
    items.length === limit && rows.length > limit
      ? items[items.length - 1]!.updatedAt
      : null;

  return jsonRaw({ items, nextCursor }, 200);
}

export const GET = withRequestLogging(listChats);

async function createChat(
  _req: NextRequest,
  _ctx: unknown,
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;

  const id = crypto.randomUUID();
  const now = new Date();

  try {
    await db.insert(conversations).values({
      id,
      userId,
      title: "New chat",
      parentId: null,
      rootConversationId: id,
      depth: 0,
      highlightText: null,
      highlightContext: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    log.error({ err, userId }, "failed to create conversation");
    return jsonError(500, "PROVIDER_FAILED", "Could not create chat");
  }

  return jsonRaw(
    {
      id,
      title: "New chat",
      parentId: null,
      rootConversationId: id,
      depth: 0,
      createdAt: now.toISOString(),
    },
    201,
  );
}

export const POST = withRequestLogging(createChat);