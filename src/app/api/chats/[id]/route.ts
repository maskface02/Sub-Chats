import { type NextRequest } from "next/server";
import { and, eq, asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { jsonError, jsonRaw } from "@/lib/types/api";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

  const convRows = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, id), eq(conversations.userId, userId)),
    )
    .limit(1);

  if (convRows.length === 0) {
    // 404 not 403 — spec AC-P0-7 + US-007 AC.3 — avoid ID enumeration
    return jsonError(404, "NOT_FOUND", "Conversation not found");
  }
  const conv = convRows[0]!;

  const msgRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  // Resolve parent + root titles + full ancestor chain in batched queries
  // (additive fields). Foreign-owned ancestors resolve to null entries
  // (no existence leak; UI renders "Private").
  const lookupIds = Array.from(
    new Set(
      [conv.parentId, conv.rootConversationId].filter(
        (x): x is string => Boolean(x) && x !== conv.id,
      ),
    ),
  );

  const titleLookup = new Map<string, string>();
  if (lookupIds.length > 0) {
    const titleRows = await db
      .select({ id: conversations.id, title: conversations.title })
      .from(conversations)
      .where(
        and(
          inArray(conversations.id, lookupIds),
          eq(conversations.userId, userId),
        ),
      );
    for (const r of titleRows) titleLookup.set(r.id, r.title);
  }

  const parentTitle = conv.parentId
    ? titleLookup.get(conv.parentId) ?? null
    : null;
  const rootTitle =
    conv.rootConversationId && conv.rootConversationId !== conv.id
      ? titleLookup.get(conv.rootConversationId) ?? null
      : null;

  // Full ancestor chain for the breadcrumb. Walk the parent chain client-side
  // by collecting ids (one cheap SELECT per level is unavoidable without a
  // recursive CTE; for a 5-deep tree this is still 5 quick PK lookups).
  const ancestorIds: string[] = [];
  let cursorId: string | null = conv.parentId;
  while (cursorId && cursorId !== conv.id) {
    ancestorIds.push(cursorId);
    const row = await db
      .select({ id: conversations.id, parentId: conversations.parentId })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, cursorId),
          eq(conversations.userId, userId),
        ),
      )
      .limit(1);
    if (row.length === 0) break;
    cursorId = row[0]!.parentId;
  }

  const ancestorTitles = ancestorIds.map((aid, i) => ({
    id: aid,
    title: titleLookup.get(aid) ?? null,
    depth: Math.max(0, conv.depth - 1 - i),
  }));

  return jsonRaw(
    {
      id: conv.id,
      title: conv.title,
      parentId: conv.parentId,
      rootConversationId: conv.rootConversationId,
      depth: conv.depth,
      parentTitle,
      rootTitle,
      highlightText: conv.highlightText,
      highlightContext: conv.highlightContext,
      ancestorTitles,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      messages: msgRows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model ?? null,
        providerId: m.providerId ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
    },
    200,
  );
}
