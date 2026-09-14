import { type NextRequest } from "next/server";
import { and, eq, asc, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import type { Session } from "next-auth";
import { withRequestLogging } from "@/lib/obs/request-logging";
import { checkMutationRateLimit } from "@/lib/auth/rate-limit";
import { jsonError, jsonRaw } from "@/lib/types/api";
import { isStreamActive } from "@/lib/ai/stream";
import { log } from "@/lib/log";

export const runtime = "nodejs";

/** Collect the live subtree rooted at targetId (target + live descendants). */
export function collectLiveSubtreeIds(
  rows: Array<{ id: string; parentId: string | null; deletedAt: Date | null }>,
  targetId: string,
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (r.deletedAt !== null || !r.parentId) continue;
    const list = childrenOf.get(r.parentId) ?? [];
    list.push(r.id);
    childrenOf.set(r.parentId, list);
  }
  const ids: string[] = [];
  if (rows.some((r) => r.id === targetId && r.deletedAt === null)) {
    ids.push(targetId);
  }
  const stack = [targetId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const child of childrenOf.get(cur) ?? []) {
      ids.push(child);
      stack.push(child);
    }
  }
  return ids;
}

async function getChat(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

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
          isNull(conversations.deletedAt),
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
          isNull(conversations.deletedAt),
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

export const GET = withRequestLogging(getChat);

// ---------- delete / restore (phase 4 US-401) ----------

async function deleteChat(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

  const rl = checkMutationRateLimit(userId);
  if (!rl.allowed) {
    const minutes = Math.max(1, Math.ceil(rl.retryAfterMs / 60_000));
    const res = jsonError(
      429,
      "RATE_LIMITED",
      `Too many actions — try again in ${minutes} minute${minutes === 1 ? "" : "s"}`,
    );
    res.headers.set(
      "Retry-After",
      Math.ceil(rl.retryAfterMs / 1000).toString(),
    );
    res.headers.set("X-RateLimit-Limit", "30");
    res.headers.set("X-RateLimit-Remaining", "0");
    res.headers.set(
      "X-RateLimit-Reset",
      new Date(Date.now() + rl.retryAfterMs).toISOString(),
    );
    return res;
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
    // Byte-identical 404 for missing, foreign, AND soft-deleted ids.
    return jsonError(404, "NOT_FOUND", "Conversation not found");
  }
  const target = convRows[0]!;

  // Scope the subtree to this tree; only LIVE conversations join the cascade
  // (live-only filter at collection time — separately deleted descendants keep
  // their original batch, see nested-delete batch integrity).
  const treeRows = await db
    .select({
      id: conversations.id,
      parentId: conversations.parentId,
      deletedAt: conversations.deletedAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        eq(conversations.rootConversationId, target.rootConversationId),
      ),
    );

  const subtreeIds = collectLiveSubtreeIds(treeRows, target.id);

  // 409 if the target OR any live descendant is streaming (cascade would move
  // messages out from under a live stream).
  if (subtreeIds.some((cid) => isStreamActive(cid))) {
    return jsonError(
      409,
      "STREAM_ACTIVE",
      "Stop the current response before deleting",
    );
  }

  const batchId = crypto.randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(conversations)
        .set({ deletedAt: new Date(), deletedBatchId: batchId })
        .where(
          and(
            inArray(conversations.id, subtreeIds),
            eq(conversations.userId, userId),
            // Live-only: never overwrite another batch's deletedBatchId.
            isNull(conversations.deletedAt),
          ),
        );
    });
  } catch (err) {
    log.error({ err, userId, rootId: target.rootConversationId }, "delete transaction failed");
    // Basket rolled back, nothing soft-deleted. Keep the bucket —
    // a failed delete is still a rate-bounded user action.
    return jsonError(500, "INTERNAL", "Could not delete conversation");
  }

  return jsonRaw(
    { deletedIds: subtreeIds, deletedCount: subtreeIds.length, batchId },
    200,
  );
}

export const DELETE = withRequestLogging(deleteChat);

async function restoreChat(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

  const rl = checkMutationRateLimit(userId);
  if (!rl.allowed) {
    return jsonError(429, "RATE_LIMITED", "Too many actions — try again later");
  }

  const convRows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  if (convRows.length === 0) {
    return jsonError(404, "NOT_FOUND", "Conversation not found");
  }
  const target = convRows[0]!;

  if (target.deletedAt === null) {
    return jsonRaw({ restoredCount: 0 }, 200);
  }

  // Restore replays the target row's OWN batch (Reviewer fix, OQ-5): only
  // rows soft-deleted by the same logical delete come back.
  try {
    const results = await db
      .update(conversations)
      .set({ deletedAt: null, deletedBatchId: null })
      .where(
        and(
          eq(conversations.deletedBatchId, target.deletedBatchId!),
          eq(conversations.userId, userId),
        ),
      )
      .returning({ id: conversations.id });
    return jsonRaw({ restoredCount: results.length }, 200);
  } catch (err) {
    log.error({ err, userId, id }, "restore failed");
    return jsonError(500, "INTERNAL", "Could not restore conversation");
  }
}

export const POST = withRequestLogging(restoreChat);
