# Security Checklist (running tracker)

**phase:** 0
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
- [ ] Spec hardening items resolved or accepted by Orchestrator

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

## phase-by-phase tracker

| phase | threat model | checklist | audit | sign-off |
|---|---|---|---|---|
| 0    | done (preliminary) | this file | pending code review | pending |
| 1    | — | — | — | — |
| 2    | — | — | — | — |
| 3    | — | — | — | — |

---

## known open issues

- `npm audit` cannot run until `node_modules` exists (Backend / DevOps concern)
- `next-auth@5.0.0-beta.25` is a pre-release — accept risk, document pin
- `pino-pretty` is a dev dep — confirm not in production bundle (Backend)
- Anthropic SDK present but unwired (per spec §9 decision #10) — no threat model entry needed
