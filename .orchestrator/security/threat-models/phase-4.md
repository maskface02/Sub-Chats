# Phase 4 STRIDE Threat Model

**status:** preliminary (code not yet written — pre-implementation review)
**phase:** 4 — Polish: delete/undo, export, search, stop, highlighting, edit/regenerate, shortcuts
**spec:** `.orchestrator/specs/phase-4.md` (FROZEN rev 2 — includes the 5 Reviewer fixes: deletedAt-404 on branch/edit/regenerate, live-only cascade, descendant-stream 409, md escaping + filename sanitization, restore batchId source explicit)
**framework:** STRIDE + OWASP Top 10 (2025)
**reviewer:** security (GLM 5.3 Flash tier)
**builds_on:** `.orchestrator/security/threat-models/phase-3.md` (baseline; all phase-3 threats carry over unchanged — SSRF posture, key-material invariants, rehype-raw gate)
**decisions:** `.orchestrator/decisions/phase-4-open-questions.md` (OQ-1..7; OQ-4 accepted destructive truncation)

---

## scope

Phase 4 turns "delete" into an **access-revocation surface** (new security semantic — data the user believes is gone must become unreachable on EVERY route), adds a **data-export path** (bulk own-data leave-the-app channel), and adds two **destructive mutation** routes (edit-truncate, regenerate-delete). Specifically:

1. **NEW (API)** — `DELETE /api/chats/:id` (soft-delete subtree cascade + `deletedIds`), `POST /api/chats/:id/restore` (batch undo), `GET /api/chats/:id/export?format=md|json`, `POST /api/chats/:id/messages/:messageId/edit` (truncate + re-stream), `POST /api/chats/:id/messages/:messageId/regenerate` (delete-last + re-stream).
2. **NEW (schema)** — first post-bootstrap migration `0001`: `deleted_at` + `deleted_batch_id` columns, `deleted_batch_idx`, partial live-index swap (§6). Rollback documented (§6.5).
3. **NEW (export format)** — markdown rendering of a conversation to a downloadable file (fence-escaping + filename sanitization spec'd, US-403 AC.3).
4. **MODIFIED** — every existing conversation-id route gains the `deletedAt IS NULL` behavior (404 parity with missing id).
5. **NEW (client)** — delete/undo UI, export menu, tree search (client-only filter, no new endpoint), stop button (abort + partial persist), edit mode, shortcuts.

Phase 0–3 surfaces (auth, providers, markdown, tree, split) unchanged; phase-3 baseline carries.

---

## data flows

1. **Delete.** Client → `DELETE /api/chats/:id` (session) → single transaction: compute subtree id set → check in-flight map for target AND every id (409 STREAM_ACTIVE) → `UPDATE conversations SET deleted_at = now(), deleted_batch_id = :batchId WHERE id IN (:set) AND deleted_at IS NULL` (live-only) → 200 `{deletedIds, deletedCount}`. Never a hard DELETE (US-401 AC.9).
2. **Restore.** Client → `POST /api/chats/:id/restore` (session) → ownership check (`id + userId`, 404 parity) → target must be soft-deleted (not-deleted → 200 `{restoredCount: 0}`, idempotent) → `UPDATE conversations SET deleted_at = NULL, deleted_batch_id = NULL WHERE deleted_batch_id = :batchId AND user_id = :userId` (batchId read from the target row's own `deleted_batch_id` — Reviewer fix #5).
3. **Export.** Client → `GET /api/chats/:id/export?format=md|json` (session, ownership 404, deleted → 404) → own conversation row + own messages (`createdAt ASC`) → md: title + own-ancestor breadcrumb + fence-escaped bodies + sanitized `Content-Disposition` slug; json: full own-row shape (no key material, no other rows).
4. **Edit.** Client → `POST .../edit` `{content}` (zod strict, 1–8000) → 409 if streaming → one transaction: update target user-message content + hard-DELETE messages with `createdAt >` target → SSE re-stream from truncated history.
5. **Regenerate.** Client → `POST .../regenerate` → 409 if streaming → transaction: hard-DELETE last assistant message → SSE re-stream with same history, fresh provider resolution.
6. **All existing reads/writes** — list/read/tree/export/send/branch now filter `deleted_at IS NULL`; a soft-deleted id behaves byte-identically to a missing id (404).

---

## trust boundaries

- **TB-19 (NEW):** Soft-delete ↔ route visibility. `deleted_at` is the revocation marker for a whole data class; every route that resolves a conversation id is a potential bypass point. One missed filter = "deleted" data still readable/writable.
- **TB-20 (NEW):** Restore batch ↔ user scope. `deleted_batch_id` is a server-generated opaque token; restore must never trust it across the user boundary (a foreign batchId must be a no-op/404, never a cross-user resurrection).
- **TB-21 (NEW):** Conversation data ↔ exported file. Export renders DB rows into a portable artifact (md string + HTTP headers) that leaves the app context — structure injection and header injection become new output-encoding surfaces.
- **TB-22 (carry-over, sharpened):** User message content ↔ DOM ↔ now also edit-round-trip. Edit content re-enters the DB and is re-rendered; the phase-3 markdown XSS posture must hold for the edited content identically (no new render path).

---

## threats (STRIDE)

### Spoofing

- **T-S-1: No new spoofing surface.** `userId` on all five new routes comes from the session; bodies are zod `.strict()` (`{content}` / `{}`), so `userId`/`conversationId`/`messageId` injection via body is rejected. `batchId` never appears in a request body at all — it is read server-side from the target row (Reviewer fix #5), so it cannot be spoofed either.
  - likelihood: n/a; impact: n/a
  - mitigation: carry-over posture; checklist gate that restore request body stays `{}`-only and no route accepts `batchId`/`deletedIds` from the client.

### Tampering

- **T-T-1: Markdown export structure injection — MEDIUM.** Message content is user/AI-controlled and is emitted into a structured md document. Without escaping, a message whose body starts with `#` forges a section header (content can masquerade as `## You` / `## Assistant` sections — a shared artifact then misattributes attacker-influenced AI output as user speech), a `---` line swallows the divider structure, and an unterminated ` ``` ` fence hides every subsequent message inside a code block (data suppression in a shareable/exported artifact). Spec'd mitigation (US-403 AC.3): any message containing a line starting with `#`, `---`, or ` ``` ` is emitted inside a ` ```text ` fence with inner fences lengthened to ` ```` `; adversarial fixture (content starting with `#` + nested fences) is a unit-test gate.
  - likelihood: high (trivially craftable); impact: medium (misleading exported artifact — no app-side XSS; the md is rendered by external tools, not the app DOM)
  - mitigation: spec AC.3 escaping is normative; unit fixture gate; audit greps the export serializer for the escape condition.

- **T-T-2: `Content-Disposition` header injection via filename slug — HIGH if unmitigated.** The conversation title flows into `filename="<slug>-<YYYYMMDD>.md"`. A title containing CR/LF enables HTTP response splitting / header smuggling; `"` breaks the quoted-string; backslashes and C0/C1 control chars are hostile to filesystems and downstream parsers. Spec'd (US-403 AC.3): strip `\r`, `\n`, `"`, `\`, and all C0/C1 control chars before the header; non-ASCII → RFC 5987 `filename*`. The slug is ≤ 60 chars.
  - likelihood: medium (title is user-derived via auto-derive, but must not be trusted — auto-derive truncation alone does not strip control chars); impact: **high** (response splitting on the export route)
  - mitigation: sanitizer function is the ONLY path from title to header (code-review gate: no raw title concatenation into any header); unit tests: CRLF title, quote title, control-char title, unicode title; checklist gate.

- **T-T-3: Edit content validation parity — MEDIUM.** `edit` persists user content directly. If its validation is weaker than send's (missing 1–8000 bound, non-strict zod), edit becomes a bypass: oversized content persisted past the phase-0 cap, unknown fields accepted, empty-string content truncating history into a degenerate state. Spec AC.2 pins zod `.strict()`, 1..8000, `422 INVALID_INPUT` with `fields.content`.
  - likelihood: low (copy-paste of send validation is the natural implementation); impact: medium (validation-bypass class; stored oversized content re-renders everywhere)
  - mitigation: shared zod schema between send and edit (one constant, not two drift-prone literals); unit test: 8001 chars → 422, empty → 422, unknown field → 422.

- **T-T-4: Drizzle parameterization carry-over — LOW.** New queries take `:batchId` (server-generated uuid), id sets, and message content. No raw `sql\`\`` interpolation; the cascade/restore UPDATEs use parameterized IN-lists.
  - likelihood: very low; impact: critical if violated
  - mitigation: same ban as phase-1 T-T-1; audit greps new routes for raw interpolation.

### Repudiation

- **T-R-1: Destructive-action audit trail — MEDIUM.** Delete/restore/edit/regenerate are the first routes where a user can destroy (or appear to destroy) their own data at scale — "I never deleted that / the app lost my messages" disputes need server-side evidence. Required: delete logged `{userId, conversationId, batchId, deletedCount}`, restore `{userId, conversationId, batchId, restoredCount}`, edit/regenerate `{userId, conversationId, messageId}`. **No message content, no titles, no edited text in any log line** — the phase-1 redact list covers `*.selectedText` etc., but `content` from the edit body is a new field name reaching a log-adjacent code path; redact is pattern-based and an ad-hoc `log.info({ content })` slips through.
  - likelihood: medium (logging mistakes remain the top leak vector); impact: medium (repudiation disputes; user content in centralized logs)
  - mitigation: checklist gate — audit greps every phase-4 log call for content-bearing fields; audit-event field list made normative (hardening request #6); foreign/probe 404s warn-logged (T-R-2).

- **T-R-2: 404 probing telemetry.** Foreign/missing delete/restore/edit/regenerate/export attempts warn-logged at `{userId, route, status}` — same phase-1 pattern, now covering five more routes where enumeration probing is meaningful.
  - likelihood: n/a; impact: low
  - mitigation: carry-over pattern; checklist item.

### Information Disclosure

- **T-I-1: Export row scoping — MEDIUM.** The json shape (US-403 AC.4) carries full row data of THIS conversation only. Threats: (a) messages query missing the `conversationId` filter (returns other conversations' rows into the file); (b) export resolving rows by id-set without the ownership predicate (subtree-id reuse across users); (c) md breadcrumb walking ancestors without per-iteration ownership checks (phase-1 TB invariant) — a foreign title would leak into a downloadable artifact. All are single-query-ownership carry-overs but the export path aggregates rows, so a scoping bug leaks in bulk.
  - likelihood: low; impact: **high** if it happens (bulk one-file cross-user leak)
  - mitigation: messages query `WHERE conversationId = :id AND conversation.userId = :session` (join-predicated, not two-step); breadcrumb walk verifies `userId` per iteration (phase-1 pattern); unit test: user B's messages never appear in user A's export; checklist gate.

- **T-I-2: Deleted-data visibility + deleted-ancestor breadcrumb leak — MEDIUM.** Two faces: (a) export/read of a soft-deleted conversation must 404 — "deleted" is a privacy promise; the rows persist until purge and remain fully intact, so any read-path miss exposes data the user believes is gone (covered by T-E-1's route table). (b) **Selective restore creates a new state combination:** delete leaf (batch L) → delete parent (batch P, live-only cascade excludes the leaf) → restore batch L → now a LIVE node has a DELETED ancestor. The spec's tree note (§5) covers a deleted ROOT, but a deleted MID-ancestor on a live node's chain is unspecified: the md export breadcrumb (and the phase-1 read-path ancestor-title fetch) must not leak the deleted ancestor's title into the artifact or the UI. It must behave like the existing missing/foreign-ancestor path (unavailable/"Private" crumb), not echo the title.
  - likelihood: medium (state combination is reachable by ordinary undo usage); impact: medium (leaks titles of content the user deleted, into an exported/shareable file)
  - mitigation: **hardening request #3** — define deleted-ancestor behavior normatively (treat as unavailable in breadcrumb + ancestor walk; no title echo); unit test: live-child-of-deleted-parent export omits/redacts the deleted crumb.

- **T-I-3: 404 byte-identical parity on all new routes — LOW.** Missing vs foreign (delete, restore, edit, regenerate, export) must produce identical bodies — enumeration guard, now on five routes. Edit's message-level miss (`messageId` from another conversation) is also 404 byte-identical (US-407 AC.1), which silently prevents cross-conversation message probing.
  - likelihood: low (pattern exists); impact: medium if violated (id enumeration)
  - mitigation: shared error serializer; Vitest parity assertions per route; checklist gate.

### Denial of Service

- **T-D-1: Mutation-bucket semantics + a spec number discrepancy — MEDIUM.** Spec architecture (§8.7): TWO buckets — (a) delete + restore share one 30/10min/user bucket; (b) edit + regenerate share the message-send LLM bucket. US-401 AC.8 says "combined delete + restore" and US-403's export is GET (un-rate-limited). The verification point: each pair must be ONE combined bucket, not per-route (delete and restore each getting 30/10min doubles the ceiling; edit and regenerate each getting their own doubles LLM spend). **Discrepancy:** §8.7 and US-407 AC.6 call the shared LLM bucket "30/10min/user", but the phase-0 message-send limit is 60/min + 500/hr — the numbers conflict. Which bucket edit/regenerate actually join (and at what numbers) must be pinned before audit can verify one-bucket semantics. Raised as **hardening request #1**.
  - likelihood: medium (drift between two buckets named "send"); impact: medium (2× cost amplification on LLM routes; misconfigured limits discovered only at audit)
  - mitigation: reconcile numbers (hardening #1); implementation uses a named bucket key shared by both routes; checklist gate asserts one key per pair.

- **T-D-2: Delete–restore ping-pong — MEDIUM.** Undo makes delete cheap to repeat: delete → restore → delete … each cycle is two mutations and one subtree UPDATE each way. The combined 30/10min delete/restore bucket bounds the cycle to ~15 full ping-pongs per 10 min per user; the cascade and restore are each single set-based UPDATEs (no per-row loops), so per-request cost stays flat regardless of subtree size. No LLM spend is involved.
  - likelihood: medium (misuse/automation); impact: low (bounded, own-data only)
  - mitigation: one-bucket semantics (T-D-1); set-based UPDATEs (audit greps for per-id loops); 429 with Retry-After per AC.8.

- **T-D-3: Export size unbounded — LOW (hardening).** An export is 8000 chars × N messages with NO size cap and NO rate limit (GET). Bounded only by the user's own data volume; not cross-user amplifiable. But a 10k-message conversation yields a multi-MB md/json body and full in-memory string assembly — serverless function memory/time exposure. Flag: cap the response (e.g. 10MB → 413 with a documented code) or document the expected ceiling. Raised as **hardening request #2**.
  - likelihood: low; impact: low (self-DoS; function-duration risk at extremes)
  - mitigation: hardening #2; single-query read (no N+1) as baseline.

- **T-D-4 (data-integrity adjacent): delete-while-streaming race — LOW.** AC.6's 409 check covers target AND every cascade-set id against the in-flight map. Residual: a TOCTOU window if the check runs outside the delete transaction and a send registers in-flight concurrently — a stream would write assistant tokens into a soft-deleted (invisible) row. Integrity-only: the row is unreachable by every route and purged in 30 days; no disclosure. Closing it fully means checking the in-flight map INSIDE the delete transaction. Raised as **hardening request #5**; accepted residual for phase 4.
  - likelihood: low; impact: low (invisible zombie row, auto-purged)
  - mitigation: hardening #5 ordering note; no user-visible impact path.

### Elevation of Privilege

- **T-E-1: Missed `deletedAt` filter on any route — HIGH.** Soft-delete is only as strong as its weakest route. The full route list and WHY each filter matters:

  | route | needs `deleted_at IS NULL` | why it matters if missed |
  |---|---|---|
  | `GET /api/chats` (list) | YES | deleted roots keep appearing — "delete" visibly does nothing |
  | `GET /api/chats/:id` | YES | read of "deleted" content (privacy promise broken) |
  | `GET /api/chats/:id/tree` | YES | deleted subtree exposed in the map; deleted ROOT must 404 the whole resolution (spec §5 note) |
  | `GET /api/chats/:id/export` | YES | **export bypass = bulk exfil of deleted data into a portable file** |
  | `POST /api/chats/:id/messages` (send) | YES | LLM token spend into deleted rows; writes into invisible conversations |
  | `POST /api/chats/:id/branch` | YES | **branch-on-deleted → orphan sub-chat** whose `parentId` points at a deleted row; its next send walks a deleted ancestor chain |
  | `POST .../messages/:messageId/edit` | YES | **resurrect-by-write**: edit persists + truncation mutates message history on a deleted conversation — data mutation the user believes is gone |
  | `POST .../messages/:messageId/regenerate` | YES | same class as edit (delete + re-stream inside a deleted conversation) |
  | `DELETE /api/chats/:id` | SPECIAL | target already soft-deleted → 404 (parity with missing; re-delete must not mint a second batch and split the undo set) |
  | `POST /api/chats/:id/restore` | SPECIAL (inverse) | requires `deleted_at != NULL`; not-deleted → 200 `{restoredCount: 0}` idempotent; foreign → 404 |

  Spec AC.5 (rev 2) covers all ten including branch/edit/regenerate with unit tests. The audit grep: every conversation-id resolution goes through one shared live-row lookup helper — no route hand-rolls its own WHERE.
  - likelihood: medium (ten routes, easy to cover the five original ones and forget the new three — precisely the rev-1 gap); impact: **high** (deleted data still readable, exportable, and writable)
  - mitigation: spec AC.5 + AC-P4-1; shared lookup helper (code-review gate); unit tests: branch-on-deleted → 404, edit-on-deleted → 404, regenerate-on-deleted → 404, export-on-deleted → 404; grep-verified checklist item.

- **T-E-2: Cross-user restore / foreign batch — HIGH if missed.** Restore is the one route whose primary key-ish input (`deleted_batch_id`) is a capability token. Attack: user A learns user B's conversation id (enumeration) and calls `POST /api/chats/:id/restore` — must 404 on the ownership check; even if the id check were bypassed, the restore UPDATE must be `WHERE deleted_batch_id = :batchId AND user_id = :userId` (spec §6.4) so a foreign batch can never resurrect another user's rows. A cross-user restore would silently resurrect B's deleted conversations into B's tree — an integrity violation invisible to B's expectations ("I deleted that"). Verified present in spec AC.7 + §6.4.
  - likelihood: low (single-query ownership pattern exists); impact: **high** (cross-user data resurrection; breaks the deletion promise for the victim)
  - mitigation: user_id predicate IN the UPDATE (not only the pre-check — defense in depth); batchId read from the target row only, never from the request; Vitest: B restores A's deleted conversation → 404 and A's row untouched; checklist gate.

- **T-E-3: CSRF on new mutation routes — MEDIUM.** DELETE (method-based mutation), restore, edit, regenerate are state-changing. Phase-0 posture: SameSite=Lax session cookie + JSON-only bodies (zod parsing rejects form submissions) carries over. Note: `DELETE /api/chats/:id` has no body at all — the JSON-only defense doesn't apply; SameSite=Lax is the sole CSRF line for it (Lax blocks cross-site POST/DELETE cookie attachment — sufficient, but the audit must confirm no `SameSite=None` drift and no cookie-less auth bypass).
  - likelihood: low (posture carried); impact: medium (attacker deletes victim's conversations cross-site)
  - mitigation: same middleware pattern as phases 0–3; audit confirms all four new POST routes parse JSON bodies and DELETE relies on SameSite=Lax; checklist gate.

- **T-E-4: (residual) zombie-write elevation** — see T-D-4; no privilege path, recorded for completeness.

### Data integrity (cross-cutting, not STRIDE-classed)

- **DI-1: Migration `0001` rollback + bootstrap parity.** First post-bootstrap migration: two additive columns + `deleted_batch_idx` + partial-index swap. Rollback documented in spec §6.5 (drop columns, drop live index, recreate original index) and must appear in the migration file comment (AC-P4-14). **Bootstrap parity:** dev environments bootstrapping from `drizzle/0000_init.sql` must end up with the same schema as migrated DBs — the spec does not state whether `0000` is regenerated to include the new columns or whether dev simply applies `0001` after bootstrap; drift between bootstrap and migrated schemas produces dev-only bugs that mask real filter bugs. Raised as **hardening request #4**.
- **DI-2: Edit truncation is destructive and unrecoverable (OQ-4 — accepted risk).** The transaction hard-DELETEs all messages after the edited one; regenerate hard-DELETEs the last assistant response. No message-level soft-delete, no undo (the conversation-level 5s undo does NOT cover message tails). Data loss is permanent and user-initiated; accepted and documented in spec §8.2 + decisions OQ-4. Recorded here as the model's accepted-risk entry so the audit does not "fix" it into scope creep.
- **DI-3: Live-only cascade (Reviewer fix #3).** The cascade UPDATE filters `deleted_at IS NULL` — a descendant separately deleted earlier keeps its original `deletedBatchId`, so restoring the parent does not resurrect it and restoring the leaf's own batch does. Missing this filter corrupts batch bookkeeping (restore overwrites another batch's marker → wrong undo sets). Unit test per US-403 AC.2b: delete leaf → delete parent → restore parent batch → leaf stays deleted; restore leaf batch → leaf returns.

---

## assumptions

1. Phase-0 `requireAuth()` + per-user rate-limit helpers reused on all five new routes (verified pattern phases 0–3).
2. SameSite=Lax session cookie posture carries over (CSRF baseline for T-E-3).
3. Soft-deleted rows are physically intact until purge — the 30-day purge cron is out of scope (§11) and its eventual implementation re-opens this model (hard DELETE + purge = permanent revocation with new edge cases: purging a batch mid-restore).
4. The in-flight stream map (phase-0) is the single source of truth for 409 STREAM_ACTIVE checks, including descendants (AC.6).
5. Phase-1 ancestor-walk ownership checks (per-iteration `userId`) carry to the export breadcrumb walk.
6. The message hard-DELETE in edit/regenerate (Drizzle `.delete()` on `messages`) is the ONLY hard-delete in phase-4 code (US-401 AC.9 bans conversation hard-DELETE).

---

## out of scope (phase 4)

Per spec §11: optimistic rendering, branch-on-edit, message-level soft-delete/undo, regeneration history, purge cron, trash UI, whole-tree export, cross-root search, configurable shortcuts. Not modeled: phase 0–3 surfaces (baseline carries), shortcut-overlay a11y (no security surface), tree search (client-only, zero network — no new attack surface; the search input renders already-fetched own data as React text).

---

## residual risk

| risk | likelihood | impact | decision |
|---|---|---|---|
| T-D-4 delete-vs-stream-start TOCTOU → zombie writes into soft-deleted row | low | low | **accept** — invisible row, 30-day purge bounds it; ordering note raised (hardening #5) |
| T-I-2b live-node-with-deleted-ancestor title leak in breadcrumb/export | medium | medium | **mitigate** — hardening #3 pins the behavior; blocking at audit until defined + tested |
| DI-2 edit/regenerate truncation permanently destroys message tail | certain (by design) | medium (user data) | **accept (documented, OQ-4)** — conversation-level undo is the only safety net; UI copy must state permanence |
| T-D-3 export size unbounded | low | low | **accept for phase 4** — hardening #2 (cap or documented limit) |
| T-D-1 bucket-number discrepancy (30/10min vs 60/min+500/hr) | n/a until resolved | medium | **open** — hardening #1 must be resolved before code audit can verify buckets |

No critical residual if T-E-1's route table is grep-verified and T-E-2's user-scoped UPDATE is unit-tested.

---

## OWASP Top 10 (2025) mapping

| OWASP | threats | coverage |
|---|---|---|
| A01 Broken Access Control | T-E-1, T-E-2, T-S-1 | shared live-row lookup + 404 parity + user-scoped restore UPDATE + Vitest |
| A03 Injection | T-T-1, T-T-2, T-T-4 | md fence-escaping, filename sanitization, Drizzle parameterization |
| A04 Insecure Design | T-D-4, DI-1, DI-2, DI-3 | live-only cascade, batch bookkeeping, accepted destructive-truncation risk |
| A05 Security Misconfiguration | T-D-1 | one-bucket rate-limit semantics (numbers to be pinned, hardening #1) |
| A07 Identification/Auth Failures | (inherited) | requireAuth carry-over on all five routes |
| A08 Software/Data Integrity Failures | DI-1, DI-3 | migration rollback + bootstrap parity; live-only cascade filter |
| A09 Logging & Monitoring | T-R-1, T-R-2 | audit events without content; 404 probing telemetry |
| A10 SSRF | (none new) | no new server-side fetch targets in phase 4; phase-3 baseline carries |

---

## spec hardening requests (to PM / Orchestrator / Backend)

1. **Reconcile rate-limit bucket numbers (T-D-1):** §8.7 + US-407 AC.6 say edit/regenerate share "the message-send LLM bucket (30/10min/user)" but the phase-0 send limit is 60/min + 500/hr. Pin the authoritative bucket name + numbers for (a) delete+restore and (b) edit+regenerate, so the audit can verify one-bucket (not per-route) semantics.
2. **Export size cap (T-D-3):** cap the md/json response (e.g. 10MB → 413 with documented code) or document the expected ceiling; export is an un-rate-limited GET doing full in-memory assembly.
3. **Deleted-ancestor behavior (T-I-2):** define normatively how export breadcrumb + read-path ancestor-title fetch treat a DELETED ancestor on a LIVE node's chain (reachable via selective restore): treat as unavailable/"Private" (no title echo), consistent with the missing-ancestor path. Unit test required.
4. **Bootstrap SQL parity (DI-1):** state whether `drizzle/0000_init.sql` is regenerated to include `deleted_at`/`deleted_batch_id` or whether dev applies `0001` post-bootstrap; prevent bootstrap-vs-migrated schema drift in dev.
5. **Delete/stream race ordering (T-D-4):** perform the 409 in-flight-map check INSIDE the delete transaction (or re-check after acquiring the id set) to close the stream-start race; document the chosen ordering.
6. **Audit-event field list (T-R-1):** make normative: delete `{userId, conversationId, batchId, deletedCount}`; restore `{userId, conversationId, batchId, restoredCount}`; edit/regenerate `{userId, conversationId, messageId}` — never content, never titles, never edited text.
7. **CI grep gate (US-401 AC.9):** forbid hard `DELETE FROM conversations` / Drizzle `.delete()` on the conversations table in phase-4 code (messages-table truncate paths excepted) — same gate pattern as the rehype-raw gate.

---

## sign-off

- reviewed by: security (GLM 5.3 Flash tier)
- date: 2026-09-14
- status: **needs-mitigation** (audit pending code review; hardening #1 and #3 are audit-blocking gates; #2, #4–#7 recommended pre-build)
- blocking findings: 0 (pre-build; T-D-1 reconciliation and T-I-2 deleted-ancestor behavior are conditional blockers at audit)
- hardening requests: 7
