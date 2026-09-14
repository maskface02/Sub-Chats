# Phase 5 — Production Readiness (final gate)

**status:** frozen
**frozen_on:** 2026-09-13
**frozen_revision:** 2 (7 Reviewer fixes applied by Orchestrator: US-510 prod-driver-switch keystone story + AC.18/19, US-511 CI reconciliation + AC.20, migration procedure covers 0001_soft_delete.sql + stale journal reset, ensureSchema zero-callers premise corrected + wired via US-510, §8 request-logging premise corrected, env manifest completed with grep-verified completeness, stash/hand-edit language replaced with round-trip-arbitrated procedure; 3 open questions resolved below)
**owner:** PM
**orchestrator_decisions_on_open_questions:** ADMIN_ALLOW_OLLAMA_USERS = implement now as env flag default-false (small, closes a phase-3 accept-risk); vercel.json = skip (no overrides needed); requestId = locally-generated UUID (works identically local + Vercel, no platform coupling) → frozen pending Critic review
**branch outcome:** feature-complete through phase 4; this phase ships deployability + operability only.
**rule:** NO new user-facing features. Any "while we're in there" suggestion = out of scope.

## 1. Phase overview

Sub-chats must move from "works on the dev laptop (pglite)" to "deployable on Vercel with real Postgres, observable, back-up-able, and roll-back-able." Five workstreams:

1. **DB migration path** — replace the broken-by-drift `0000_init.sql` with a regenerated chain and wire `drizzle-kit migrate` for prod.
2. **Deploy pipeline** — Vercel: preview on PR, prod on main, env manifest, build-without-live-DB verified.
3. **Observability** — pick ONE error-tracking path; complete structured request logging (requestId, userId?, route, status, durationMs).
4. **Health + smoke** — production-grade `/api/health` and a repeatable smoke checklist.
5. **Runbook + security sweep** — backup/restore, rollback, secret rotation, prod headers/cookies, admin kill-switch decision.

Schema changes: **0**. All phase-4 schema already exists (`ensureSchema` applies it to pglite at startup); phase 5 only regenerates the *migration artifacts* to match it.

## 2. User stories

**US-501 (deployer, migrations)** — As a deployer, I want a correct Drizzle migration chain generated from the current schema and a `db:migrate` script, so that `DATABASE_URL` Postgres starts with the exact schema the app expects.
**US-502 (deployer, pipeline)** — As a deployer, I want push-to-deploy on Vercel (PR → preview, main → production) with a complete env-var manifest, so that deploys are reproducible and I never discover a missing var at runtime.
**US-503 (deployer, build)** — As a deployer, I want `next build` to succeed with `DATABASE_URL` set but without a live DB, so that Vercel's build step never needs a database connection.
**US-504 (operator, observability)** — As an operator, I want every API request logged with requestId/userId?/route/status/durationMs, so that I can trace an incident from a single correlation id.
**US-505 (operator, error tracking)** — As an operator, I want server errors surfaced and grouped (error-tracking decision §8), so that I hear about failures before users report them.
**US-506 (operator, health)** — As an operator, I want `/api/health` to report DB reachability, provider resolution, and migration state in prod, so that I can verify a deployment with one `curl`.
**US-507 (operator, smoke)** — As an operator, I want a documented smoke checklist covering signup → chat → branch → tree → delete/undo → export, so that post-deploy verification is repeatable.
**US-508 (operator, runbook)** — As an operator, I want backup/restore, rollback, and secret-rotation procedures written down before first deploy, so that incident response is not improvised.
**US-509 (deployer, security final sweep)** — As a deployer, I want the prod security posture verified (headers, cookie flags, audit baseline, ADMIN_ALLOW_OLLAMA_USERS decision), so that phase-0/deferrals are all closed or explicitly accepted.
**US-510 (deployer, prod DB driver — KEYSTONE)** — As a deployer, I want `src/lib/db/index.ts` to branch on `DATABASE_URL` — `postgres://` → `drizzle-orm/node-postgres` Pool client, absent → pglite + `ensureSchema()` — so that a Vercel deploy actually talks to real Postgres instead of in-memory WASM.
**US-511 (deployer, CI reconciliation)** — As a deployer, I want `.github/workflows/ci.yml` updated to match reality (drop stale `file:` DATABASE_URL, drop broken interactive lint, quarantine the e2e job), so that CI is green and meaningful.

_stories_count: 11_

## 3. Acceptance criteria (testable)

**US-501**
1. `npx drizzle-kit generate` on the CURRENT schema produces a `0000_init.sql` that matches `src/lib/db/schema.ts` (snake_case columns, timestamptz) byte-for-diff with a **round-trip test**: fresh DB → migrate → `drizzle-kit generate` produces zero new statements.
2. Migration chain contains exactly 2 files: `0000` (full schema) and `0001` (soft-delete: `deleted_at`, `deleted_batch_id`, live-only partial index), no `0006`-style debris. The old drifted 0000 is deleted, not patched.
3. `npm run db:migrate` runs `drizzle-kit migrate` against `DATABASE_URL` and is idempotent (second run applies 0 statements).
4. A fresh Postgres instance skipped straight to migrations has all 6+ tables and indexes present — `ensureSchema()` is NOT required and prod does NOT call it. On the pglite (dev) branch of the US-510 driver switch, `ensureSchema()` IS wired into init (it currently has zero callers — US-510 wires it); on the postgres branch it is never invoked.
**US-502**
5. Env manifest in runbook lists every var (see §6) with required/optional and scope; a deploy with any required var missing fails at health-check time, not silently.
6. PRs get preview deploys; `main` deploys to production (Vercel default; documented in runbook, no vercel.json needed unless overriding behavior — verified either way).
**US-503**
7. `DATABASE_URL=postgres://offline:5432/db npx next build` passes (build does not connect; documented in runbook with the mechanism — e.g. route handlers not evaluated at build).
**US-504**
8. Every `/api/*` response in logs has requestId, route, status, durationMs; authenticated requests include userId, anonymous omit it. Pino redact list unchanged (no PII/keys/log-secrets).
9. requestId is echoed in the response (`X-Request-Id` header) so a user-reported bug maps to a log line.
**US-505**
10. Chosen path (§8) is implemented; behavior verified by triggering a dev error and finding it in the target surface.
**US-506**
11. `GET /api/health` in prod returns `{status:"ok"|"degraded", dbReachable, providerResolved, migrationsApplied}`; 200 when all ok, 503 when degraded; anonymous-accessible but non-revealing (no provider names/DSNs beyond resolved boolean).
**US-507**
12. Smoke checklist in runbook executes end-to-end on a deployed environment with all 6 steps green; script or manual procedure documented.
**US-508**
13. Runbook §: backup (Vercel Postgres PITR — document retention + how to restore; no custom cron), rollback (Vercel instant rollback, ≤1 sentence procedure), secret rotation (AUTH_SECRET → invalidates sessions, documented; ENCRYPTION_KEY → manual re-encrypt of `providers.apiKeyCiphertext` with steps).
**US-509**
14. `npm audit` result documented: 0 critical (post phase-5 prep state), 2 accepted build-time highs with rationale written down.
15. Prod response headers verified: HSTS (+ existing CSP/X-Frame-Options etc.) — only in prod, `next.config.ts` conditional on deploy env.
16. Session cookie `Secure` verified in prod (Auth.js HTTPS detection — spot-checked via cookie on deployed URL); in dev cookie remains usable over http.
17. ADMIN_ALLOW_OLLAMA_USERS explicitly decided (§10 Q3) and implemented or documented as post-launch acceptance — no in-between.
**US-510**
18. `src/lib/db/index.ts` exports a `db` whose client is `node-postgres` Pool when `DATABASE_URL` starts with `postgres://`/`postgresql://`, and PGlite otherwise; `ensureSchema()` is invoked ONLY on the pglite path (wired into the pglite branch init — it currently has ZERO callers; this AC wires it). Unit test: driver selection branches correctly for both env shapes (mock the imports).
19. `pg` + `@types/pg` added to dependencies; `next.config.ts` `serverExternalPackages` gains `pg`; no other driver deps.
**US-511**
20. ci.yml: `lint` step removed (interactive-config blocker documented in the workflow comment), `DATABASE_URL` for build/test jobs is a harmless `postgres://offline` sentinel (never `file:`), and the Playwright e2e job is commented out / `if: false` gated with a comment pointing at the §9 out-of-scope decision. CI green on the phase-5 branch.

**ac_count: 20**

## 4. Production-readiness gate checklist (§8 concretized)

| # | gate | proof |
|---|---|---|
| G1 | typecheck 0 errors | `npx tsc --noEmit` |
| G2 | all 156 unit tests pass | `npx vitest run` |
| G3 | build passes with DATABASE_URL set, no live DB | AC.7 |
| G4 | fresh-DB migrate round-trip clean | AC.1–AC.3 |
| G4b | prod driver switch verified (DATABASE_URL branch) | AC.18–19 |
| G4c | CI green + reconciled | AC.20 |
| G5 | deployed env smoke green | AC.12 |
| G6 | health endpoint verified on prod | AC.11 |
| G7 | audit + headers + cookie sweep documented | AC.14–16 |
| G8 | runbook complete (deploy/rollback/backup/secrets/incident) | AC.13 |
| G9 | observability decision implemented + log structure verified | AC.9–10 |
| G10 | docs updated (architecture.md prod DB path, README deploy section) | file diff |

Gate CLOSING = all boxes checked by Tech Writer + Security sign-off; then phase 5 is complete and the project ships.

## 5. Migration regeneration procedure (step-by-step)

> The existing `drizzle/0000_init.sql` was generated against the phase-0 schema (camelCase cols / integer timestamps) and has drifted from the current snake_case / timestamptz schema. Do NOT hand-patch it. Regenerate.

Net effect: `0000_init.sql` (full current schema incl. soft-delete columns? NO — keep soft-delete in its own statement). Generate from current schema INCLUDING phase-4 soft-delete columns, then delete all but 2 statements... **Decisioned procedurally below is a clean chain, exactly 2 statements:**

1. `git rm drizzle/0000_init.sql drizzle/0001_soft_delete.sql` (delete the drifted artifact AND the hand-written phase-4 file — it is NOT in `drizzle/meta/_journal.json` and would collide with regeneration).
2. Reset `drizzle/meta/` entirely (`git rm -r drizzle/meta`) — the journal's `dialect` field is stale (`sqlite` vs `drizzle.config.ts` `postgresql`); drizzle-kit regenerates it cleanly.
3. On a throwaway branch, temporarily remove the phase-4 `deleted_at` / `deleted_batch_id` columns + live-only partial index from `src/lib/db/schema.ts` (edit → generate → `git checkout` the schema file back; do NOT use stash — there are no uncommitted changes to stash and stash mechanics would resurrect the removal).
4. Run `npx drizzle-kit generate` → produces 0000: CREATE TABLEs for users, accounts, sessions, verification_tokens, conversations (without soft-delete cols), messages, providers + all base indexes.
5. Restore the soft-delete columns/index to the schema; run `npx drizzle-kit generate` again → produces 0001: `ALTER TABLE conversations ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_batch_id text`, plus the live-only partial index swap.
6. If and only if generate omits the DROP of the old non-partial index, hand-edit 0001 — then RE-RUN generate to confirm the snapshot yields zero further diff; the AC.1 round-trip test is the arbiter, not the hand edit.
7. Add `npm run db:migrate` (or reuse existing) = `drizzle-kit migrate`.
8. `DATABASE_URL=postgres://... npm run db:migrate` against a throwaway Postgres; then AC.1 round-trip (`drizzle-kit generate` empty); then 156 tests still pass (tests run against pglite which uses `ensureSchema`, unaffected).
9. Delete throwaway branch; commit regenerated files.

## 6. Env var manifest

| var | required | where set | notes |
|---|---|---|---|
| DATABASE_URL | required | Vercel → Project → Environment Variables (Preview + Prod); Vercel Postgres created via dashboard | postgres:// for prod; ABSENT → pglite in-memory (dev, and ensureSchema tolerates, but dev-only) |
| AUTH_SECRET | required | Vercel env; local `.env.local` | Auth.js v5. Rotate OK (invalidates sessions); openssl rand -base64 32 |
| ENCRYPTION_KEY | required (if any BYOK users exist) | Vercel env; local `.env.local` | 32-byte base64. If unset, HKDF-derived from AUTH_SECRET **— only documented fallback, NOT recommended (couples rotation of the two properties)**; set it in prod. Rotation → manual re-encrypt (runbook §) |
| AUTH_TRUST_HOST / NEXTAUTH_URL | required on Vercel | Vercel env | Auth.js behind Vercel's proxy needs trust-host set explicitly; HTTPS detection also feeds cookie Secure |
| OPENAI_API_KEY | optional | Vercel env | if set, env-chain fallback for non-BYOK users |
| ANTHROPIC_API_KEY | optional | Vercel env | ditto |
| OLLAMA_BASE_URL | optional | Vercel env | almost certainly unreachable on Vercel (local); document as dev-only |
| LOG_LEVEL | required (default info) | Vercel env | pino level; prod usually warn+info |
| ADMIN_ALLOW_OLLAMA_USERS | optional (default false) | Vercel env | per §US-509 AC.17 decision |
| AUTH_URL | optional | Vercel env / local `.env.local` | explicit base URL for Auth.js + server-side fetch base (read in src/) |
| NEXT_PUBLIC_APP_URL | optional | Vercel env | api-client base-URL fallback (read in src/) |
| SUBSCHAT_SYSTEM_PROMPT | optional | Vercel env | sub-chat system-note template override (phase 1) |
| PGLITE_DATA_DIR | dev-only | local `.env.local` | persistent pglite data dir; never set in prod |

_Completeness note: grep of `src/` confirms these are ALL env vars read by the app — no other `NEXT_PUBLIC_*` or `process.env` keys exist._

## 7. Deploy + rollback runbook outline

1. One-time: create Vercel Postgres instance, copy DATABASE_URL, run step-5 migrations.
2. Configure env vars per §6 (Preview + Production scopes).
3. Deploy: PR push → preview; main push → prod. Build must not touch DB (AC.7).
4. First-prod verification: health check (AC.11) + smoke (AC.12).
5. Rollback: pull Vercel instant rollback one-liner. Note migration incompatibility caveat: if a rollback goes to a commit whose schema predates the current migrations, DB must be migrated manually — document because we have only ever had additive DDL.
6. Backup/restore: Vercel Postgres PITR window documented; restore procedure = create branch/new DB from PITR then point DATABASE_URL; no custom cron (out of scope).
7. Secret rotation: AUTH_SECRET (sessions invalid), ENCRYPTION_KEY (manual re-encrypt; step-blocked behind v1 prefix check on ciphertext).
8. Incident response basics: check health, check Vercel status, check logs surface, rollback if severe, post-mortem template location.

## 8. Observability decision + rationale

**Decision: (b) Vercel observability only for v1 + structured pino request logging.**

Rationale:
- Sentry was already removed in phase-5 prep (unused dep, 2 CVEs killed). Re-adding now costs instrumentation work (instrumentation.ts, client init, DSN wiring, PII redaction review against pino redact list) and a new vendor surface conditioned on handler exceptions — and re-introduces a dep that immediately gets CVE-scanned.
- Structured pino logging (requestId/route/status/durationMs + `X-Request-Id` echo) is NOT pre-existing — `src/middleware.ts` today does header hardening only and `withRequestId()` has no callers. It is a US-504 deliverable (AC.8–9), built in this phase.
- Vercel's built-in observability gives free wall clock + log drains for scaling later; www when SLOs justify it.
- Revisit only if: users report a bug structure Vercel logs can't cluster, or DSN-keyed group-by becomes necessary.

Explicit non-decision: NOT re-adding @sentry/nextjs for v1. (architecture.md "Sentry SDK installed" note is stale — Tech Writer must update remove that line.)

## 9. Out of scope

- Custom domain / DNS / TLS config on Vercel.
- Rate limiting via Upstash Redis (in-memory stays; documented single-instance limitation).
- Multi-region, CDN tuning, image optimization, first-load-JS reductions.
- E2E in CI (Playwright needs a live provider; documented as manual gate).
- Load testing.
- Terms of service / privacy policy pages.
- Any new user-facing feature (by §1 rule).

## 10. Open questions

1. **ADMIN_ALLOW_OLLAMA_USERS** — implement env flag now or document as post-launch acceptance? Default: implement (small diff); Orchestrator pre-approves.
2. **vercel.json** — likely unnecessary (Vercel defaults); verify `next build`/regions/behavior match and skip the file if untouched — OR write it if override is needed. Default: no file.
3. **Pino requestId source** — use `crypto.randomUUID()` per request, or Vercel's request-id when available? Default: local UUID; correlate via runbook.

**open_questions: 3**

## 11. Definition of done

Phase 5 is done when ALL of the following are true:
- §4 gate checklist: all 10 gates GREEN with evidence linked.
- `.orchestrator/decisions/` updated with the ADMIN_ALLOW_OLLAMA_USERS + no-sentry entries and any §10 resolutions.
- `docs/architecture.md` prod-DB section (currently stale: says SQLite dev / better-sqlite3 references) rewritten to pglite-dev/drizzle-kit-migrate-prod; README deploy section added.
- Deployed env beats phase-4 baseline: 156/156 tests, 0 type errors, clean audit log, runbook reviewed by Security.
- Spec frozen after Critic review; STATE.md updated.

## 12. Self-review (pre-freeze)

- Ac count 17, stories 9 — every story has ≥1 AC; no vague ACs; testable per-discipline where possible.
- Out-of-scope list prevents: Upstash rate limit, T-R, E2E CI, load testing, domain setup.
- Missing-in-draft caught: `X-Request-Id` header echo (added AC.9), "roll-bk to pre-migration commit" caveat added in runbook §5, stale `.env.example`/`architecture.md` docs flagged (G10 + §11).
