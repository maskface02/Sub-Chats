# API Handoff — Phase 4 (Backend → Frontend)

**status:** ready
**scope:** delete/restore (soft-delete + subtree cascade), export (md/json), edit (truncate + re-stream), regenerate, abort-time partial persistence
**contract source:** `.orchestrator/specs/phase-4.md` §5/§6/§8 (frozen rev 2) + `.orchestrator/decisions/phase-4-open-questions.md`
**error shape:** `{ error: { code, message?, fields? } }` (phase-0 shape, unchanged)

---

## 1. `DELETE /api/chats/:id` (NEW)

Auth required. Rate-limited by the shared mutation bucket (30 req / 10 min / user — shared with restore, edit, regenerate).

Soft-deletes the target conversation AND every LIVE descendant in its subtree (one transaction). Never hard-deletes.

**200**
```json
{ "deletedIds": ["uuid-root", "uuid-child-1", "uuid-child-2"], "deletedCount": 3, "batchId": "uuid" }
```
- `deletedIds` — every soft-deleted conversation id (the undo client replays these; spec AC.4 shape, `batchId` is an additive convenience field for the undo toast, restore does not require it).
- `deletedCount === deletedIds.length`.
- **Live-only cascade:** a descendant that was separately soft-deleted earlier keeps its ORIGINAL `deletedBatchId` (nested-delete batch integrity, US-403 AC.2b) — restoring the parent does NOT resurrect it; restoring the leaf's own batch does.

**Errors:** `401 UNAUTHENTICATED` · `404 NOT_FOUND` (missing / foreign / already-soft-deleted — byte-identical) · `409 STREAM_ACTIVE { message: "Stop the current response before deleting" }` (target OR any descendant is streaming) · `429 RATE_LIMITED` (+`Retry-After`, `X-RateLimit-Limit|Remaining|Reset`) · `500 INTERNAL`.

## 2. `POST /api/chats/:id/restore` (NEW)

Auth required. Same shared mutation bucket.

Reverses the target row's OWN delete batch: `UPDATE conversations SET deleted_at = NULL, deleted_batch_id = NULL WHERE deleted_batch_id = :target.deleted_batch_id AND user_id = :userId`.

**Request:** `{}` (empty body OK).
**200** `{ "restoredCount": 3 }` — `0` when the conversation is not soft-deleted (idempotent).
**Errors:** `401` · `404 NOT_FOUND` (missing/foreign) · `429` · `500`.

## 3. `GET /api/chats/:id/export?format=md|json` (NEW)

Auth required. NOT rate-limited.

- Missing/absent/non-`md|json` format → `400 INVALID_INPUT { message: "format must be md or json" }`.
- Soft-deleted / foreign / missing → `404 NOT_FOUND`.
- **md (`200`)**: `Content-Type: text/markdown; charset=utf-8`; `Content-Disposition: attachment; filename="<lowercase-title-slug>-<YYYYMMDD>.md"` (slug ≤ 60 chars; `\r \n " \` and all C0/C1 control chars stripped; non-ASCII slug → RFC 5987 `filename*=UTF-8''…` alongside an ASCII fallback).
  Body structure (normative per AC.3): `# <title>`; sub-chats add `> Path: Root › … › Parent`, `> Highlight: "…"` and (when non-null) `> Context: …`; then `---`; then per message (createdAt ASC): `## You` / `## Assistant` + content + blank line. **Escaping:** message content containing `#`-lines, `---` lines, or fences is emitted inside a fence whose run is longer than every inner run (inner fence runs lengthened +1); other content raw. No model metadata in md.
- **json (`200`)**: `application/json`; exact shape:
  ```json
  { "conversation": { "id": "…", "title": "…", "parentId": null, "rootConversationId": "…", "depth": 0,
      "highlightText": null, "highlightContext": null, "createdAt": "…", "updatedAt": "…" },
    "messages": [ { "id": "…", "role": "user", "content": "…", "model": null, "providerId": null, "createdAt": "…" } ] }
  ```
  Own rows only; `providerId` is an id/sentinel only — no key material anywhere.
- Empty conversation (0 messages) still 200.

## 4. `POST /api/chats/:id/messages/:messageId/edit` (NEW) — US-407

Truncate-at-message + re-stream. **Response 200 is an SSE stream** (phase-0 AI SDK protocol), sent after the transaction commits.

**Request** (zod `.strict()`, 1..8000 chars; violations → `422 INVALID_INPUT` with `fields.content`):
```json
{ "content": "Why did my container exit — and how do I debug it?" }
```
Semantics (AC.4): one transaction — (a) target message content updated, (b) all messages with `createdAt > target.createdAt` deleted (same-timestamp rows tie-broken by `id` order), then (c) re-stream via the existing `streamChatResponse` path (ancestor walk applies; the edited history is what the model sees). Truncation is permanent — no message soft-delete.

Pre-stream errors: `401` · `404 NOT_FOUND` (conversation OR messageId — byte-identical) · `422 INVALID_INPUT (fields)` · `422 NOT_EDITABLE { message: "Only your own messages can be edited" }` (non-user target) · `409 STREAM_ACTIVE` · `429` · `503 NO_PROVIDER` / `502 PROVIDER_FAILED` · `500`.

## 5. `POST /api/chats/:id/messages/:messageId/regenerate` (NEW) — US-408

**Response 200 is an SSE stream.** Request `{}`.

Semantics (AC.3): the LAST assistant message (by `createdAt`, id tie-break) is deleted in one transaction, then re-streamed from the surviving history (previous user message NOT re-persisted). Fresh provider resolution per request — new row carries its own `model`/`providerId`.

Pre-stream errors: same as edit, but `422 NOT_REGENERABLE { message: "Only the latest response can be regenerated" }` for user-role targets and non-last assistant messages.

## 6. Rate limiting (phase-4 buckets)

| bucket | routes | limit |
|---|---|---|
| `mutation` (NEW) | delete, restore, edit, regenerate | 30 / 10 min / user, combined |
| message-send (LLM) | edit, regenerate (also draw this) | 60/min + 500/hour (phase-0) |

429 responses carry `Retry-After` + `X-RateLimit-Limit|Remaining|Reset`.

## 7. Streaming + stop (US-405)

- **Abort-time partial persistence implemented and unit-tested (US-405 AC.2):** on client-disconnect abort the accumulated assistant text is persisted as a normal assistant row (same shape as the `onFinish` write), the lock entry is cleaned. US-407/US-408 re-streams share this path.
- `isStreamActive(conversationId)` exported from `@/lib/ai/stream` — the 409 checks (delete incl. descendants; edit/regenerate) use the in-flight map.
- "Stopped" indicator stays client-side (ephemeral — spec §8.4); no schema flag.

## 8. deletedAt sem everywhere (AC.5)

Soft-deleted ids return byte-identical `404 { code: "NOT_FOUND", message: "Conversation not found" }` (messageId-level: `"Message not found"`) on **every** read AND write path: `GET /api/chats` (list), `GET /api/chats/:id`, `GET /api/chats/:id/tree`, `GET /api/chats/:id/export`, `POST /api/chats/:id/messages`, `POST /api/chats/:id/branch`, edit, regenerate. A soft-deleted ROOT 404s its whole tree via the tree endpoint's root lookup; a deleted ancestor in the walk chain surfaces as the existing `503 ANCESTOR_UNAVAILABLE`.

## 9. Migration + schema (`drizzle/0001_soft_delete.sql`)

```sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_batch_id text;
DROP INDEX IF EXISTS conversations_user_updated_idx;
CREATE INDEX IF NOT EXISTS conversations_user_updated_live_idx
  ON conversations (user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS conversations_deleted_batch_idx ON conversations (deleted_batch_id);
```
Rollback documented in the migration file header (drop columns + recreate the old index; fully additive, no data loss). `src/lib/db/bootstrap.ts` carries idempotent equivalents for the dev pglite path. Hard-purge cron (>30 days) is out of scope (US-401 AC.9) — no hard DELETE exists in phase-4 code paths; message truncation in edit/regenerate does hard-`DELETE` message rows (per spec decision, not coverable by the soft-delete undo).

## 10. Backend implementation notes (for review)

- Cascade = live-subtree set computed from a single `rootConversationId + userId` scoped query inside the transaction path; `deletedBatchId` = fresh UUID per delete call; restore filters by batch id + user.
- 409 pre-check runs over ALL live subtree ids against the in-flight map (Reviewer fix — descendants included).
- Edit/regenerate: `streamChatResponse` gained `skipUserPersist: true` — no duplicate user-row insert, history (plus ancestor-walk system note for sub-chats) is the final model input.
- 422 error codes added to `ERROR_CODES`: `STREAM_ACTIVE`, `NOT_EDITABLE`, `NOT_REGENERABLE` (frozen spec names — note spec text shows some bodies as `INVALID_INPUT`; the frozen §5 route table lists the dedicated codes and the routes emit the dedicated codes).
- Known pre-existing drift (flagged, NOT fixed in phase 4): `drizzle/0000_init.sql` + `drizzle/meta` snapshot use camelCase columns and integer timestamps that don't match `schema.ts`/`BOOTSTRAP_SQL` (snake_case timestamptz). `0001` is written to match the runtime schema; re-syncing the drizzle-kit journal/snapshot is a DevOps follow-up.

## 11. Tests added (Vitest)

- `tests/unit/delete-restore.test.ts` (10) — 401/404 byte-parity (incl. soft-deleted), descendant-stream 409, live-only cascade (batch fields + no hard DELETE), `collectLiveSubtreeIds` nested-batch integrity, restore own-batch semantics + idempotence, branch-on-deleted 404.
- `tests/unit/export.test.ts` (15) — md escaping fixtures (`#`-lead, `---`, nested fences lengthened), slug sanitization (CR/LF/quote/backslash/control chars), RFC 5987 filename*, md/json route shapes + headers, 400/404, empty conversation.
- `tests/unit/edit-regenerate.test.ts` (17) — edit 404/422/409/429 + truncate-in-place capture + `skipUserPersist` re-stream; regenerate last-only/404/409 + same-history re-stream; abort mid-stream → partial assistant row persisted + lock map cleaned; ancestor walk-history contains the edited content.

**Verified:** `npx tsc --noEmit` clean; `npx vitest run` 156/156 pass (14 files).
