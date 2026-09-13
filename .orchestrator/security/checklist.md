# Security Checklist (running tracker)

**phase:** 0 + 1
**last_updated:** 2026-09-13
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

## phase-by-phase tracker

| phase | threat model | checklist | audit | sign-off |
|---|---|---|---|---|
| 0    | done (preliminary) | this file | pending code review | pending |
| 1    | done (preliminary) | this file | pending code review | pending |
| 2    | — | — | — | — |
| 3    | — | — | — | — |

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
