# Phase 5 Final Security Audit (production sweep)

**date:** 2026-09-14
**reviewer:** security (GLM 5.3 Flash tier)
**scope:** code + config only. Live deployment verification (health/smoke on a real URL) is an operator task per runbook G5/G6 and is OUT of this audit.
**method:** full grep + targeted file reads + `npm audit --omit=dev`. No code modified (auditor restriction).

## 1. Findings table

| # | check | status | evidence |
|---|---|---|---|
| A1 | bcrypt cost 12 on signup | **pass** | `src/app/api/auth/signup/route.ts:12` (`BCRYPT_COST = 12`), `:49` `bcrypt.hash(password, BCRYPT_COST)` |
| A2 | Credentials flow: zod gate, unknown-user and bad-password return `null` uniformly (no user enumeration); no extra fields returned | **pass** | `src/lib/auth.ts:53–81` — all three reject paths return `null` → Auth.js generic 401 |
| A3 | Session callback explicit allowlist; `authorize()` returns explicit `{id,email,name,image}` (no spread, no passwordHash) | **pass** | `src/lib/auth.ts:75–80, 85–91` |
| A4 | Sign-in rate limit wired (5/15min/IP + X-RateLimit headers) | **pass** | `src/app/api/auth/signin/route.ts:45,57,79` |
| A5 | Messages / branch / providers / mutation buckets wired | **pass** | messages `route.ts:12` (checkMessagesRateLimit), branch `route.ts:6`, providers `route.ts:6` + `[id]/route.ts:6`, edit+regenerate share send bucket + mutation bucket (`edit/route.ts:6,60`) |
| A6 | **Secrets: every `process.env` secret-beaing var consumed server-side only** | **pass** | grep src/ (16 hits): `ENCRYPTION_KEY`/`AUTH_SECRET` (encrypt.ts, server-only), `OPENAI/ANTHROPIC/OLLAMA_*` (provider.ts, server-only), `LOG_LEVEL`/`PGLITE_DATA_DIR` (server-only). Non-secret: `AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `SUBSCHAT_SYSTEM_PROMPT`. Only `NEXT_PUBLIC_APP_URL` is public-scope and non-secret |
| A7 | `server-only` imports on all lib files touching secrets/DB | **pass** | grep: provider.ts, provider-dto.ts, ssrf-guard.ts, stream.ts, auth.ts, encrypt.ts, db/index.ts — all carry the import |
| A8 | No secret in any client component; no stray `NEXT_PUBLIC_*` secret | **pass** | §6 env manifest grep (spec: "no other `NEXT_PUBLIC_*` or `process.env` keys exist") confirmed by sweep |
| A9 | `.env` gitignored | **pass** | `.gitignore:19–20` (`.env`, `.env*.local`) |
| A10 | pino redact list complete (email, passwordHash, key/cookie/authorization vars, apiKey variants, selection/highlight fields) | **pass** | `src/lib/log.ts:8–27` — all 10+ required paths present |
| A11 | No log call site passes raw key/plaintext/ciphertext outside redacted paths (provider.ts, stream.ts spot-check) | **pass** | spot-check of all `log.*` sites in `provider.ts` (71,83,102,113,214) and `stream.ts` (425,457,499,517,539,553,573,618): metadata ids only; decrypt-error path carries no ciphertext; redact `*.email` covers root-level `{email}` in auth.ts:67,72 (single-level wildcard semantics — root and direct children covered) |
| A12 | No `console.log` in production code | **pass** | grep src/ = 0 hits (non-test) |
| A13 | Headers: CSP / X-Frame-Options DENY / nosniff / Referrer-Policy / Permissions-Policy | **pass** | `src/middleware.ts:5–22`, matcher covers all routes (`:27`) |
| A14 | HSTS in prod (`next.config.ts` conditional) — spec AC.15 | **fail → condition C3** | `next.config.ts` has no `headers()` block; the deliberate prod-side deployment addition is not implemented. Owner: DevOps |
| A15 | SSRF denylist: loopback/private v4, link-local 169.254/16, v6 ::1, ULA fc00::/7, fe80::/10, IPv4-mapped `::ffff:a.b.c.d` re-evaluated as v4 | **pass** | `src/lib/ai/ssrf-guard.ts:32–40, 69–83, 85–90`; unparseable → blocked (fail-closed) |
| A16 | SSRF: resolved-address check (A+AAAA all records), not hostname string match | **pass** | `ssrf-guard.ts:97–119` (`lookup(hostname, { all: true })`, every address checked); IP literals handled directly |
| A17 | ssrfSafeFetch: redirect re-validation per hop, `redirect: 'manual'`, 3-hop cap, fail-closed | **pass** | `ssrf-guard.ts:174–203` — closes phase-3 hardening #1 |
| A18 | Ollama exemption documented | **pass (risk accepted AR-1)** | `ssrf-guard.ts:127,142–144`; kill-switch: see A19 |
| A19 | `ADMIN_ALLOW_OLLAMA_USERS` env flag — spec AC.17 decision says implement now (default false) | **fail → condition C4** | zero references in `src/`. Owner: Backend/DevOps. Prod exposure is limited while the flag is absent (ollama create allowed with no switch) |
| A20 | IDOR: `userId` filter present in chats/[id] (×4 incl. ancestor walk), branch, tree (×3), export (×2), messages, edit, regenerate, providers list/PUT/DELETE | **pass** | grep table in audit trace — `eq(conversations.userId, userId)` / `eq(providers.userId, userId)` on EVERY route's primary lookup |
| A21 | 404 parity (missing = foreign) single-query ownership | **pass** | same queries: `and(eq(id), eq(userId))` in one WHERE incl. `providers/[id]/route.ts:87,174` |
| A22 | Deleted-conversation 404 parity: `isNull(conversations.deletedAt)` on all conversation-loading routes (list, [id], tree, export, messages, branch, edit, regenerate) | **pass** | grep: 15 sites across `route.ts` files + `stream.ts:76,357,374`; delete/restore asymmetric handling in `[id]/route.ts:250–308` (live-only cascade `:256`, restore batch-scope `:308` region) |
| A23 | Markdown XSS: zero `dangerouslySetInnerHTML`, zero `rehype-raw` (outside comment text) | **pass** | grep src/components — only comment references in `Markdown.tsx:114–115` documenting the prohibition; actual usage = 0 |
| A24 | `npm audit --omit=dev` — 9 vulnerabilities (2 high, 2 moderate, 5 low), 0 critical | **pass (accepted AR-4)** | detail in §2 |
| A25 | Prod driver switch US-510 (DATABASE_URL → node-postgres, pglite fallback; ensureSchema wired to pglite branch) — AC.18/19 | **fail → condition C1** | `src/lib/db/index.ts` is pglite-ONLY (no DATABASE_URL branch, no `pg` dep in package.json, no `serverExternalPackages: pg`, `ensureSchema` has ZERO callers). Owner: Backend |
| A26 | US-504 request logging (requestId/route/status/durationMs + X-Request-Id echo) — AC.8/9 | **fail → condition C2** | `withRequestId()` (`log.ts:42`) exists with NO callers; no middleware/route wiring; no X-Request-Id response header. Owner: Backend |
| A27 | Health endpoint AC.11 shape (`dbReachable, providerResolved, migrationsApplied`, 503 degraded, non-revealing) | **fail → condition C5** | `src/app/api/health/route.ts` returns always-ok `{status:"ok", provider{type,model,baseUrl,source}, ollamaReachable}` — no DB/migration fields, no 503; also echoes `provider.baseUrl` (own-data, violates "non-revealing"). Owner: Backend |
| A28 | CI reconciliation AC.20 (drop `file:` DATABASE_URL, drop lint, gate e2e) | **fail → condition C6** | `.github/workflows/ci.yml:23` `.ci-build.db` file: DSN, `:42` lint step active, `:53–84` e2e job unguarded. (`file:` DSN also works as a "sentinel" only for better-sqlite3 era — now harmless-but-stale.) Owner: DevOps |
| A29 | Migration chain AC.1–2: exactly 0000 + 0001_soft_delete, no 0006-style debris / stale journal | **fail → condition C7** | `drizzle/` currently: `0000_init.sql`, `0001_noop.sql`, `meta/` journal — `0001_noop.sql` is NOT the spec'd `0001_soft_delete.sql`; the round-trip test (AC.1) could not be executed by audit. Owner: DevOps+Backend |
| A30 | Session cookie `Secure` in prod (Auth.js HTTPS detection) | **pass (config) / verify-on-deploy (operator)** | `trustHost: true` (`auth.ts:42`) enables proxy-HTTPS detection per spec AC.16; actual flag check on deployed URL = runbook G7 operator step. Dev cookie stays http-usable (beta semantics) |
| A31 | Error tracking decision (§8: Vercel observability + pino) — no re-added Sentry | **pass** | no `@sentry` in package.json; structured pino shipped; but AC.10 verification requires C2 wiring to be meaningful |
| A32 | `db:migrate` script present | **pass** | `package.json:12–15` (`db:migrate` = `drizzle-kit migrate`) |

**Summary: pass 24 / fail 8-of-which-are-conditions (C1–C7 + deploy-verify note) / accepted risks carried (AR-1..8).**

## 2. npm audit residual (`npm audit --omit=dev`)

Result: **9 vulnerabilities — 0 critical, 2 high, 2 moderate, 5 low.**

| package | severity | via | rationale for acceptance |
|---|---|---|---|
| postcss (bundled in next) | high | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 | build-time only — postCSS stringify/sourceMap paths execute at `next build`; no runtime, no attacker-controlled CSS input path in the app; fix forces `next@16.3.5` (breaking major). **Accepted AR-4**; re-evaluate at next major bump |
| jsondiffpatch (via ai/ai-sdk) | high | GHSA-33vc-wfww-vjfv (XSS in HtmlFormatter), GHSA-j4fx-xxwh-2485 (prototype pollution in patch APIs) | the vulnerable APIs (`diff`'s HtmlFormatter / patch) are never invoked by AI SDK runtime use patterns in this app; fix forces `ai@7` major (breaking). **Accepted AR-4** |
| @ai-sdk/* transitives (5 low, 2 moderate) | low/mod | provider-utils chain | advisory noise on bundled transitive utils; no reachable runtime path documented in advisories; tracked for the next `ai` upgrade |

Both highs match the spec AC.14 expectation ("2 accepted build-time highs with rationale"). Re-run gate: any fix-flag change at dependency bump must re-run this audit before deploy.

## 3. Verdict inputs

- Core code security (auth/crypto/SSRF/IDOR/logging-redact/headers/XSS/rate limits/deleted-404): 24/24 pass.
- Phase-5 deployability/operability security items: 7 conditions (C1–C7), none of which is a *vulnerability* in shipped code — they are missing phase-5 deliverables that gate production per spec §4 (G4b/G4c/G7/G9).

Conditions live in `.orchestrator/handoffs/security-phase-5.md`.
