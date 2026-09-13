# Phase 0 STRIDE Threat Model

**status:** preliminary (code not yet written — pre-implementation review only)
**phase:** 0 — Setup + Root Chat End-to-End
**spec:** `.orchestrator/specs/phase-0.md` (frozen rev 2)
**framework:** STRIDE per Microsoft Threat Modeling Tool + OWASP Top 10 (2025)
**reviewer:** security

---

## scope

All surfaces introduced in phase 0:

1. Authentication (signup, signin, signout, session cookies)
2. All 8 API routes per spec §5:
   - `POST /api/auth/signup`
   - `POST /api/auth/signin` (custom wrapper around Auth.js `/api/auth/callback/credentials`)
   - `POST /api/auth/signout`
   - `GET /api/auth/[...nextauth]`
   - `GET /api/chats`
   - `POST /api/chats`
   - `GET /api/chats/:id`
   - `POST /api/chats/:id/messages` (SSE)
   - `GET /api/health`
3. AI provider integration (env-keyed, fallback chain OpenAI → Ollama → 503)
4. DB access layer (Drizzle, all 6 tables)
5. Data at rest (password hashing now, API key encryption reserved for phase 3)

Explicitly **not** modeled (per spec §9): branching, sub-chats, BYOK UI, OAuth, magic link, password reset, MFA, attachments, tool calling, message edit/regenerate/delete.

---

## data flows

1. Visitor → browser → `POST /api/auth/signup` → Zod validate → bcrypt hash → `users` insert → Auth.js `signIn('credentials')` → `sessions` insert + Set-Cookie → redirect `/`
2. Visitor → browser → `POST /api/auth/callback/credentials` → Auth.js Credentials `authorize()` → `users` lookup by email → `bcrypt.compare` → `sessions` insert + Set-Cookie → redirect `/` (or `callbackUrl` if same-origin)
3. Browser → `POST /api/auth/signout` with CSRF token → Auth.js → `sessions` row delete + cookie clear → redirect `/signin`
4. Signed-in browser → `GET /api/chats?cursor=&limit=` → `auth()` → query `conversations WHERE userId=session.user.id ORDER BY updatedAt DESC LIMIT 50` → JSON
5. Signed-in browser → `POST /api/chats` → `auth()` → `conversations` insert (`userId` from session, `parentId=null`, `rootConversationId=self`, `depth=0`) → JSON `{id,...}`
6. Signed-in browser → `GET /api/chats/:id` → `auth()` → query `conversations WHERE id=:id AND userId=session.user.id` (0 rows = 404, not 403) → query `messages WHERE conversationId=:id ORDER BY createdAt ASC` → JSON
7. Signed-in browser → `POST /api/chats/:id/messages` body `{content, clientMessageId}` → `auth()` → ownership check (404 on miss) → `messages` insert user row → lookup `getActiveProvider()` → `streamText({model, messages, abortSignal})` → SSE stream → on finish/error persist assistant `messages` row
8. Any client → `GET /api/health` (no auth) → report resolved provider + ollama reachability → JSON
9. Server boot → module init → `getActiveProvider()` resolves once: `env.OPENAI_API_KEY` ? → OpenAI ; else `fetch(OLLAMA_BASE_URL/api/tags, 2s timeout)` 2xx ? → Ollama ; else → null

---

## trust boundaries

- **TB-1:** internet ↔ Next.js edge (TLS terminates here; assume HTTP only inside)
- **TB-2:** Next.js route handler ↔ `auth()` / session lookup (session-token cookie ↔ `sessions` row)
- **TB-3:** Route handler ↔ Drizzle ORM (parameterized SQL; dev SQLite file, prod Postgres)
- **TB-4:** Route handler ↔ AI provider SDK (network egress to `api.openai.com` or `localhost:11434`)
- **TB-5:** Browser ↔ Auth.js session cookie (HttpOnly, Secure, SameSite)
- **TB-6:** Browser ↔ SSE stream (Server-Sent Events over chunked HTTP)
- **TB-7:** Dev environment env vars ↔ process memory (DB is on disk; `OPENAI_API_KEY` etc. only in `process.env`)
- **TB-8:** Single-user client state ↔ DB (client only ever sees `conversation.id`, never `userId` write path)

---

## threats (STRIDE)

### Spoofing

- **T-S-1: Email enumeration via distinct signup error codes**
  - Spec §5 already specifies identical "An account already exists" message for 409 — but **Backend must implement**; if email field-level error differs (e.g. "Invalid email format" returned before unique check), probing reveals valid emails.
  - likelihood: medium (if implemented wrong); impact: low (PII leak at scale)
  - mitigation: Backend uses single error message for both "format invalid" and "taken"; Zod validates email format before DB hit; timing constant-ish (bcrypt even on invalid email is unnecessary — don't hash on lookup miss); rate-limit signup (see T-D-3).

- **T-S-2: Open redirect via `?callbackUrl=` on `/signin`**
  - Spec AC.2 mentions "callbackUrl if present and same-origin" — but the validation must reject off-origin URLs (e.g. `?callbackUrl=https://evil.com`).
  - likelihood: medium; impact: high (phishing / OAuth-style token theft once OAuth lands)
  - mitigation: Backend validates `callbackUrl` starts with `AUTH_URL` origin; reject otherwise. Frontend never sets callbackUrl from cross-origin referrer.

- **T-S-3: Session hijacking via stolen cookie**
  - likelihood: low (HttpOnly + Secure + SameSite=Lax mitigates JS exfil and CSRF most cases); impact: high
  - mitigation: cookie attrs mandated (checklist item); Auth.js DB sessions enable server-side revocation on signout; rotate `AUTH_SECRET` invalidates all sessions.

- **T-S-4: Forged cross-origin state-changing request (CSRF)**
  - Auth.js signout has built-in CSRF token. But `POST /api/chats`, `POST /api/chats/:id/messages`, `POST /api/auth/signup` — verify SameSite=Lax blocks most; verify no GET handler mutates state.
  - likelihood: low (SameSite=Lax + no GET mutations); impact: medium
  - mitigation: enforce `Content-Type: application/json` only on POSTs (rejects form-encoded simple requests from cross-origin); verify SameSite=Lax (not Strict — needed for OAuth callbacks later); custom `POST /api/auth/signin` wrapper if added must require CSRF token or use Auth.js built-in path.

- **T-S-5: Client-supplied `userId` impersonation**
  - Spec §7 mandates `session.user.id` is the only join key. Threat: a developer accidentally trusts `body.userId` or query string.
  - likelihood: low (spec is clear); impact: critical (full account takeover)
  - mitigation: Backend NEVER reads userId from request body/query; auth helper `requireUser()` returns `{id}` from session; lint rule / reviewer checklist item.

### Tampering

- **T-T-1: SQL injection via Drizzle**
  - Drizzle uses parameterized queries by default (`db.select().where(eq(...))`); raw `sql\`\`` template usage is the only injection vector.
  - likelihood: very low (Drizzle default safe); impact: critical
  - mitigation: code review bans `sql` template usage except in migrations; Drizzle schema-derived types only; verify in audit phase by grep for `sql\``.

- **T-T-2: Prompt injection via user message content**
  - User `content` is sent directly to the LLM as `{role:'user', content}` along with prior conversation history. An attacker (or compromised account) can put `<system>` / `Assistant:` / tool-call syntax in `content`.
  - likelihood: high (it's a chat app — by design); impact: medium (LLM behavior change, data exfil if tool calls land in phase 4; jailbreak)
  - mitigation (phase 0 acceptable): document that user content is untrusted and that no system prompt in phase 0 exposes secrets or tools. Future: structured-content rendering, content safety filter, system-prompt hardening. Phase 0 has no tools so worst case is "model says weird thing" — acceptable.

- **T-T-3: XSS via rendered assistant / user content**
  - Spec §9 says plain text + newlines only in phase 0. If Frontend uses `dangerouslySetInnerHTML` or markdown renderer without sanitization, attacker controls a bubble.
  - likelihood: low (spec mandates plain text); impact: high (session theft, account takeover)
  - mitigation: Frontend renders with `{message.content}` (React auto-escapes) only; no `dangerouslySetInnerHTML`; no markdown renderer in phase 0. Code review must grep for these.

- **T-T-4: Race condition on `clientMessageId` dedupe**
  - Spec §5 accepts `clientMessageId` for dedupe. Threat: attacker reuses another user's `clientMessageId` to delete/overwrite? — phase 0 has no delete path, so dedupe is purely an insert concern. Verify dedupe logic is per-`(conversationId, clientMessageId)` not per-clientMessageId globally.
  - likelihood: low; impact: low (message duplication only)
  - mitigation: dedupe unique on `(conversationId, clientMessageId)` not global; server still validates user owns the conversation.

- **T-T-5: Stream tampering / replay**
  - SSE stream is HTTP — no built-in integrity beyond TLS. Attacker on-path can drop/modify tokens; no integrity check.
  - likelihood: very low (TLS); impact: low (no client trusts stream content)
  - mitigation: TLS only; document that streamed content is not authenticated to the client beyond server origin.

- **T-T-6: Concurrent stream start (TOCTOU on in-flight lock)**
  - Spec §8 says "in-process Map<conversationId, AbortController>; on request start: if controller exists, abort and wait ≤100ms grace, then proceed." Threat: if grace window is exceeded (slow abort), a second writer persists, breaking single-in-flight invariant.
  - likelihood: low; impact: low (extra tokens in DB, no security loss)
  - mitigation: use a `Promise`-based lock (queue if locked, don't race); 100ms grace is acceptable since abort is synchronous in Node; document failure mode.

- **T-T-7: Mass assignment on signup**
  - `POST /api/auth/signup` accepts `{email, password, name}`. Threat: if Backend uses `Object.assign(user, body)`, attacker sets `id`, `emailVerified`, `passwordHash`, etc.
  - likelihood: low (small payload); impact: high (privilege escalation)
  - mitigation: explicit allowlist destructuring: `const {email, password, name} = parsedBody`; reject any extra fields (Zod `.strict()`).

### Repudiation

- **T-R-1: No audit trail of auth events**
  - Phase 0 doesn't log signin success/failure, signup, signout. If a user disputes an action, no log proves who did what.
  - likelihood: medium; impact: medium
  - mitigation: Backend logs structured `auth.signin.{success,failure}` with `{userId?, ip, ua, ts}` at `info`/`warn`; never log password.

- **T-R-2: Logs lack correlation ID**
  - If a streaming message errors mid-flight, no way to tie error to user/conv/timestamp from logs.
  - likelihood: medium; impact: low
  - mitigation: pino with `genReqId` (Next.js 15 supports per-request id); include in every log line; Sentry breadcrumbs later (phase 1).

- **T-R-3: SSE partial message persistence attribution**
  - On stream error, partial assistant message is persisted. If the stream was injected mid-way (TLS break), the persisted content could be attacker-controlled and indistinguishable from server output.
  - likelihood: very low (requires TLS MITM); impact: low
  - mitigation: TLS + log final content length; phase 0 acceptable.

### Information Disclosure

- **T-I-1: Password leak via error**
  - If bcrypt throws (e.g. malformed hash column), stack trace to client reveals internal state.
  - likelihood: very low; impact: critical
  - mitigation: production error handler returns generic `{error:{code:'INTERNAL',message:'Something went wrong'}}`; full error only in `console.error` / pino `error` level.

- **T-I-2: API key leak in logs**
  - `OPENAI_API_KEY` might be logged if a provider error includes the request URL or headers. OpenAI SDK + Vercel AI SDK don't echo keys, but custom `fetch` debug logging could.
  - likelihood: low; impact: critical
  - mitigation: pino redact list: `['*.OPENAI_API_KEY', '*.openai_api_key', 'req.headers.authorization', 'req.headers.cookie']`; never `console.log(providerError)` — use pino with `redact`; verify in code review.

- **T-I-3: Stack trace in 5xx response**
  - Standard Next.js dev vs prod behavior; threat: in dev, error stack in response leaks file paths and line numbers. In prod, default Next.js returns minimal. Verify.
  - likelihood: low in prod; impact: medium (info leak)
  - mitigation: Backend `try/catch` around all route handlers; on caught error, return `{error:{code:'INTERNAL',message:'...'}}` and log full error server-side; Next.js `productionBrowserSourceMaps` disabled.

- **T-I-4: Provider error leaks upstream detail**
  - If OpenAI returns 429 with a body, naive passthrough reveals upstream behavior. Spec only mandates friendly banner.
  - likelihood: medium (provider rate-limit / quota); impact: low
  - mitigation: Backend catches provider errors, logs full body internally, returns `{error:{code:'PROVIDER_FAILED',message:'AI provider is unreachable — check configuration'}}`; never echo provider response verbatim.

- **T-I-5: 403 vs 404 leaks conversation existence**
  - Spec §6 AC.4 mandates 404 on cross-user access. If implemented as 403 first, ID enumeration possible. **Critical to verify in code review.**
  - likelihood: low if spec followed; impact: low (PII metadata)
  - mitigation: spec-mandated; Backend code review must confirm `where(eq(userId, session.user.id))` runs before any 403 decision; checklist item.

- **T-I-6: PII in logs (email, message content)**
  - `console.log("user signed in", user.email)` leaks email to log aggregator.
  - likelihood: medium; impact: medium (GDPR, retention)
  - mitigation: pino redact list includes `email`; message content should NOT be logged at all in phase 0 (privacy + cost log volume); only metadata `{conversationId, messageId, role, length}`.

- **T-I-7: Timing attack on bcrypt compare**
  - `bcrypt.compare` is constant-time per call. The email lookup itself (`SELECT * FROM users WHERE email=?`) may be slower for existing rows. Marginal.
  - likelihood: very low; impact: very low
  - mitigation: acceptable in phase 0; do not log timing.

- **T-I-8: SSE headers leak info**
  - SSE stream must not include `X-Powered-By: Next.js` or other identifying headers; verify `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on SSE responses.
  - likelihood: low; impact: low
  - mitigation: `secureHeaders` middleware (see handoff) applies to all routes including SSE; manually add `Cache-Control: no-store` on `/api/chats/:id/messages` to prevent proxy caching of streamed content.

- **T-I-9: `passwordHash` in `GET /api/chats/:id` or signup response**
  - Spec signup response is `{user: {id, email, name}}` — no hash. Threat: developer includes `passwordHash` "for completeness."
  - likelihood: low; impact: critical
  - mitigation: code review explicit allowlist; never `select()` the whole row.

- **T-I-10: `/api/health` leaks too much**
  - Spec AC.3 returns `{provider: {type, model, baseUrl}}`. `baseUrl` for Ollama is `http://localhost:11434/v1` — fine. But if a future `apiKeyCiphertext` accidentally included, leak. Phase 0 health response is safe; future hardening needed.
  - likelihood: very low; impact: medium
  - mitigation: explicit response builder, no DB read in `/api/health`; document allowed fields.

- **T-I-11: Auth.js debug endpoint in prod**
  - Auth.js has a debug/development mode. Threat: enabled in prod.
  - likelihood: very low; impact: medium
  - mitigation: `NODE_ENV=production` env var; `auth.ts` must check; no `debug: true` in `authConfig`.

- **T-I-12: Missing TLS enforcement**
  - Spec §AUTH_URL is `http://localhost:3000` in dev. Threat: prod has `http://` — cookies marked Secure still set, but auth handshake over plaintext.
  - likelihood: low; impact: high
  - mitigation: DevOps / phase 1: prod must be HTTPS-only; HSTS header; cookie `Secure` flag mandatory.

### Denial of Service

- **T-D-1: No rate limit on `/api/chats/:id/messages` (cost amplification / LLM cost DoS)**
  - **Critical gap in spec.** Signup → new chat → spam messages → $$ to OpenAI. Each message is 1 LLM call. Auth check exists but no per-user/IP rate limit.
  - likelihood: high (trivial to script); impact: high (cost attack, can bankrupt account)
  - mitigation: **spec hardening request — add per-user rate limit on `/api/chats/:id/messages` (e.g. 30/min/user, 500/hour/user).** Phase 0 minimum: 60 messages/min/user; in-memory token bucket same shape as auth rate limit. Phase 1 move to Upstash.

- **T-D-2: No rate limit on `/api/chats` (chat creation spam)**
  - Same shape as T-D-1 but cheaper per call.
  - likelihood: medium; impact: low (DB rows; disk)
  - mitigation: per-user cap on conversations (e.g. 1000/user); otherwise acceptable in phase 0.

- **T-D-3: No rate limit on `/api/auth/signup` (account creation flood)**
  - Signup is rate-limited by IP implicitly via bcrypt cost (intentional), but no explicit limit.
  - likelihood: medium; impact: medium (DB bloat, captcha bypass)
  - mitigation: same IP-based bucket, 10 signups/hour/IP; in-memory; defer captcha to phase 3.

- **T-D-4: Streaming DoS — unbounded in-flight map**
  - Spec §8 has `Map<conversationId, AbortController>`. If clients open many streams and never read them, the map grows. The aborted-stream grace (100ms) cleanup helps but doesn't bound the map if abort never fires.
  - likelihood: medium; impact: medium (memory)
  - mitigation: max-stream-duration hard cap (e.g. 5min); on timeout, abort + cleanup; also LRU cap on map size (e.g. 1000) with eviction.

- **T-D-5: Large message content DoS**
  - Spec caps at 8000 chars. Verify Backend enforces (Zod max(8000)) — if not, 1MB body to LLM is cost-amplifying.
  - likelihood: low if Zod enforces; impact: high
  - mitigation: Zod `.max(8000)` on `content`; `Content-Length` cap at API edge (e.g. 16KB) as belt-and-braces.

- **T-D-6: OpenAI 30s per-token timeout exhaustion**
  - Spec §8: "30s per-token timeout". 30s × N tokens can exceed serverless function timeout (e.g. Vercel 10s default on hobby). On hobby, the stream dies mid-flight = silent failure or 504.
  - likelihood: high on hobby plan; impact: medium (UX)
  - mitigation: **DevOps concern (phase 1 deploy).** Document; phase 0 dev uses `next dev` so no timeout. Production: maxDuration on route segment config.

- **T-D-7: Ollama 2s probe on every boot**
  - Boot-time probe. Single call, fine. Threat: if OLLAMA_BASE_URL is a slow external host, boot hangs 2s.
  - likelihood: low; impact: very low
  - mitigation: 2s timeout already; acceptable.

- **T-D-8: `/api/health` uncached → DoS via cheap polling**
  - Public endpoint, no auth, returns server status. Attacker scripts polling.
  - likelihood: medium; impact: low
  - mitigation: `Cache-Control: public, max-age=10`; rate-limit by IP if abuse observed (phase 1+).

### Elevation of Privilege

- **T-E-1: IDOR on `/api/chats/:id`**
  - **OWASP A01.** Threat: user A enumerates `/api/chats/<uuid>` and reads B's conversation if ownership check missing.
  - likelihood: high (UUIDs are guessable at scale, or leaked via list/share); impact: critical (full chat read)
  - mitigation: spec-mandated `WHERE userId=session.user.id` filter; **404 on miss** (not 403 — avoid existence leak); Backend code review must verify WHERE clause is on the same query that selects, not post-filter; checklist item.

- **T-E-2: IDOR on `/api/chats/:id/messages`**
  - Same as T-E-1. Before persisting the user message, check `conversation.userId === session.user.id` — if skip, attacker writes to B's conversation.
  - likelihood: medium; impact: critical (poison training data of B's LLM context)
  - mitigation: ownership check BEFORE user-message insert; 404 on miss (consistent with T-E-1); abort stream if ownership fails mid-stream.

- **T-E-3: Missing auth on `/api/chats/:id/messages`**
  - Spec §5: "All authenticated routes check `auth()`". Verify Backend actually calls `auth()` — if route handler forgotten, unauthenticated message send.
  - likelihood: low (spec clear); impact: critical (free LLM usage for attacker, $$ cost)
  - mitigation: code review verifies `auth()` at top of every protected route; consider `requireAuth()` helper that throws 401.

- **T-E-4: Missing auth on `/api/chats` (list + create)**
  - Same as T-E-3. List endpoint must filter by userId; create must derive userId from session.
  - likelihood: low; impact: critical
  - mitigation: same as T-E-3; `requireAuth()` helper.

- **T-E-5: `providerId` / `model` spoofing in assistant message**
  - When persisting assistant message, spec says `model=<provider-model-id>`, `providerId=<resolved-provider-id>`. Threat: if Backend reads `model` from request body and persists, attacker lies about model used.
  - likelihood: low; impact: low (audit only)
  - mitigation: server-set from `getActiveProvider()` only, never from request body; code review.

- **T-E-6: `userId` spoofing in conversation creation**
  - Spec §7 AC.4: "server validates `session.user.id === conversation.userId`" — but the conversation is being created. Threat: if Backend reads `userId` from request body.
  - likelihood: low; impact: critical (create on behalf of another user)
  - mitigation: `userId` always from session; never from body; Zod schema does NOT include userId; code review.

- **T-E-7: Auth.js Credentials `authorize()` returns object with extra fields**
  - Threat: `authorize()` returns `{id, email, name, role: 'admin'}` if user table gains a `role` column; Auth.js propagates into session JWT.
  - likelihood: very low (no role column in phase 0); impact: high (privilege escalation if added later)
  - mitigation: `authorize()` returns explicit allowlist; never spread user row.

- **T-E-8: SSRF via OLLAMA_BASE_URL**
  - Spec §8: env var `OLLAMA_BASE_URL` controls base URL. Env vars are server-controlled in phase 0, so SSRF requires env-write access. Future: if user-controlled (phase 3 BYOK), becomes critical.
  - likelihood: very low in phase 0; impact: low (localhost probing only)
  - mitigation: phase 0 acceptable (env-controlled); phase 3 must validate URL (reject `127.0.0.1`, RFC1918, link-local, file://, etc.) — flag for phase 3.

- **T-E-9: Path traversal via `conversationId`**
  - Spec says `id` is `text PK` (UUID). Threat: if validation is loose, `/api/chats/../../etc/passwd` works.
  - likelihood: very low (Next.js dynamic route param is single-segment); impact: very low
  - mitigation: Zod validates UUID v4 format; Next.js route segment handles the rest.

---

## assumptions

1. **TLS terminates at the edge** (Vercel or similar); all HTTP inside the runtime is trusted.
2. **Drizzle ORM is used as designed** — no raw `sql\`\`` outside migrations.
3. **`AUTH_SECRET` is generated with `openssl rand -base64 32`** and never committed. If `.env` is committed or shared, all bets are off.
4. **Single-instance deployment** — in-memory rate limit and in-flight stream lock are reliable only because there's one Node process. Phase 1 must migrate when scaling.
5. **`OPENAI_API_KEY` is a server-side secret** with billing limits set on the OpenAI dashboard.
6. **No PII or secrets in URL query strings** other than `callbackUrl` (which Backend validates).
7. **Browser cookie jar respects HttpOnly + Secure + SameSite=Lax** — all modern browsers do; no IE11.
8. **Frontend never sends `userId` in body** — this is a Backend invariant, but Frontend must not construct such payloads.

---

## out of scope (phase 0)

Per spec §9, NOT modeled:
- Branching / sub-chats
- OAuth providers, magic link, password reset, MFA
- File / image attachments, tool calling
- Markdown rendering, code-block highlighting
- Tree-map visualization, split view
- Sentry wiring (deferred phase 1)
- Production Postgres migration (phase 1)
- BYOK / per-user API keys (phase 3)
- WebSocket transport (SSE only)
- Internationalization

These will get their own threat models when added.

---

## residual risk

After mitigations above:

| risk | residual likelihood | residual impact | accept/transfer/avoid |
|---|---|---|---|
| Prompt injection via user content | high (by design) | low (no tools, no secret exfil possible in phase 0) | **accept** — phase 0 has no exfil channel |
| LLM cost amplification via T-D-1 | medium (after spec hardening) | medium | **mitigate** in phase 0 via per-user rate limit |
| In-memory rate-limit bypass on multi-instance | n/a in phase 0 (single instance) | n/a | **transfer** to phase 1 (Upstash) |
| TLS not enforced in dev | high (http://localhost) | low (dev only) | **accept** in dev; **avoid** in prod (DevOps phase 1) |
| Provider dependency (OpenAI/Ollama uptime) | medium | medium | **transfer** to provider SLA |
| Session fixation (reuse pre-auth session) | low | medium | **mitigate** — Auth.js DB sessions rotate token on signin |

No residual risk rated **critical** for phase 0 if the spec hardening requests are adopted.

---

## OWASP Top 10 (2025) mapping

| OWASP | threats | coverage |
|---|---|---|
| A01 Broken Access Control | T-E-1, T-E-2, T-E-3, T-E-4, T-E-6, T-S-5 | covered by `requireAuth()` + 404-on-cross-user; verify in code review |
| A02 Cryptographic Failures | T-I-1, T-I-2, T-I-12 | bcrypt cost 12 ✓; `AUTH_SECRET` rotation needed (phase 1); TLS in prod (phase 1); future `apiKeyCiphertext` (phase 3) |
| A03 Injection | T-T-1, T-T-2 | Drizzle parameterized ✓ (verify in audit); prompt injection acceptable in phase 0 |
| A04 Insecure Design | T-D-1, T-D-2, T-D-3, T-D-4, T-E-3, T-E-4 | stream lock ✓; auth on all routes ✓; **rate limit on messages missing — spec hardening needed** |
| A05 Security Misconfiguration | T-I-3, T-I-8, T-I-11 | secureHeaders middleware + prod error handler + Auth.js debug off — covered by handoff items |
| A06 Vulnerable & Outdated Components | (deferred) | `npm audit` to be run by DevOps once `node_modules` exists |
| A07 Identification and Authentication Failures | T-S-1, T-S-2, T-S-4, T-S-3 | signup message consistency + callbackUrl origin check + signin rate limit + DB sessions ✓ |
| A08 Software & Data Integrity Failures | T-T-6 | stream lock TOCTOU acceptable in phase 0 |
| A09 Logging and Monitoring | T-R-1, T-R-2, T-I-6 | structured pino + redact + correlation id — covered by handoff items |
| A10 SSRF | T-E-8 | env-controlled in phase 0 ✓; flag for phase 3 |

---

## spec hardening requests (to PM / Orchestrator)

These are items I want addressed **before or during implementation** — not blockers, but quality gates:

1. **Add per-user rate limit on `/api/chats/:id/messages`** (T-D-1) — 60/min/user + 500/hour/user recommended. Same in-memory token bucket pattern as signin.
2. **Explicit `Content-Length` cap** at API edge (16KB) on message route — belt-and-braces against T-D-5.
3. **Add max stream duration cap** (5 min) on `/api/chats/:id/messages` — covers T-D-4.
4. **Add `Cache-Control: no-store` on SSE responses** — T-I-8.
5. **Document in spec** that Frontend MUST NOT use `dangerouslySetInnerHTML` for any message content (T-T-3) and Backend MUST use `requireAuth()` helper consistently.
6. **Document in spec** that pino redact list must include `email`, `passwordHash`, `OPENAI_API_KEY`, `cookie`, `authorization` (T-I-2, T-I-6).
7. **Add Vitest test case** for: 404 returned on cross-user conversation read (not 403).
8. **Add Vitest test case** for: `callbackUrl` off-origin returns 400 on signin (T-S-2).
9. **Spec clarification**: confirm production Postgres env var (`DATABASE_URL`) is read at runtime and dev/prod dialect is switchable — affects threat model only if DB is multi-tenant or shared.

None of the above block implementation; items 1, 2, 3, 4 are recommended for **phase 0 sign-off**; items 5–8 are recommended as **spec updates** rather than blockers; item 9 is informational.

---

## sign-off

- reviewed by: security
- date: 2026-09-13
- status: **needs-mitigation** (audit pending code review)
- blocking findings: 0 (all criticals have proposed mitigations)
- non-blocking hardening requests: 9 (see above)
