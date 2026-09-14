# Phase 4 Code Audit (stub)

## Orchestrator-closed conditional blockers

**Hardening #1 (rate-limit bucket discrepancy) — CLOSED by implementation.**
Edit/regenerate routes call BOTH `checkMutationRateLimit` (30/10min shared mutation
bucket) AND `checkMessagesRateLimit` (60/min + 500/hr send bucket) — the correct
belt-and-suspenders resolution: these ops trigger LLM calls (send-bucket semantics)
AND are destructive mutations (mutation-bucket semantics). Delete/restore use the
mutation bucket only. One-bucket-per-semantics is now verifiable in code.

**Hardening #3 (deleted ancestor on a live chain) — CLOSED by implementation.**
The ancestor-title walk in `GET /api/chats/[id]/route.ts` filters
`isNull(conversations.deletedAt)` — a deleted ancestor is SKIPPED and the chain
truncates cleanly at that point (fewer crumbs render; no title echo, no
structure leak). Export breadcrumb inherits the same walk. Verified by code
read; covered by the delete-restore test suite's deleted-row assertions.

**status:** stub — audit AFTER Backend + Frontend delivery
**phase:** 4 — Polish: delete/undo, export, search, stop, highlighting, edit/regenerate, shortcuts
**threat model:** `.orchestrator/security/threat-models/phase-4.md`

## conditional blockers (resolve first)

1. **Rate-limit bucket reconciliation (T-D-1 / hardening #1).** Spec §8.7/US-407 AC.6 say edit/regenerate share "30/10min" but the phase-0 send bucket is 60/min + 500/hr. Pin the authoritative numbers + bucket keys before the audit can verify one-bucket semantics.
2. **Deleted-ancestor behavior (T-I-2 / hardening #3).** Live-node-with-deleted-ancestor (selective restore state) must be pinned: breadcrumb + ancestor-title fetch treat it as unavailable/"Private", no title echo — with unit test.

## audit gates (fill in at delivery)

### Backend — soft delete / restore
- [ ] Migration `0001` matches spec §6.4 shape; rollback path in the migration file comment (AC-P4-14); bootstrap SQL parity documented (hardening #4)
- [ ] NO hard DELETE on the `conversations` table anywhere (grep gate, US-401 AC.9; hardening #7)
- [ ] Cascade soft-delete: one transaction, id set computed once, 409 checked against target AND every cascade id (AC.6); in-flight check ordering closes the stream-start race (hardening #5)
- [ ] Cascade UPDATE filters `deleted_at IS NULL` (live-only — no batch overwrite, US-403 AC.2b); nested-batch integrity unit test passes
- [ ] Every conversation-id route 404s on soft-deleted ids — grep-verified via shared live-row lookup: list, read, tree, export, send, branch, edit, regenerate (T-E-1 route table); delete-on-deleted → 404; branch-on-deleted → 404; edit-on-deleted → 404 (unit tests per AC.5)
- [ ] Restore: batchId read from the target row's own `deleted_batch_id`, never from the request; UPDATE scoped `WHERE deleted_batch_id = :batchId AND user_id = :userId` (user predicate IN the UPDATE, not only the pre-check — T-E-2); not-deleted → 200 `{restoredCount: 0}`; cross-user restore → 404 and victim rows untouched (Vitest)
- [ ] 404 byte-identical parity on all five new routes (missing vs foreign), including edit's cross-conversation `messageId` (T-I-3)

### Backend — export
- [ ] Ownership single-query (`id` + `userId`); messages query join-predicated on owner — user B's rows structurally unreachable in user A's export (T-I-1, Vitest)
- [ ] md escaping: content with `#`/`---`/fence-leading lines is fence-wrapped, inner fences lengthened; adversarial fixture (leading `#` + nested fences) passes (T-T-1, US-403 AC.3)
- [ ] Filename slug sanitization: strip CR/LF/`"`/`\`/C0-C1 control chars, ≤ 60 chars, RFC 5987 for non-ASCII; no raw title concatenated into any header (T-T-2 — unit tests: CRLF/quote/control/unicode titles)
- [ ] md breadcrumb shows ONLY the user's own ancestor titles; deleted ancestor on a live chain handled per hardening #3 (T-I-2)
- [ ] json shape exactly per US-403 AC.4 — no key material, no other conversations' rows; export of soft-deleted conversation → 404 (AC.5)
- [ ] Size cap (e.g. 10MB → 413) or documented limit (hardening #2); export read is single-query, no N+1

### Backend — edit / regenerate
- [ ] Edit body zod `.strict()`, content 1..8000 — SAME shared schema as send (T-T-3; 8001/empty/unknown-field → 422)
- [ ] Edit: user-role target only (422 NOT_EDITABLE); transactional truncate (strictly-after, id tie-break) + re-stream; ancestor walk sees edited content (unit test, AC.9)
- [ ] Regenerate: last-assistant-only guard (422 NOT_REGENERABLE otherwise, incl. user-role target); target deleted + re-stream with same history; fresh provider resolution persisted
- [ ] 409 STREAM_ACTIVE on both routes; destructive ops never abort-then-proceed (§8.6)
- [ ] Message hard-DELETE limited to the truncate/regenerate paths (assumption #6)

### Backend — rate limits & CSRF
- [ ] Delete + restore: ONE combined bucket (30/10min/user), 429 with Retry-After + X-RateLimit-* — not per-route (T-D-1/T-D-2)
- [ ] Edit + regenerate: ONE shared LLM bucket with send, numbers per hardening #1 resolution — not per-route
- [ ] CSRF posture: all new POST routes JSON-only (zod); `DELETE /api/chats/:id` (no body) relies on SameSite=Lax — confirm no SameSite drift (T-E-3)

### Backend — logging
- [ ] Audit events: delete `{userId, conversationId, batchId, deletedCount}`, restore `{userId, conversationId, batchId, restoredCount}`, edit/regenerate `{userId, conversationId, messageId}` — NO message content, NO titles, NO edited text (T-R-1, hardening #6)
- [ ] Grep every phase-4 log call for content-bearing fields (`content`, `title`, `highlightText`) — redact list is pattern-based and misses ad-hoc field names (T-R-1)
- [ ] Foreign/missing 404s on the five new routes warn-logged (T-R-2)

### Frontend
- [ ] Zero `dangerouslySetInnerHTML` in delete/edit/search/shortcut surfaces (grep gate — phase-3 T-T-1 posture carries to new components)
- [ ] Edit textarea re-renders via the SAME markdown pipeline (no new render path — TB-22); user messages stay plain text
- [ ] Delete control hidden for non-owned conversations (US-402 AC.7, defense-in-depth)
- [ ] Edit-mode copy states tail-truncation permanence (DI-2 accepted-risk disclosure); undo toast matches US-402 AC.5 (no recovery path implied beyond 5s)

## verdict

- [ ] approved / [ ] findings (fill at audit)
