# Security Checklist (running tracker)

**phase:** 0 + 1 + 2 + 3 + 4 + 5 (final)
**last_updated:** 2026-09-14
**reviewer:** security

Format: `[x]` = done, `[~]` = in progress / partial, `[ ]` = pending / not started, `[N/A]` = not applicable in this phase.

---

## phase 0

### threat modeling
- [x] STRIDE model complete (`.orchestrator/security/threat-models/phase-0.md`)
- [x] OWASP Top 10 (2025) mapping included
- [x] Spec hardening requests raised (9 items)
- [ ] Code audit pending (Backend + Frontend delivery)
- [~] Spec hardening items resolved or accepted by Orchestrator (most resolved in phase 1 implementation; formal sign-off pending)

### authentication
- [x] bcrypt cost = 12 (verify `bcrypt.hash(password, 12)` in signup)
- [x] `passwordHash` column never returned in any JSON response (code review)
- [x] `authorize()` returns explicit allowlist of session fields (no spread)
- [x] Sign-in rate limit: 5 attempts / 15 min / IP, in-memory token bucket — **wired to signInAction (src/lib/api-client/auth.ts)**
- [x] Sign-in error message identical for wrong-email vs wrong-password (T-S-1)
- [x] Cross-user chat access returns **404** (not 403) on `GET /api/chats/:id` (T-E-1)
- [x] Cross-user message POST returns 404 (T-E-2)
- [x] `callbackUrl` off-origin rejected (T-S-2)
- [x] Auth.js `debug: false` in prod (T-I-11)
- [x] `AUTH_SECRET` is 32-byte base64 (verify `.env.example` comment)

### session cookies
- [ ] HttpOnly flag set
- [ ] Secure flag set in prod (dev OK on http://localhost)
- [ ] SameSite=Lax (not Strict — needed for future OAuth callback)
- [ ] `__Secure-` prefix where applicable
- [ ] Cookie name not leaked to logs (pino redact)

### API surface
- [x] `requireAuth()` helper used at top of every authenticated route (T-E-3, T-E-4)
- [x] `userId` always from session, never from body/query (T-S-5, T-E-6)
- [x] `model` and `providerId` set server-side from `getActiveProvider()` (T-E-5)
- [x] Zod `.strict()` on all POST bodies (rejects unknown fields → T-T-7)
- [x] Zod `.max(8000)` on message `content` (T-D-5)
- [~] `Content-Length` cap at edge (16KB) — **spec hardening needed, deferred to phase 1**
- [x] Per-user rate limit on `/api/chats/:id/messages` (60/min + 500/hr) — **wired in src/lib/auth/rate-limit.ts + messages route**

### AI integration
- [x] `OPENAI_API_KEY` never logged (T-I-2)
- [x] `getActiveProvider()` runs once at module init, result cached
- [x] Ollama probe 2s timeout enforced (no boot hang)
- [x] Provider errors caught, full body logged internally, friendly message returned (T-I-4)
- [x] `streamText` `abortSignal` enforced (30s per-token)
- [x] Partial assistant message persisted on stream error
- [x] SSE response has `Cache-Control: no-store` (T-I-8)
- [x] SSE response has `X-Content-Type-Options: nosniff`
- [x] SSE response has `X-Accel-Buffering: no`
- [~] Max stream duration cap (5 min) enforced — **spec hardening needed, deferred to phase 1**

### database
- [x] Drizzle uses parameterized queries (no `sql\`\`` outside migrations)
- [x] `passwordHash` stored as bcrypt output, never plaintext
- [x] `userId` foreign keys `ON DELETE CASCADE` (or equivalent) for cleanup
- [x] No raw user input concatenated into SQL anywhere

### data at rest
- [ ] Passwords: bcrypt cost 12
- [ ] `apiKeyCiphertext` schema column exists (no rows in phase 0) — phase 3 will wire encryption
- [ ] `AUTH_SECRET` not committed to repo (verify `.gitignore` covers `.env`)
- [ ] DB file permissions: dev SQLite file is gitignored

### security headers & transport
- [x] `secureHeaders` middleware applies to all routes (see `src/middleware.ts`)
- [x] CSP: `default-src 'self'; connect-src 'self' https://api.openai.com http://localhost:11434; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'`
- [x] `X-Frame-Options: DENY`
- [x] `X-Content-Type-Options: nosniff`
- [x] `Referrer-Policy: strict-origin-when-cross-origin`
- [x] `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- [~] HSTS in prod (phase 1, not phase 0 dev)
- [x] CORS: same-origin only (no `Access-Control-Allow-Origin: *`)

### error handling
- [ ] Production error responses never include stack traces (T-I-3)
- [ ] Generic `{error: {code, message}}` shape consistent across routes
- [ ] Caught errors logged via pino `error` level with correlation id (T-R-2)

### logging & monitoring
- [x] pino logger configured with `redact: ['*.email', '*.passwordHash', '*.OPENAI_API_KEY', 'req.headers.cookie', 'req.headers.authorization', 'res.headers']` — **wired in src/lib/log.ts**
- [x] Message content NOT logged (T-I-6)
- [x] Auth events logged: signup success, signin success/failure, signout (T-R-1)
- [~] Structured logs include `requestId`, `userId?`, `route`, `status`, `durationMs` — **partial; full per-request log helper is phase 1**
- [x] No `console.log` in production code (only pino)

### dependency audit
- [ ] `npm audit` — note current state (cannot run without `node_modules`; document blocker in audit)
- [ ] No known-critical CVEs in direct deps (`next-auth@5.0.0-beta.25` flagged as beta — accept risk and pin)
- [ ] `next`, `drizzle-orm`, `@ai-sdk/*` on latest stable at build time

### tests
- [ ] Playwright: signup → new chat → send → reload → see messages (AC-P0-10)
- [ ] Playwright: cross-user 404 (Phase 0 DoD)
- [ ] Playwright: sign-in rate limit triggers after 5 failures (Phase 0 DoD)
- [ ] Vitest: provider resolution (OpenAI / Ollama / none) (Phase 0 DoD)
- [ ] Vitest: **cross-user 404** (not 403) — recommended addition (spec hardening #7)
- [ ] Vitest: **callbackUrl off-origin 400** — recommended addition (spec hardening #8)

### sign-off gates
- [ ] STRIDE model approved by Orchestrator
- [ ] Spec hardening requests resolved or formally accepted
- [ ] Code audit complete (after Backend + Frontend delivery)
- [ ] No `high` or `critical` findings open
- [ ] Reviewed by Critic (Muse Spark)
- [ ] Phase 0 marked `secure` in `.orchestrator/STATE.md`

---

## phase 1

### threat modeling
- [x] STRIDE model complete (`.orchestrator/security/threat-models/phase-1.md`)
- [x] OWASP Top 10 (2025) mapping included
- [x] Spec hardening requests raised (12 items; top 3 recommended for sign-off)
- [ ] Code audit pending (Backend + Frontend delivery)
- [ ] Spec hardening items resolved or accepted by Orchestrator

### sub-chat auth & access control
- [ ] Sub-chat ownership check uses `sub.userId` (NOT `parent.userId`) on every route
- [ ] `POST /api/chats/:id/branch` ownership check filters by `userId=session.user.id`; cross-user returns 404 NOT_FOUND (NOT 403)
- [ ] `GET /api/chats/:id` returns 404 for foreign-owned conversation
- [ ] `POST /api/chats/:id/messages` returns 404 for foreign-owned conversation
- [ ] Ancestor walk verifies `cursor.userId === session.user.id` on EVERY iteration; first miss throws 503 ANCESTOR_UNAVAILABLE
- [ ] 503 ANCESTOR_UNAVAILABLE returned for BOTH foreign-owned AND missing ancestors (same code — no leak)
- [ ] `parentTitle`/`rootTitle` lookup in `GET /api/chats/:id` filtered by `userId === session.user.id`; null on miss
- [ ] Foreign-owned ancestor crumb renders "Private" with no link (Frontend US-107 AC.3)
- [ ] Breadcrumb full chain title fetch: API returns `ancestorTitles: [{id, title, depth}]` for depth ≥ 3 (US-108 AC.3, T-D-5 spec hardening #2)

### sub-chat input validation (T-S, T-T)
- [ ] Branch body Zod `.strict()` with EXACTLY 5 fields (messageId, selectedText, charStart, charEnd, clientHighlightContext?); rejects `parentId`, `userId`, `rootConversationId`, `depth`, `createdAt`
- [ ] `selectedText` 1-2000 chars enforced; `.refine(s => s.trim().length > 0)` rejects whitespace-only
- [ ] `charStart` and `charEnd` parsed as `z.number().int().nonnegative()`; range check `0 ≤ charStart < charEnd ≤ message.content.length`
- [ ] Slice validation: `content.slice(charStart, charEnd).trim() === selectedText.trim()` enforced; 422 INVALID_SELECTION on mismatch
- [ ] `messageId` filtered by `conversationId = :id AND role = 'assistant'`; 422 INVALID_SELECTION on miss
- [ ] `clientHighlightContext` ≤ 500 chars enforced (Zod `.max(500)`)
- [ ] `highlightContext` (server-computed) falls back to full content (truncated to 500 chars) when regex finds no sentence terminators (T-T-9)
- [ ] 422 INVALID_SELECTION response `fields` contains ONLY field name + static message — NEVER user-supplied value (T-I-3)

### server-side computed values (T-S, T-E)
- [ ] `parentId` set server-side as `= :id` (NOT from body)
- [ ] `rootConversationId` derived as `= source.rootConversationId ?? source.id` (NOT from body)
- [ ] `depth` set as `= source.depth + 1` (NOT from body)
- [ ] `userId` always `= session.user.id` (NOT from body)
- [ ] `title = 'New chat'` on creation; auto-derive on first user message (Q2)
- [ ] Title auto-derive: split on whitespace, take first 6 tokens, max 60 chars total; no HTML
- [ ] System note uses `process.env.SUBSCHAT_SYSTEM_PROMPT` env var with default (Q11); placeholder substitution `{parentTitle}` and `{highlightText}`

### ancestor walk (T-E-2, T-E-7, T-D-2)
- [ ] Ancestor walk ownership check on EVERY iteration (not just direct parent)
- [ ] **Ancestor walk implemented as batched fetch or recursive CTE** (NOT sequential `db.conversations.get(parentId)`) — spec hardening #1
- [ ] Message batched fetch `listByConversationIds(ancestorIds + [targetId])` returns messages ordered correctly
- [ ] On foreign-owned or missing ancestor: 503 ANCESTOR_UNAVAILABLE; user message is STILL persisted (per US-105 AC.6)
- [ ] System note prepended to model context ONLY — NOT persisted to `messages` table
- [ ] New user message persists on sub-chat only (`conversationId = subChat.id`), NOT on any ancestor

### info disclosure (T-I)
- [ ] `highlightText`, `parentTitle`, `rootTitle`, `highlightContext`, `selectedText`, `clientHighlightContext` rendered as React text child ONLY (no `dangerouslySetInnerHTML`)
- [ ] Highlight rendering: source message split into 3 text segments (before / `<mark>{highlightText}</mark>` / after); each rendered via React text child
- [ ] Breadcrumb timing: all ancestor titles fetched in single query (or batched) — not sequential (T-I-2)
- [ ] Cross-user 404 on branch route — never 403
- [ ] Conversation list (`GET /api/chats`) filters `parentId IS NULL` — root only; sub-chats not listed as siblings (T-I-10)

### DoS / cost (T-D)
- [ ] Branch rate limit: 30 / 10 min / user, in-memory token bucket; 429 with `X-RateLimit-Limit/Remaining/Reset` and `Retry-After` headers
- [ ] Phase 0 message rate limit (60/min/user) applies to sub-chat conversations
- [ ] Selection event listener debounced 50ms (Q10, T-D-4)
- [ ] Pill positioning uses `requestAnimationFrame` on scroll (T-D-8)
- [ ] `Content-Length` cap (16KB) from phase 0 hardening applies to `/api/chats/:id/branch`
- [ ] Right-click menu position flips + clamps on viewport overflow (US-102 AC.5)

### schema (T-T-11)
- [ ] `parentId` has FK constraint `.references(() => conversations.id)` per Q7 (verify in `src/lib/db/schema.ts:80` and Drizzle migration)
- [ ] FK migration safe in dev (NULL allowed, no orphan rows) and prod (verify no orphan rows before apply)

### logging & monitoring (T-R, T-I-8)
- [ ] Pino redact extended: `*.selectedText`, `*.highlightText`, `*.highlightContext`, `*.clientHighlightContext` added to redact list
- [ ] Branch events logged at `info` (201 success), `warn` (404 cross-user, 503 ANCESTOR_UNAVAILABLE), `info` (422 INVALID_SELECTION)
- [ ] Never log `selectedText`, `clientHighlightContext`, `highlightContext`, or `message.content` content (only metadata)
- [ ] All branch log lines include `userId`, `sourceConvId`, `newConvId?`, `depth`, `requestId`

### tests (spec §11 DoD + recommended additions)
- [ ] Vitest: cross-user 404 (not 403) on `POST /api/chats/:id/branch` (T-E-1)
- [ ] Vitest: foreign-owned ancestor returns 503 ANCESTOR_UNAVAILABLE (T-E-2)
- [ ] Vitest: foreign-owned ancestor returns SAME 503 code as missing ancestor (T-I-1, T-I-6)
- [ ] Vitest: `messageId` from different conversation returns 422 (T-S-2)
- [ ] Vitest: `selectedText` whitespace-only returns 422 (T-T-7)
- [ ] Vitest: charStart/charEnd out-of-bounds returns 422 (T-T-5)
- [ ] Vitest: slice mismatch returns 422 (T-S-3)
- [ ] Vitest: highlightContext fallback for no-terminator message (T-T-9)
- [ ] Vitest: title auto-derive (6 words max, 60 chars max, no HTML)
- [ ] Vitest: branch body `.strict()` rejects unknown fields (`parentId`, `userId`, etc.)
- [ ] Vitest: ancestor walk returns messages in correct order (root → ... → parent → target)
- [ ] Vitest: system note template substitution with `{parentTitle}` and `{highlightText}` defaults
- [ ] Playwright: select text → branch → sub-chat shows banner → send message → AI persists on sub-chat only
- [ ] Playwright: cross-user 404 on `POST /api/chats/:id/branch`
- [ ] Playwright: cross-user 404 on `GET /c/<other-user-sub-chat>`
- [ ] Playwright: sub-chat can spawn sub-chat (depth ≥ 2)
- [ ] Playwright: breadcrumb renders full chain at depth ≥ 3 (validates T-D-5 spec hardening)
- [ ] Playwright: foreign-owned ancestor shows "Private" crumb (no leak)

### sign-off gates
- [ ] STRIDE model approved by Orchestrator
- [ ] Spec hardening requests #1, #2, #3 (top 3 from threat-model) resolved or accepted
- [ ] Code audit complete (after Backend + Frontend delivery)
- [ ] No `high` or `critical` findings open
- [ ] Reviewed by Critic (Muse Spark)
- [ ] Phase 1 marked `secure` in `.orchestrator/STATE.md`

---

## phase 2

### threat modeling
- [x] STRIDE model complete (`.orchestrator/security/threat-models/phase-2.md`) — extends phase-1 baseline
- [x] OWASP Top 10 (2025) mapping included
- [x] Spec hardening requests raised (8 items; #1–#6 recommended pre-build)
- [ ] Code audit pending (`.orchestrator/security/audits/phase-2.md` — after Backend + Frontend delivery)
- [ ] Spec hardening items resolved or accepted by Orchestrator

### tree endpoint — access control (T-I-1, T-I-2, T-E-1)
- [ ] `GET /api/chats/:id/tree` ownership enforced on `:id` via single-query check (`id` + `userId`), 404 NOT_FOUND for missing AND foreign (byte-identical, ≤50ms delta)
- [ ] Subtree query filters BOTH `rootConversationId` AND `userId` — ownership is in SQL, not just a JS post-filter
- [ ] Root node picked from WITHIN the `userId`-filtered rows; filtered-set miss → 404
- [ ] Foreign descendant injected under a user's root cannot appear in the response (Vitest)

### tree endpoint — DoS (T-D-1, T-D-2)
- [ ] 500-node cap applied during in-memory DFS assembly (fetch does not load full subtree then slice)
- [ ] `totalNodes` computed via aggregate count (`count(*)` / index-only) with the SAME `userId` filter — never `rows.length` of full fetch

### split view (T-T-3, T-D-3, T-D-4)
- [ ] Per-pane 404 (foreign/deleted secondary id) → terminal error state, no crash, no retry loop
- [ ] One pane's failure never unmounts or errors the other pane (US-204 AC.7)
- [ ] Message rate-limit key remains per-USER across both panes (split cannot double the per-user ceiling)
- [ ] Tree refetch trigger fires on branch-success only (no fetch→trigger→fetch loop)
- [ ] Per-pane SSE clients instance-scoped; closing a pane aborts only its stream

### XSS surface (T-T-1, T-T-2)
- [ ] Zero `dangerouslySetInnerHTML` in phase-2 components (TreeNode SVG labels, tooltip, picker)
- [ ] Node titles / tooltip content / picker items rendered as React text children only

### API surface
- [ ] No new mutation endpoints (read-only phase; CSRF surface unchanged)
- [ ] Tree payload contains ONLY `{id, title, depth, highlightText, createdAt, children}` (+ root/currentId/totalNodes/truncated envelope) — no userId, email, highlightContext

### tests (audit gates)
- [ ] Vitest: subtree query excludes foreign-owned rows even when linked under a user's root (T-I-1)
- [ ] Vitest: foreign-owned root resolution → 404 (T-I-2)
- [ ] Vitest: `totalNodes` = count of user's own subtree rows (T-I-3)
- [ ] Playwright: cross-user 404 on tree endpoint (AC-P2-15)
- [ ] Playwright: crafted foreign secondaryId → pane shows error, both panes survive

### sign-off gates
- [ ] STRIDE model approved by Orchestrator
- [ ] Spec hardening items resolved or accepted
- [ ] Code audit complete
- [ ] No `high` or `critical` findings open
- [ ] Reviewed by Critic (Muse Spark)
- [ ] Phase 2 marked `secure` in `.orchestrator/STATE.md`

---

## phase 3

### threat modeling
- [x] STRIDE model complete (`.orchestrator/security/threat-models/phase-3.md`) — extends phase-2 baseline
- [x] OWASP Top 10 (2025) mapping included
- [x] Spec hardening requests raised (8 items; #1 redirect policy + #6 resolved-addresses are audit-blocking gates)
- [ ] Code audit pending (`.orchestrator/security/audits/phase-3.md` — after Backend + Frontend delivery)
- [ ] Spec hardening items resolved or accepted by Orchestrator

### key material at rest / in transit (T-I-1..4, T-T-3, T-T-4)
- [ ] ENCRYPTION_KEY or HKDF(AUTH_SECRET) — key never logged, never in client (raw AUTH_SECRET never used as AES key)
- [ ] GCM auth tag verified on every decrypt; tamper → hard fail (throw, never fallback plaintext)
- [ ] IV random 12 bytes per encryption (never reused, never derived; two encryptions → different IVs)
- [ ] Tamper-rejection unit tests: round-trip, flip-one-byte → throws, wrong key → throws, malformed envelope → throws
- [ ] Missing key env at runtime → 500 on key-storing create, never plaintext fallback
- [ ] Decrypted key held only for provider construction duration — no module-level plaintext-key cache

### key material in responses / logs / client (T-I-1, T-I-2, T-I-3)
- [ ] GET /api/providers (and ALL routes): masked hint only; ciphertext NEVER in any response
- [ ] Shared whitelist serializer row → {id, type, baseUrl, defaultModel, isDefault, apiKeyHint, createdAt} on every route
- [ ] pino redact extended BEFORE provider code logs: `*.apiKey`, `*.apiKeyCiphertext`, `*.ANTHROPIC_API_KEY`, `*.ENCRYPTION_KEY`
- [ ] Decrypt-error logs carry providerId + error class only — no ciphertext blob, no plaintext, no raw thrown strings
- [ ] Settings page fetches via GET /api/providers — NO server-component DB reads of `providers` (ciphertext out of RSC payload)
- [ ] Keys never in URLs (POST bodies only); HTTPS only (Vercel default)

### SSRF (T-I-5, T-E-2, T-E-3)
- [ ] SSRF: scheme allowlist + private-IP denylist (custom) at create/update/send-time; ollama exemption documented
- [ ] Denylist check resolves hostname (A + AAAA, ALL records) and compares resolved IPs — no hostname string matching (blocks 0x7f000001, IPv4-mapped IPv6, multi-record)
- [ ] Provider fetch: redirects manual or re-validated (Backend to confirm — **conditional blocker** at audit)
- [ ] Ollama exemption accept-risk documented; `ADMIN_ALLOW_OLLAMA_USERS` prod kill-switch (hardening #2)
- [ ] Upstream provider error bodies not reflected verbatim to user beyond streamed model output (T-I-5a)

### markdown XSS (T-T-1, T-T-2)
- [ ] Markdown: NO rehype-raw, NO dangerouslySetInnerHTML (grep gate in CI)
- [ ] Default `urlTransform` untouched; javascript:/data: URIs in AI output neutralized (verify react-markdown default)
- [ ] Links: target=_blank rel=noopener noreferrer + underline (non-color cue); images render as links (no `<img>`)
- [ ] User messages render as plain text (no markdown parsing)
- [ ] Raw-HTML-renders-as-text e2e fixture (AC-P3-14) exists and passes

### audit & abuse (T-R-1, T-D-1, T-D-2, T-E-1, T-E-4)
- [ ] Provider CRUD audit-logged (create/update/delete/set-default with userId + providerId + type — no key material)
- [ ] Foreign PUT/DELETE 404 warn-logged; 404 byte-identical to missing-id (single-query ownership, T-E-1)
- [ ] 10-provider cap + 30/10min rate limit active (COMBINED across POST+PUT+DELETE — one bucket)
- [ ] Message-send rate limit provider-agnostic (custom providers cannot bypass 60/min + 500/hr)
- [ ] `abortSignal` reaches streamText for user-provider streams (no provider-specific branching, US-305 AC.3)
- [ ] CSRF posture carried to the four new mutation routes (JSON-only bodies, SameSite=Lax)
- [ ] Resolution per-request; module-init resolution removed; corrupt ciphertext → env fallback, no crash

### tests & audit gates
- [ ] Vitest: encryption round-trip/tamper/wrong-key/IV-uniqueness; mask-leak guard (no ciphertext/plaintext in any response body)
- [ ] Vitest: SSRF guard (private-IP custom rejected, public accepted, ollama-localhost accepted, non-http(s) rejected, send-time re-validation) — AC-P3-12
- [ ] Vitest: cross-user PUT/DELETE → 404; resolution precedence + chain order (AC-P3-12)
- [ ] Playwright: add → default → send (providerId verified) → delete → env fallback; keyboard-only add-provider (AC-P3-13)
- [ ] `pnpm audit` clean or risks documented; NO new dependencies (AC-P3-15)

### sign-off gates
- [ ] Conditional blocker resolved: provider-fetch redirect policy confirmed + fixed (T-I-5c)
- [ ] STRIDE model approved by Orchestrator
- [ ] Spec hardening items resolved or accepted
- [ ] Code audit complete
- [ ] No `high` or `critical` findings open
- [ ] Reviewed by Critic (Muse Spark)
- [ ] Phase 3 marked `secure` in `.orchestrator/STATE.md`

---

## phase 4

### threat modeling
- [x] STRIDE model complete (`.orchestrator/security/threat-models/phase-4.md`) — extends phase-3 baseline
- [x] OWASP Top 10 (2025) mapping included
- [x] Spec hardening requests raised (7 items; #1 rate-limit reconciliation + #3 deleted-ancestor behavior are audit-blocking gates)
- [ ] Code audit pending (`.orchestrator/security/audits/phase-4.md` — after Backend + Frontend delivery)
- [ ] Spec hardening items resolved or accepted by Orchestrator

### access control — soft delete as revocation surface (T-E-1, T-E-2)
- [ ] deletedAt filter on ALL conversation-id routes (list/read/tree/export/send/branch/edit/regenerate) — grep-verified via one shared live-row lookup helper; branch-on-deleted → 404 (orphan guard), edit-on-deleted → 404 (resurrect-by-write guard), regenerate-on-deleted → 404 (unit tests per US-401 AC.5)
- [ ] Delete-on-already-deleted → 404 (no second batch minted, undo set not split)
- [ ] Restore scoped by user_id + batch_id (UPDATE predicate includes `user_id = :userId`, not only the pre-check — no cross-user restore); batchId read from the target row's own `deleted_batch_id`, never from the request
- [ ] Restore idempotent: not-deleted → 200 `{restoredCount: 0}`; cross-user restore → 404 byte-identical (Vitest)
- [ ] Cascade UPDATE filters `deleted_at IS NULL` (live-only, no batch overwrite — US-403 AC.2b nested-batch integrity test passes)
- [ ] Delete 409 STREAM_ACTIVE covers target AND every descendant in the cascade set (AC.6)
- [ ] 404 byte-identical parity (missing vs foreign) on all five new routes, incl. edit's cross-conversation messageId (T-I-3)
- [ ] NO hard DELETE on `conversations` anywhere (grep gate, US-401 AC.9)

### export (T-T-1, T-T-2, T-I-1)
- [ ] Export ownership 404; messages query join-predicated on owner — no other rows/other users in json (Vitest: B's messages never in A's export)
- [ ] json shape exactly per US-403 AC.4 — no key material, no cross-user data
- [ ] MD export escaping: `#`/`---`/fence-leading content fence-wrapped, inner fences lengthened; adversarial fixture passes (US-403 AC.3)
- [ ] MD breadcrumb shows ONLY own ancestor titles; deleted-ancestor-on-live-chain handled per hardening #3 (no title leak)
- [ ] Filename slug sanitization: strip CR/LF/`"`/`\`/C0-C1 control chars, ≤ 60 chars, RFC 5987 non-ASCII; no raw title in any header (header-injection unit tests: CRLF/quote/control/unicode)
- [ ] Export size cap (e.g. 10MB → 413) or documented limit (hardening #2); single-query read, no N+1

### edit / regenerate (T-T-3, DI-2)
- [ ] Edit content validation = send validation (shared zod `.strict()`, 1..8000; 8001/empty/unknown-field → 422)
- [ ] Edit: user-role only (422 NOT_EDITABLE); transactional truncate + re-stream; ancestor walk sees edited content (unit test)
- [ ] Regenerate: last-assistant-only (422 otherwise); target deleted + re-stream, fresh provider resolution persisted
- [ ] 409 STREAM_ACTIVE on both; destructive ops never abort-then-proceed (§8.6)
- [ ] Edit truncation destructive/unrecoverable accepted as documented risk (OQ-4); UI copy states permanence

### DoS / abuse (T-D-1, T-D-2)
- [ ] Shared mutation rate limit: delete + restore ONE bucket (30/10min/user), 429 + Retry-After + X-RateLimit-* — not per-route
- [ ] Edit + regenerate share ONE LLM bucket with send — bucket numbers pinned per hardening #1 (reconcile 30/10min vs 60/min+500/hr discrepancy)
- [ ] Cascade + restore are set-based UPDATEs (no per-id loops — ping-pong cost flat)

### audit logging (T-R-1, T-R-2)
- [ ] Delete/restore/edit/regenerate audit events logged (delete: userId + conversationId + batchId + deletedCount; restore: + restoredCount; edit/regenerate: userId + conversationId + messageId) — NO message content, NO titles, NO edited text
- [ ] Grep every phase-4 log call for content-bearing fields (`content`, `title`, `highlightText`) — redact is pattern-based, ad-hoc field names slip through
- [ ] Foreign/missing 404s on the five new routes warn-logged

### schema / migration (DI-1, DI-3)
- [ ] Migration `0001` = deleted_at + deleted_batch_id + deleted_batch_idx + partial live-index swap; rollback documented in the migration file comment; applies to fresh AND data-carrying DBs (AC-P4-14)
- [ ] Bootstrap SQL parity for dev (0000 regenerated vs post-bootstrap 0001 — documented per hardening #4)
- [ ] Delete/stream-start race closed (in-flight check inside the transaction, hardening #5) or residual documented

### XSS / CSRF carry-over
- [ ] Zero `dangerouslySetInnerHTML` in new components (grep gate); edit content renders via the same markdown pipeline; user messages stay plain text
- [ ] CSRF posture on new POST routes (JSON-only zod bodies); `DELETE /api/chats/:id` (no body) relies on SameSite=Lax — no SameSite drift
- [ ] Delete control hidden for non-owned conversations (US-402 AC.7, defense-in-depth)

### tests & audit gates
- [ ] Vitest: read-path 404s on deleted ids (all routes incl. branch/edit/regenerate), restore idempotence + cross-user 404, nested-batch integrity, export fixtures (adversarial md + header injection), edit validation parity, regenerate guard, export row scoping
- [ ] `pnpm audit` clean or risks documented; NO new dependencies (AC-P4-12)

### sign-off gates
- [ ] Conditional blockers resolved: rate-limit bucket reconciliation (hardening #1) + deleted-ancestor behavior (hardening #3)
- [ ] STRIDE model approved by Orchestrator
- [ ] Spec hardening items resolved or accepted
- [ ] Code audit complete
- [ ] No `high` or `critical` findings open
- [ ] Reviewed by Critic (Muse Spark)
- [ ] Phase 4 marked `secure` in `.orchestrator/STATE.md`

---

## phase-by-phase tracker

| phase | threat model | checklist | audit | sign-off |
|---|---|---|---|---|
| 0    | done (preliminary) | this file | closed via final sweep | pending |
| 1    | done (preliminary) | this file | closed via final sweep | pending |
| 2    | done (preliminary) | this file | closed via final sweep | pending |
| 3    | done (preliminary) | this file | closed via final sweep | pending |
| 4    | done (preliminary) | this file | closed via final sweep | pending |
| 5    | done (consolidated) | this file | done (`audits/phase-5.md`, 32 checks) | done (**approved with conditions**, `handoffs/security-phase-5.md`) |

---

## known open issues

- `npm audit` cannot run until `node_modules` exists (Backend / DevOps concern)
- `next-auth@5.0.0-beta.25` is a pre-release — accept risk, document pin
- `pino-pretty` is a dev dep — confirm not in production bundle (Backend)
- Anthropic SDK present but unwired (per spec §9 decision #10) — no threat model entry needed
- **phase 1 spec hardening items**:
  - #1 ancestor walk batched fetch — pending Orchestrator / Backend decision
  - #2 breadcrumb `ancestorTitles` field — pending Orchestrator / Backend decision
  - #3 pino redact extended — pending Backend decision
  - remaining hardening items (#4–#12) — pending code-review-time decisions
- Phase 1 FK migration safety: verify no orphan rows in prod before applying Q7 FK constraint

---

## phase 5 (final production sweep)

### prod gates (spec §4 / AC.14–17)
- [x] `npm audit --omit=dev` documented: 0 critical, 2 high (postcss/next, jsondiffpatch/ai — build-time, accepted AR-4), 2 moderate, 5 low (`.orchestrator/security/audits/phase-5.md` §2)
- [ ] HSTS in prod (`next.config.ts` conditional on deploy env) — **[~] deferred → condition C3, owner DevOps**
- [~] Session cookie `Secure` verified in prod — config posture passes (trustHost:true, auth.ts:42); actual deployed-URL check is runbook G7 operator task
- [ ] `ADMIN_ALLOW_OLLAMA_USERS` env flag implemented (AC.17 decision: implement now, default false) — **[~] deferred → condition C4, owner Backend**
- [x] Consolidated threat model complete (`.orchestrator/security/threat-models/phase-5.md`, prior-phase closure table)
- [x] Final audit complete, full sweep (`.orchestrator/security/audits/phase-5.md`, 32 checks)
- [x] Accepted-risk register consolidated (AR-1..8 in threat-model §3)
- [x] Final sign-off written (`.orchestrator/handoffs/security-phase-5.md` — APPROVED WITH CONDITIONS)

### carried items — closed at final sweep
- [x] phase 0: stale `npm audit cannot run` blocker — closed (node_modules exists, audit run, documented)
- [x] phase 0 T-I-12 / `[~]` HSTS-dev item — resolved into the phase-5 prod-gates condition C3 (see above)
- [x] phase 3 hardening #1 BLOCKING: provider-fetch redirect policy — closed, `ssrfSafeFetch` per-hop re-validation (ssrf-guard.ts:174–203)
- [x] phase 3 hardening #6: resolved-addresses SSRF — closed (lookup all:true, ssrf-guard.ts:97–119)
- [x] phase 4 hardening #1: rate-limit bucket reconciliation — closed; edit/regenerate share the send LLM bucket + mutation bucket (edit/route.ts:6,60 comment)
- [x] phase 4 hardening #3: deleted-ancestor behavior — closed via shared live-row lookups filtering deletedAt on ancestor chains (route greps + stream.ts:76,357,374)
- [x] earlier-phase "code audit pending" rows (phases 0–4) — closed by this sweep: every phase-0..4 checklist item re-verified against shipped code (A1–A23 audit rows)

### open conditions carried into sign-off (NOT closed by code)
- [ ~ ] C1 prod DB driver switch US-510 (Backend) — see audit A25
- [ ~ ] C2 request logging US-504 (Backend) — see audit A26
- [ ~ ] C3 HSTS (DevOps)
- [ ~ ] C4 ADMIN_ALLOW_OLLAMA_USERS flag (Backend)
- [ ~ ] C5 health endpoint AC.11 shape (Backend)
- [ ~ ] C6 CI reconciliation (DevOps)
- [ ~ ] C7 migration chain: 0001_noop → 0001_soft_delete + journal reset (DevOps+Backend)
- [ ] deployment verification (live URL: health/smoke/cookie Secure/headers) — operator task per runbook, out of sign-off scope
