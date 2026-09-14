import { type NextRequest } from "next/server";
import { and, eq, asc, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { jsonError, jsonRaw, type TreeNodeDto } from "@/lib/types/api";

export const runtime = "nodejs";

const NODE_CAP = 500;

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
      and(
        eq(conversations.id, id),
        eq(conversations.userId, userId),
        // Soft-deleted ids behave exactly like missing ids (US-401 AC.5).
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);

  if (convRows.length === 0) {
    // 404 not 403 — no ID enumeration (US-207 AC.1, identical for missing/foreign)
    return jsonError(404, "NOT_FOUND", "Conversation not found");
  }
  const conv = convRows[0]!;

  // Resolve the root of this conversation's tree; if the root row is
  // foreign-owned (data inconsistency), treat as not found — the subtree
  // query below would return nothing anyway.
  const rootId = conv.rootConversationId || conv.id;
  if (rootId !== conv.id) {
    const rootRows = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, rootId),
          eq(conversations.userId, userId),
          // A soft-deleted ROOT makes all descendants 404 (they were
          // soft-deleted as one batch — spec §5 note).
          isNull(conversations.deletedAt),
        ),
      )
      .limit(1);
    if (rootRows.length === 0) {
      return jsonError(404, "NOT_FOUND", "Conversation not found");
    }
  }

  // Single indexed query for the whole subtree (rootConversationId index).
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      depth: conversations.depth,
      parentId: conversations.parentId,
      highlightText: conversations.highlightText,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.rootConversationId, rootId),
        eq(conversations.userId, userId),
        // Deleted subtree members are hidden from the tree.
        isNull(conversations.deletedAt),
      ),
    )
    .orderBy(asc(conversations.createdAt));

  const nodeMap = new Map<string, TreeNodeDto>();
  for (const r of rows) {
    nodeMap.set(r.id, {
      id: r.id,
      title: r.title,
      depth: r.depth,
      highlightText: r.highlightText,
      createdAt: r.createdAt.toISOString(),
      children: [],
    });
  }

  const rootNode = nodeMap.get(rootId);
  if (!rootNode) {
    return jsonError(404, "NOT_FOUND", "Conversation not found");
  }

  // Attach children (rows are createdAt ASC, so each children list inherits
  // that order). Rows whose parent is missing from the map (inconsistent data)
  // are skipped — they can never appear without their parent link (US-201 AC.4).
  for (const r of rows) {
    if (r.id === rootId) continue;
    const node = nodeMap.get(r.id)!;
    const parentNode = r.parentId ? nodeMap.get(r.parentId) : undefined;
    if (parentNode) parentNode.children.push(node);
  }

  // DFS pre-order with cap; totalNodes is the FULL pre-truncation count (OQ-4).
  const totalNodes = rows.length;
  const truncated = totalNodes > NODE_CAP;

  const preOrder: TreeNodeDto[] = [];
  const visit = (node: TreeNodeDto) => {
    if (preOrder.length >= NODE_CAP) return;
    preOrder.push(node);
    for (const child of node.children) visit(child);
  };
  visit(rootNode);

  // When truncated, strip omitted nodes from their parents' children arrays so
  // no partial subtree is emitted without its parent link (US-201 AC.4).
  if (truncated) {
    const keepIds = new Set(preOrder.map((n) => n.id));
    const strip = (node: TreeNodeDto) => {
      node.children = node.children.filter((c) => keepIds.has(c.id));
      for (const c of node.children) strip(c);
    };
    strip(rootNode);
  }

  return jsonRaw(
    {
      root: rootNode,
      currentId: id,
      totalNodes,
      truncated,
    },
    200,
  );
}
