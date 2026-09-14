# Handoff — Tech Writer, phase 5 (production readiness)

**date:** 2026-09-14
**phase:** 5
**spec:** `.orchestrator/specs/phase-5.md` (frozen rev 2)
**decisions:** §8 (Vercel observability + pino, no Sentry), §10 resolutions (ADMIN_ALLOW_OLLAMA_USERS env flag default-false; no vercel.json; locally-generated UUID requestId)

## Files

| file | change |
|---|---|
| `README.md` | Final pass: badges → v1.0.0 production-ready (phase badge retired); blockquote now a release summary linking RELEASE_NOTES.md; features lead-in corrected to "phases 0–4" (list already covered all shipped features); new **Deploy** section — 5-step quick deploy (Vercel Postgres, preview/prod, env vars, `db:migrate`, health verify) linking `docs/deploy.md`; Screenshots section replaced with a 14-row placeholder capture table (owner UX); Quick start fixed (removed stale `db:push`/"SQLite database" line — pglite auto-bootstraps); architecture diagram SQLite → pglite; tech stack Drizzle line updated + pino added; roadmap rewritten as shipped phase list 0–5 + explicit not-shipped list |
| `docs/architecture.md` | Stale lines fixed (intro date, diagram dialect, data-layer SQLite/better-sqlite3 → driver switch, rate-limit "phase 1 may move to Upstash" → v1 single-instance limitation, **Sentry security note removed** per §8 explicit non-decision, deferred-decisions Postgres bullet marked resolved); new **Production topology (phase 5)** section: DATABASE_URL driver-switch table (pglite+ensureSchema dev-only vs node-postgres Pool + drizzle-kit migrate), build-without-live-DB note, migration chain (0000 + 0001, idempotent, round-trip test), prod health contract (200/503, non-revealing), request-logging correlation (requestId UUID → `X-Request-Id` echo, pino redact unchanged), one-paragraph Vercel-observability rationale with revisit criteria |
| `docs/api/endpoints.md` | `GET /api/health` entry rewritten: prod shape `{status, dbReachable, providerResolved, migrationsApplied}`, 200/503 semantics with `curl -sf` verification, non-revealing rule (booleans only — no provider names/models/URLs/DSNs); local dev keeps the richer banner-driving shape; See-also gains architecture production-topology anchor, `deploy.md`, `RELEASE_NOTES.md`, phase-5 spec |
| `RELEASE_NOTES.md` | NEW — per-phase user-facing summary (phases 0–5, 5–6 bullets each, written for users not devs) + known-limitations section (in-memory single-instance rate limits; ADMIN_ALLOW_OLLAMA_USERS=true gate for user Ollama providers; E2E as manual gate; markdown renders after stream completes) |
| `.orchestrator/handoffs/tech-writer-phase-5.md` | NEW — this file |

No code files touched (role constraint: docs only).

## Link check

Scripted check over all 4 modified/new markdown files (fenced code blocks excluded; internal targets verified for file existence + GitHub-style anchor match against actual headings):

**links_checked:** 48 · **broken_links:** 0

- All 21 internal links resolve (files + anchors), including `docs/deploy.md` and `docs/runbook.md` — DevOps published both mid-pass (08:24), so the README deploy link resolves.
- 27 external links are well-known project/vendor homepages (shield badges, nextjs.org, authjs.dev, orm.drizzle.team, getpino.io, sdk.vercel.ai, assistant-ui.com, ui.shadcn.com, tanstack.com, airbnb.io/visx, zod.dev, ollama.com, github vercel/chatbot + react-resizable-panels, npmjs bcrypt) — not fetched, standard stable URLs.
- Note: `docs/getting-started.md` was NOT modified (outside this phase's owned paths) — its links were not re-verified beyond earlier phases.

## Doc debt (final)

1. **Screenshots — owner UX.** README now carries a 14-row placeholder table (sign-in, chat list, streaming conversation, highlight→pill→sub-chat, tree sidebar + mobile drawer, split view, provider settings, export menu, delete dialog + undo toast, tree search, stop chip, edit/regenerate, shortcut overlay, code block light+dark). One capture pass covers phases 0–4; table cells get checked off as captures land.
2. **`docs/getting-started.md` staleness — owner Tech Writer, next pass.** Still describes the pre-pglite world: §2 optional table says `DATABASE_URL` defaults to `file:./local.db` (SQLite) and lists `SENTRY_DSN`; §3 says "Phase 0 uses SQLite… `npm run db:push`" + `local.db`/SQLITE_BUSY troubleshooting; "Verifying the provider" shows only the dev health shape (fine locally, but should note the prod shape differs — now cross-linked from endpoints.md). Also `.env.example` still carries the stale `SENTRY_DSN` block (file is Tech Writer-owned per phase-1 handoff).
3. **`docs/architecture.md` residual phase-era phrasing** — sections labeled "(phase 0 shape)" / "foreshadowing phase 1" / "phase 2" are historically accurate but read as forward-looking; a v1.1 docs pass could retime them to present tense. Cosmetic only.
4. **Auto-generated API reference** — role DoD mentions OpenAPI generation; endpoints.md is hand-maintained. Not a phase-5 blocker; flagged for the contributor-guide pass.

## Code-vs-docs drift observed during this pass (for Orchestrator — docs describe the frozen contract)

Docs were written to the frozen spec (per phase-5 gate G10). At writing time the working tree showed phase-5 implementation mid-flight; these must land before the gate closes or the docs will describe behavior the code doesn't have yet:

- `src/lib/db/index.ts` — still pglite-only; `DATABASE_URL` branch (US-510) not yet visible in the file; `pg`/`@types/pg` not yet in package.json.
- `src/app/api/health/route.ts` — still returns the dev shape only; prod `{status, dbReachable, providerResolved, migrationsApplied}` + 503 (US-506) not yet implemented.
- `src/middleware.ts` — request-id/structured request logging (US-504, `X-Request-Id` echo) not yet visible.
- `ADMIN_ALLOW_OLLAMA_USERS` — no references in `src/` yet (US-509 AC.17); documented as shipped behavior in RELEASE_NOTES.
- `drizzle/` — regeneration procedure in progress on disk (new `0000_init.sql` + `0001_noop.sql` + fresh meta; old files staged for deletion). The `0001_noop` name suggests the §5 two-step generate hasn't produced the soft-delete statement yet — docs assume the final 2-statement chain per AC.2.
- `.env.example` — updated for pglite already; missing `ADMIN_ALLOW_OLLAMA_USERS` entry (env manifest in deploy.md has it).

## Gate note (G10)

G10 ("docs updated: architecture.md prod DB path, README deploy section") is satisfied by this pass. The remaining §4 gates are owned by other roles; Security sign-off + Critic review of these docs still pending per role DoD.
