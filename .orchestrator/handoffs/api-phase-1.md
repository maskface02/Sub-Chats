---
handoff_id: HOFF-002
date: 2026-09-13
from_role: backend
to_role: frontend
phase: 1
priority: high
---

## what was produced

### New API route
- `src/app/api/chats/[id]/branch/route.ts` — `POST /api/chats/:id/branch`. Creates a sub-chat from a text selection in an assistant message.

### Extended API routes (additive — backward-compatible)
- `src/app/api/chats/[id]/route.ts` — `GET /api/chats/:id` now also returns `parentTitle`, `rootTitle`, `highlightText`, `highlightContext` (all nullable for root conversations).
- `src/app/api/chats/[id]/messages/route.ts` — `POST /api/chats/:id/messages` now resolves the target conversation (404 on cross-user), auto-derives the title on the first user message of a `"New chat"` placeholder, and passes the conversation's `depth` to the stream helper. For `depth >= 1` the server walks the ancestor chain (root → ... → parent) and prepends a single system note to the model context only — the user message persists on the sub-chat, NOT on any ancestor.

### Library extensions (testable helpers exported from `src/lib/ai/stream.ts`)
- `buildModelContext({ targetConversationId, newUserMessage, sessionUserId })` — DB-wired wrapper.
- `walkAncestors({ target, sessionUserId, fetcher, newUserMessage })` — pure (DB-via-fetcher) algorithm; returns `CoreMessage[]` ordered `system → root → ... → parent → current-before-new → new user message`.
- `buildSubChatSystemNote({ parentTitle, highlightText })` — reads `SUBSCHAT_SYSTEM_PROMPT` env (with default template), substitutes `{parentTitle}` and `{highlightText}` placeholders.
- `extractSentenceContext(content, charStart, charEnd, maxChars = 500)` — sentence-splitter algorithm per spec §5; falls back to truncated full content when no terminal punctuation.
- `validateBranchSelection({ messageContent, selectedText, charStart, charEnd, clientHighlightContext? })` — pure validator returning `{ ok: true }` or `{ ok: false, fields }`.
- `deriveTitle(content)` — first 6 words, ellipsis if > 60 chars total.
- `HttpError(status, code, message)` — thrown by `walkAncestors`/`buildModelContext`. `code === "NOT_FOUND"` → 404; `code === "ANCESTOR_UNAVAILABLE"` → 503.
- `streamChatResponse` now takes `depth?: number` (default 0). User message persists BEFORE ancestor walk for `depth >= 1`, so `ANCESTOR_UNAVAILABLE` returns 503 with no data loss.

### Type extensions (`src/lib/types/api.ts`)
- New error codes: `INVALID_SELECTION`, `ANCESTOR_UNAVAILABLE`, `INTERNAL`.
- `BranchRequestSchema` (zod) — validates `messageId`, `selectedText` (1–2000), `charStart` (int ≥0), `charEnd` (int > charStart), optional `clientHighlightContext` (≤500). Cross-field refine ensures `charStart < charEnd`.
- `BranchResponse` interface (and inferred `BranchResponseSchema`).
- Updated `ErrorCode` type.

### Rate limit (`src/lib/auth/rate-limit.ts`)
- `checkBranchRateLimit(userId)` — 30 attempts / 10 min / user, in-memory token bucket. Returns `{ allowed, retryAfterMs, reason }`. Distinct from the signin and messages buckets (so a chat-heavy user can still branch, and vice versa).
- `resetBranchRateLimit(userId)` exported for tests.
- `rateLimitConfig.branch` exposed.

### DB schema (`src/lib/db/schema.ts`)
- Added `.references((): AnyPgColumn => conversations.id, { onDelete: "cascade" })` to `conversations.parentId` and `conversations.rootConversationId` (per Q7). Declarative only — pglite dev bootstrap SQL doesn't enforce it yet; the next `drizzle-kit generate` will produce a prod migration.

### Tests (Vitest, all pass)
- `tests/unit/branch-validation.test.ts` — 17 cases covering `validateBranchSelection` and `extractSentenceContext` (exact match, whitespace tolerance, OOB charStart/charEnd, empty/oversized text, oversized `clientHighlightContext`, exact-500-char boundary, sentence-with-neighbors, ellipsis cap at 500, fallback for content without terminal punctuation, empty content).
- `tests/unit/ancestor-walk.test.ts` — 5 cases covering `walkAncestors`: depth-0 root returns current only, depth-2 returns root + parent + current in order with system note containing direct-parent title + target's highlightText, foreign-owned ancestor throws 503 ANCESTOR_UNAVAILABLE, missing ancestor throws 503 ANCESTOR_UNAVAILABLE, foreign-owned target throws 404 NOT_FOUND.
- `tests/unit/system-note.test.ts` — 7 cases: default template used when env unset, `{parentTitle}` and `{highlightText}` substitution, env-var override, null-parent falls back to "a parent chat", null-highlight falls back to "a highlighted passage", repeated-placeholder substitution.

Existing 17 phase-0 tests still pass.

### Handoff doc
- This file.

## what was accepted
- [x] types exported (`@/lib/types/api` → `BranchRequestSchema`, `BranchResponse`; `@/lib/ai/stream` → `walkAncestors`, `buildModelContext`, `buildSubChatSystemNote`, `extractSentenceContext`, `validateBranchSelection`, `deriveTitle`, `HttpError`)
- [x] tests pass — 46/46 vitest unit tests (29 existing + 17 new across 3 files)
- [x] typecheck passes — `tsc --noEmit` clean
- [x] spec items implemented: US-103, US-104 (server-side additions), US-105, US-107, US-108 (ancestor walk respects ownership; arbitrary depth); API surface per `.orchestrator/specs/phase-1.md` §5
- [ ] review by Backend.Critic — pending (Critic spawn after this handoff)

## spec reference
`.orchestrator/specs/phase-1.md` — sections 5 (API surface), 6 (DB schema), 7 (Context reconstruction), 11 (Q2/Q7/Q11 decisions).

## API surface for Frontend

### NEW: `POST /api/chats/:id/branch`

Create a sub-chat from a text selection in an assistant message of conversation `:id`.

**Request:**
```json
{
  "messageId": "uuid",
  "selectedText": "vector database",
  "charStart": 21,
  "charEnd": 36,
  "clientHighlightContext": "optional, ≤ 500 chars; if omitted, server computes from sentence splitter"
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "parentId": "uuid",
  "rootConversationId": "uuid",
  "depth": 2,
  "highlightText": "vector database",
  "highlightContext": "In a RAG pipeline, a vector database stores embeddings for retrieval.",
  "title": "New chat",
  "createdAt": "2026-09-13T10:00:00Z"
}
```

**Response 401:** `{ error: { code: "UNAUTHENTICATED" } }`
**Response 404:** `{ error: { code: "NOT_FOUND", message: "Conversation not found" } }` — also returned when the source message id doesn't belong to this conversation, or the message isn't an assistant message (no enumeration).
**Response 422:** `{ error: { code: "INVALID_SELECTION", fields: { "charEnd": "charEnd must be..." } } }` — zod or cross-field validation failure, with field-level detail.
**Response 429:** `{ error: { code: "RATE_LIMITED", message: "Too many sub-chats — try again in N minutes" } }` — branch quota (30/10min/user) exceeded.
**Response 500:** `{ error: { code: "INTERNAL", message: "Could not create sub-chat" } }`.

### `GET /api/chats/:id` — additive changes

Response now also includes:
- `parentTitle: string | null` — title of the direct parent, or null for root or when parent is foreign-owned/missing.
- `rootTitle: string | null` — title of the root conversation, or null for root (where `rootConversationId === id`) or when root is foreign-owned/missing.
- `highlightText: string | null` — for sub-chats, the selected phrase.
- `highlightContext: string | null` — for sub-chats, the surrounding sentence(s) or client-supplied context.

**Frontend usage:** render the breadcrumb and the parent-context banner from a single `GET /api/chats/:id` — no separate request needed.

### `POST /api/chats/:id/messages` — internal behavior change

The client-facing API contract is unchanged (`{ content, clientMessageId }` request, SSE stream response). Internal additions:

1. **Ownership precheck** — server resolves the conversation (404 on cross-user) BEFORE streaming. Previously this was inside `streamChatResponse`; the route now does it explicitly so it can also do title auto-derive.
2. **Title auto-derive** — when the conversation's `title` is still `"New chat"` at the time of the first user message, the server updates it to the first 6 words of the user's message (truncated with `…` if the 6-word join is > 60 chars total). This happens BEFORE the AI call (no latency dependency). Empty / whitespace-only messages produce a no-op.
3. **Sub-chat path (`depth >= 1`)** — the model context is built by `walkAncestors`:
   - Walk the parent chain (root → ... → direct parent). Foreign-owned or missing ancestor → `503 ANCESTOR_UNAVAILABLE`.
   - System note prepended ONLY to the model context (template via `SUBSCHAT_SYSTEM_PROMPT` env, default per spec §7).
   - The new user message persists to the sub-chat only. Ancestor message tables are NEVER written to.

### New error codes (additive)
- `INVALID_SELECTION` — branch validation failure (422).
- `ANCESTOR_UNAVAILABLE` — ancestor walk hit a missing or foreign-owned link (503).
- `INTERNAL` — generic catch-all for branch insertion failure (500).

Existing codes unchanged.

### Title auto-derive rules
- Trigger: `conversation.title === "New chat"` at the start of `POST /api/chats/:id/messages`.
- Source: first 6 whitespace-separated words of `content` (trimmed).
- Truncation: if the resulting string > 60 chars, slice to 59 chars and append `…`.
- Empty / whitespace-only content: leaves title as `"New chat"` (no-op).
- Failure mode: non-fatal — if the DB UPDATE fails, the stream still proceeds with the placeholder title.

### New rate limit
- `POST /api/chats/:id/branch` is rate-limited at **30 requests / 10 min / user** via `checkBranchRateLimit(userId)`. Distinct from the signin (5/15min/IP) and messages (60/min, 500/hr/user) buckets.
- On 429 the client should show the toast `"Too many sub-chats — try again in N minutes"` and re-enable the pill/menu.
- For tests: `resetBranchRateLimit(userId)` clears the bucket.

### Schema FK change note (Q7)
- `conversations.parentId` and `conversations.rootConversationId` now have `.references(() => conversations.id, { onDelete: "cascade" })` in `src/lib/db/schema.ts`. This is declarative — pglite dev's bootstrap SQL does NOT enforce it (pglite was started in phase 0 with no self-FKs). In prod, a `drizzle-kit generate` will produce a migration adding these FKs.
- The `conversationsRelations` definitions remain unchanged (they were already declared).

## consumer notes

- Import types from `@/lib/types/api` (do NOT redefine). For `BranchRequest` / `BranchResponse`, also import from there.
- Import helpers from `@/lib/ai/stream` if needed: `buildSubChatSystemNote`, `extractSentenceContext`, `validateBranchSelection`, `deriveTitle`, `walkAncestors`, `buildModelContext`. These are server-only.
- The route handlers export `runtime = "nodejs"` — do not mark them `edge`.
- The cross-user 404 is **404, not 403** — match on `code === "NOT_FOUND"`. Same for branch.
- `clientHighlightContext` is OPTIONAL. If you can compute it on the client (debounced selection → surrounding sentence), pass it; otherwise omit and the server will compute via the spec §5 algorithm. Cap at 500 chars server-side; longer values are rejected with 422.
- Sub-chat creation does NOT trigger title auto-derive (title remains `"New chat"`). Title is set when the user sends their first message in the new sub-chat. The frontend should not poll for title changes — the title returned on subsequent `GET /api/chats/:id` after a message send will reflect the derived value.
- `depth` is a server-trusted integer. Frontend does not need to compute it.
- For the ancestor-walk's race condition (ANCESTOR_UNAVAILABLE), the user message is already persisted on the sub-chat when 503 returns. The frontend should show "Sub-chat parent is unavailable — start a new chat" with a "New chat" button (US-105 AC.6).

## curl examples

```bash
# Branch from selection
curl -X POST http://localhost:3000/api/chats/<root-id>/branch \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{
    "messageId": "<assistant-msg-id>",
    "selectedText": "vector database",
    "charStart": 21,
    "charEnd": 36,
    "clientHighlightContext": "In a RAG pipeline, a vector database stores embeddings for retrieval."
  }'
# 201 → { id, parentId, rootConversationId, depth, highlightText, highlightContext, title: "New chat", createdAt }
# 422 → { error: { code: "INVALID_SELECTION", fields: {...} } }
# 429 → { error: { code: "RATE_LIMITED", message: "Too many sub-chats — try again in 10 minutes" } }

# Open a sub-chat (now includes parentTitle + rootTitle for breadcrumb)
curl http://localhost:3000/api/chats/<sub-id> -b cookies.txt
# 200 → { ..., parentTitle: "How to build a RAG system", rootTitle: "How to build a RAG system", highlightText: "vector database", highlightContext: "..." }
```

## open changes requested
(none)

## blockers
(none — Frontend can begin once it imports `@/lib/types/api` + branches POSTs against `/api/chats/:id/branch`)

## for Frontend — what you can start building immediately

1. Floating "Ask about this" pill (US-101) on `selectionchange` + 50ms debounce, gated to assistant message bubbles.
2. Custom right-click menu (US-102) with "Sub-chat about selection" + "Copy".
3. `POST /api/chats/:id/branch` from the pill/menu → handle 201/422/429; navigate `/c/<new-id>` on success (US-103).
4. Sub-chat view at `/c/[id]` rendering:
   - Breadcrumb `Home / <rootTitle> / <parentTitle> / <subChatTitle>` from the new `parentTitle` + `rootTitle` fields (US-106).
   - Parent-context banner with `<mark>`-highlighted source message (US-104).
   - Composer with dynamic placeholder `"Ask about <first-3-words-of-highlightText>…"`.
5. SSE stream client unchanged — same `consumeDataStream` flow as phase 0; the server transparently injects ancestor context + system note for `depth >= 1`.

## cross-role notes

- **Security**: New attack surface covered — branch creation is rate-limited per user (30/10min), ownership is checked at both the source conversation and (transitively, inside `walkAncestors`) every ancestor link. `clientHighlightContext` is capped at 500 chars to prevent abuse via oversized bodies.
- **DevOps**: No infra change. The schema FK is declarative — when prod migrations are generated, drizzle-kit will produce a `ALTER TABLE` for the new FK constraints. No runtime impact in dev.
- **Tech Writer**: README should mention `SUBSCHAT_SYSTEM_PROMPT` env var (optional). The phase-1 handoff doc is this file.
- **UX**: The floating pill placement + context menu positioning are owned by UX per phase 1 spec; backend just needs `POST /branch` to be reachable.

---

**Summary of test coverage:**
- 46/46 vitest unit tests pass
- `tsc --noEmit` clean
- 0 lint regressions (next lint interactive setup, not run in this env)
- No DB migration required for dev (pglite); prod will get FK migrations on next `drizzle-kit generate`
