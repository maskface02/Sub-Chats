/**
 * Hand-off store for the sub-chat question dialog (post-ship UX change):
 * the user types their question BEFORE the sub-chat is created; on Enter
 * the sub-chat is created, the question is stashed here under the new
 * conversation id, and the router navigates. ChatView picks it up on mount
 * (take = get + clear) and auto-sends it through the normal streaming path,
 * so the sub-chat opens with the question already prompted — with full
 * parent context via the server-side ancestor walk.
 *
 * Module-level map (same pattern as src/lib/state/split.ts): client-state
 * only, survives client-side navigation, dies on full reload (acceptable —
 * the question is sent immediately after navigation).
 */

const pending = new Map<string, string>();

export function setPendingQuestion(conversationId: string, question: string): void {
  pending.set(conversationId, question);
}

/** Get-and-clear: only the first ChatView mount after creation consumes it. */
export function takePendingQuestion(conversationId: string): string | null {
  const q = pending.get(conversationId);
  if (q !== undefined) pending.delete(conversationId);
  return q ?? null;
}
