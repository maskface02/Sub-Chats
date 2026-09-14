// POST /api/chats/:id/restore (US-401 AC.7) — the restore handler lives in the
// parent route module (also reachable as POST /api/chats/:id); re-exported
// here for the spec'd restore URL.
export { POST } from "../route";

export const runtime = "nodejs";
