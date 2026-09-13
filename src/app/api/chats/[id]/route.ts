import { type NextRequest } from "next/server";
import { and, eq, asc } from "drizzle-orm";
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

  return jsonRaw(
    {
      id: conv.id,
      title: conv.title,
      parentId: conv.parentId,
      rootConversationId: conv.rootConversationId,
      depth: conv.depth,
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