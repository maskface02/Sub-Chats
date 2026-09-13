import { type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { jsonError, SendMessageRequestSchema, type ErrorCode } from "@/lib/types/api";
import { streamChatResponse } from "@/lib/ai/stream";
import { checkMessagesRateLimit } from "@/lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
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

  const result = await streamChatResponse({
    conversationId: id,
    userId,
    userMessage: parsed.data.content,
    clientMessageId: parsed.data.clientMessageId,
  });

  if (result.ok) {
    return result.response;
  }

  const errorBody = result.body as {
    error: { code: ErrorCode; message?: string };
  };
  const status = (result.status === 404 || result.status === 502 || result.status === 503)
    ? result.status
    : 500;
  return jsonError(status, errorBody.error.code, errorBody.error.message);
}