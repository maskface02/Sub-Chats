# Phase 5 Consolidated Threat Model (final)

**status:** final (pre-production sweep; live-deploy verification remains an operator task per runbook)
**phase:** 5 — Production Readiness (final gate)
**spec:** `.orchestrator/specs/phase-5.md` (FROZEN rev 2, US-509 §6 manifest §7 runbook)
**framework:** STRIDE + OWASP Top 10 (2025) — consolidated
**reviewer:** security (GLM 5.3 Flash tier)
**builds_on:** `.orchestrator/security/threat-models/phase-{0..4}.md` — NOT re-modeled; summary table below.

---

## 1. Prior-phase model closure status

| phase | model | scope | closure status |
|---|---|---|---|
| 0 | phase-0.md | auth, sessions, root chat, SSE, provider env-chain, DB layer | **closed** — all threats mitigated or accepted in shipped code (verified in `audits/phase-5.md`); T-D-1 rate limit shipped; T-I-12 TLS/HSTS transfers to phase-5 prod headers (condition C3) |
| 1 | phase-1.md | branching, ancestor walk, sub-chat validation, breadcrumbs | **closed** — T-E-1/T-E-2 ownership verified in shipped routes; T-I-8 redact extension shipped (log.ts:20–23); T-D-5 ancestorTitles resolved in phase-2 spec |
| 2 | phase-2.md | tree endpoint, split view | **closed** — T-I-1/T-I-2 single `userId`-filtered query verified (tree/route.ts:29,53,79); T-T-1/T-T-2 text-only render gate verified (zero grep hits) |
| 3 | phase-3.md | BYOK crypto, SSRF, markdown, provider CRUD | **closed** — T-I-5c redirect gap FIXED (`ssrf-guard.ts` ssrfSafeFetch, manual redirect + per-hop re-validation); T-T-3/T-T-4 GCM/IV verified (encrypt.ts); T-T-1 rehype-raw gate verified zero |
| 4 | phase-4.md | soft delete, export, edit/regenerate | **closed** — T-E-1 deletedAt filter on all ten routes verified by grep; T-I-2b deleted-ancestor handling verified in shared live-row lookups; DI-2 accepted as documented |

All four `hardening`-blocking gates from phases 3–4 (redirect policy #1, resolved-addresses #6, rate-limit reconciliation #1, deleted-ancestor #3) are resolved in shipped code.

## 2. New surface in phase 5

### 2.1 Prod deployment (new trust boundary TB-23: app ↔ production platform)

- **HSTS** — assigned to `next.config.ts` conditional on deploy env (spec AC.15, DevOps). NOT YET IMPLEMENTED — condition C3. Residual until added: no HSTS on first prod response (no downgrade-borderline risk behind Vercel TLS redirect, but required by spec).
- **Vercel env isolation** — all `process.env` reads in `src/` are server-runtime files (`ssrf-guard`-grep audit: encrypt.ts, log.ts, db/index.ts, provider.ts, stream.ts, api-client base/auth — the latter two read only non-secret base URLs). No secret ever crosses to client: client components contain zero `process.env` secret reads. `NEXT_PUBLIC_*` grep confirms only `NEXT_PUBLIC_APP_URL` exists (non-secret).
- **PITR backups** — Vercel-platform control plane; app cannot weaken it. Runbook documents retention + restore. No threat beyond operator misconfiguration.
- **X-Request-Id log correlation (AC.8/9)** — per spec §10 Q3, requestId is a **locally-generated `crypto.randomUUID()`** — server-generated, not attacker-influenced, so **log injection via requestId is not a threat** (documented here as the model decision; the log-injection vector would only exist if requestId were taken from a client header). Implementation status: `withRequestId()` exists in `src/lib/log.ts:42` but has **no callers** — US-504 wiring is a condition (C2). There is no response header echo yet either.
- **Health endpoint (AC.11)** — shipped shape deviates from spec (`src/app/api/health/route.ts`): returns `status:"ok"` always, no `dbReachable`/`providerResolved`/`migrationsApplied`, no 503 degradation, and includes `provider.baseUrl` (which for a signed-in user echoes their own provider baseUrl — own-data, low impact, but violates AC.11 "non-revealing"). Condition C5.

### 2.2 Threats (new surface only)

- **T-P5-1 (Tampering): middleware widening** — matcher covers all routes; no request body parsing in middleware → no new injection surface. likelihood: n/a.
- **T-P5-2 (Info disclosure): deployed URL verification gap** — cookie `Secure`, HSTS, header set, `NODE_ENV=production` behavior are all only verifiable on a live URL. Explicitly out of this sign-off's scope (§4 runbook G5/G6 operator tasks). Residual: misconfigured env (missing AUTH_TRUST_HOST / log level) discovered post-deploy — mitigated by §6 manifest gate.
- **T-P5-3 (DoS): health endpoint polling (phase-0 T-D-8 carry-over)** — health is unauthenticated; acceptable, low, public probe surface only. No amplification.
- **T-P5-4 (Repudiation): single-instance in-memory rate limits in prod** — Vercel may run more than one function instance; per-user buckets are per-process. Limitation pre-documented (spec §9), Upstash out of scope. **Accepted** (register #5).

## 3. Accepted-risk register (consolidated, all phases)

| # | risk | origin | decision rationale |
|---|---|---|---|
| AR-1 | **Ollama SSRF exemption** — user `ollama`-type baseUrl may target internal network addresses; semi-blind internal-request relay with body reflection | phase-3 T-I-5a/T-E-3 | by design (ollama's purpose); kill-switch `ADMIN_ALLOW_OLLAMA_USERS` spec'd — **not yet implemented (condition C4)**; revisit for any VPC/self-hosted deploy |
| AR-2 | **DNS-rebinding TOCTOU** on `custom` send-time fetch: second DNS resolution inside HTTP client can differ from validated resolution | phase-3 T-I-5b | IP-pinning not exposed by AI SDK client; attacker needs DNS authority over a public-looking name; Vercel has no high-value intranet. Re-validated per send + per redirect hop |
| AR-3 | **AUTH_SECRET↔HKDF coupling** — AUTH_SECRET compromise decrypts all stored provider keys when ENCRYPTION_KEY unset | phase-3 T-I-4 | documented fallback only; prod SHOULD set dedicated ENCRYPTION_KEY (`encrypt.ts` env-key precedence is correct); rotation coupling documented in runbook §6 |
| AR-4 | **jsondiffpatch + postcss build-time CVEs** (2 high) + 5 low + 2 moderate transitively via `ai` / `next` | npm audit (this phase) | both high CVEs are build-time only (postcss CSS stringify / source-map paths at build; jsondiffpatch XSS/prototype-pollution in diff-render APIs never called to users — fix requires breaking major upgrades of `next`/`ai`); no runtime attacker-controlled path; re-evaluated at each dependency bump. Full table in `audits/phase-5.md` |
| AR-5 | **In-memory rate limits are single-instance** (signin/messages/branch/providers/mutation buckets + in-flight stream map) | phase-0 T-D-4 residual / phase-1 residual | Vercel functions each hold their own Map; effective limit scales with instance count. Upstash out of scope (spec §9) |
| AR-6 | **Edit/regenerate truncate-on-edit destructive** — message tail hard-deleted, unrecoverable | phase-4 DI-2 (OQ-4) | user-initiated, UI copy states permanence; conversation-level undo is the only safety net |
| AR-7 | **`next-auth@5.0.0-beta.25` pre-release** | phase-0 audit note | accept + pin; stable-track upgrade tracked as backlog hygiene, not prod-blocking |
| AR-8 | **`trustHost: true`** in Auth.js config | shipped code (auth.ts:42) | required behind Vercel's proxy so session cookies get correct flags + HTTPS detection; accepted — Vercel edge normalizes Host/X-Forwarded-Host |

## 4. Residual risk

No NEW critical or high residual risk introduced by phase-5 surface. The production readiness gaps (driver switch, request logging, HSTS, ADMIN flag, health shape, CI parity) are **implementation conditions**, not new threats — they are listed in the audit and sign-off with owners.
