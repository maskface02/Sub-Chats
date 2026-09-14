# Security Sign-off — Phase 5 (Production Readiness)

**date:** 2026-09-14
**reviewer:** security (GLM 5.3 Flash tier)
**basis:** `.orchestrator/security/audits/phase-5.md` (32 checks, full sweep) + consolidated threat model `.orchestrator/security/threat-models/phase-5.md` + all prior phase models

---

## Verdict: **APPROVED WITH CONDITIONS**

The shipped code is secure as audited: authentication, AES-256-GCM key storage, SSRF guard (including the redirect-following gap from phase 3's blocking hardening item), per-user/per-bucket rate limits, IDOR-safe routing with deleted-conversation 404 parity, markdown XSS posture, secrets handling, pino redaction, and response headers all verified passing. **No vulnerability is open in shipped code.**

Production approval, however, is conditioned on closing the phase-5 deliverables below, which the sweep found NOT yet implemented in code or config.

---

## Conditions (each must be closed and re-checked before/at first deploy)

| # | condition | owner | target |
|---|---|---|---|
| C1 | **Prod DB driver switch (US-510, AC.18/19):** `src/lib/db/index.ts` must branch on `DATABASE_URL` → `node-postgres` Pool; `ensureSchema()` wired to the pglite (dev) branch only; `pg` + `@types/pg` deps + `serverExternalPackages: "pg"`. Today it is pglite-only — a Vercel deploy would run in-memory, i.e. silently wrong, not just degraded. | Backend | before first prod deploy |
| C2 | **Request logging (US-504, AC.8/9):** wire `withRequestId()` (exists in `src/lib/log.ts:42`, zero callers) through request middleware; log requestId/route/status/durationMs (+userId?); echo `X-Request-Id`. requestId = locally-generated `crypto.randomUUID()` per §10 Q3 — server-generated, NOT client-supplied, so log injection via requestId is structurally excluded (documented in threat-model §2.1). | Backend | before first prod deploy |
| C3 | **HSTS in prod (AC.15):** add conditional HSTS header via `next.config.ts` (deploy-env conditional per spec). | DevOps | before first prod deploy |
| C4 | **`ADMIN_ALLOW_OLLAMA_USERS` flag (AC.17, spec decision: implement now, default false):** zero references in `src/` today — the ollama create path (accepted-risk AR-1) currently has no prod kill-switch. | Backend | before first prod deploy |
| C5 | **Health endpoint shape (AC.11):** `{status, dbReachable, providerResolved, migrationsApplied}`, 503 when degraded, non-revealing. Current route (`src/app/api/health/route.ts`) is always-ok and echoes `provider.baseUrl` (own-data, spec-violating). | Backend | before first prod deploy |
| C6 | **CI reconciliation (US-511, AC.20):** `.github/workflows/ci.yml` still uses stale `file:` DSNs (lines 23, 60), runs the interactive lint step (line 42), and runs the unguarded e2e job (lines 53–84). | DevOps | before first prod deploy |
| C7 | **Migration chain (AC.1/2):** `drizzle/` contains `0001_noop.sql` + stale meta journal, not the spec'd regenerated `0000` + `0001_soft_delete` chain with the AC.1 round-trip proof. The audit could not execute the round-trip test (AC.1/3). | Backend + DevOps | before first prod migrate |

Closing C1–C7 requires only a re-run of the affected audit rows (A19, A25–A29) — a small delta, not a re-audit.

**Deployment verification (not a condition — operator task):** the runbook G5/G6/G7 items — `curl /api/health` on the live URL, the 6-step smoke, and the deployed-URL header/`Secure`-cookie check — are explicitly OUT of this sign-off's scope. This sign-off covers **code + config only**, per the runbook; the live deployment must still be verified by an operator (AC.12, AC.16) before traffic.

---

## Accepted-risk register (verbatim from threat-model §3)

| # | risk | origin | decision rationale |
|---|---|---|---|
| AR-1 | Ollama SSRF exemption — user `ollama`-type baseUrl may target internal network addresses; semi-blind internal-request relay with body reflection | phase-3 T-I-5a/T-E-3 | by design (ollama's purpose); kill-switch `ADMIN_ALLOW_OLLAMA_USERS` spec'd — not yet implemented (condition C4); revisit for any VPC/self-hosted deploy |
| AR-2 | DNS-rebinding TOCTOU on `custom` send-time fetch: second DNS resolution inside HTTP client can differ from validated resolution | phase-3 T-I-5b | IP-pinning not exposed by AI SDK client; attacker needs DNS authority over a public-looking name; Vercel has no high-value intranet. Re-validated per send + per redirect hop |
| AR-3 | AUTH_SECRET↔HKDF coupling — AUTH_SECRET compromise decrypts all stored provider keys when ENCRYPTION_KEY unset | phase-3 T-I-4 | documented fallback only; prod SHOULD set dedicated ENCRYPTION_KEY (`encrypt.ts` env-key precedence is correct); rotation coupling documented in runbook §6 |
| AR-4 | jsondiffpatch + postcss build-time CVEs (2 high) + 5 low + 2 moderate transitively via `ai` / `next` | npm audit (phase 5) | both high CVEs are build-time only; no runtime attacker-controlled path; fixes force breaking major upgrades of `next`/`ai`; re-evaluated at each dependency bump |
| AR-5 | In-memory rate limits are single-instance (signin/messages/branch/providers/mutation buckets + in-flight stream map) | phase-0/1 residual | per-process Maps; effective limit scales with Vercel instance count; Upstash out of scope (spec §9) |
| AR-6 | Edit/regenerate truncate-on-edit destructive — message tail hard-deleted, unrecoverable | phase-4 DI-2 (OQ-4) | user-initiated, UI copy states permanence; conversation-level undo is the only safety net |
| AR-7 | `next-auth@5.0.0-beta.25` pre-release | phase-0 audit note | accept + pin; stable-track upgrade tracked as backlog hygiene |
| AR-8 | `trustHost: true` in Auth.js config | shipped code (auth.ts:42) | required behind Vercel's proxy for correct cookie flags + HTTPS detection; accepted — Vercel edge normalizes Host |

---

## Sign-off scope statement (explicit)

- This sign-off covers the **codebase and configuration at the reviewed commit**.
- It does NOT certify a live deployment: health, smoke, cookie `Secure` on the deployed URL, and header verification on the real origin remain **operator tasks per the runbook** (spec §7 step 4, gates G5/G6).
- Conditions C1–C7 are deployment blockers, not code vulnerabilities; the verdict on shipped code is pass. If C1–C7 are unresolved at first-deploy time, this verdict downgrades to **NOT APPROVED**.
