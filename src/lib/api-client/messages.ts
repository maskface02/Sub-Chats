import { ApiError } from "./base";
import type { ApiErrorBody } from "./types";

async function assertOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  let code = "HTTP_ERROR";
  let message: string | undefined;
  let fields: Record<string, string> | undefined;
  try {
    const body = (await res.json()) as ApiErrorBody | null;
    if (body && typeof body === "object" && "error" in body) {
      code = body.error.code;
      message = body.error.message;
      fields = body.error.fields;
    }
  } catch {
    // non-JSON error body — fall through with status defaults
  }
  throw new ApiError(res.status, { error: { code, message, fields } });
}

/**
 * Edit-in-place: truncates the conversation after the target message and
 * re-streams a new assistant response (US-407). The 200 response body is an
 * SSE stream; the caller consumes it with the shared stream machinery.
 */
export async function editMessage(
  conversationId: string,
  messageId: string,
  content: string,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(
    `/api/chats/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/edit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
      signal,
    },
  );
  return assertOk(res);
}

/**
 * Regenerates the last assistant message: the target row is deleted and a
 * fresh response is streamed with the same preceding history (US-408).
 * The 200 response body is an SSE stream.
 */
export async function regenerateMessage(
  conversationId: string,
  messageId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetch(
    `/api/chats/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/regenerate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal,
    },
  );
  return assertOk(res);
}
