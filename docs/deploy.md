# Deploy — Vercel setup, env manifest, first deploy

Phase 5 (US-502/503). Companion operational procedures: `docs/runbook.md`.

## 1. Env manifest (phase-5 spec §6, verbatim)

| var | required | where set | notes |
|---|---|---|---|
| DATABASE_URL | required | Vercel → Project → Environment Variables (Preview + Prod); Vercel Postgres created via dashboard | postgres:// for prod; ABSENT → pglite in-memory (dev, and ensureSchema tolerates, but dev-only) |
| AUTH_SECRET | required | Vercel env; local `.env.local` | Auth.js v5. Rotate OK (invalidates sessions); openssl rand -base64 32 |
| ENCRYPTION_KEY | required (if any BYOK users exist) | Vercel env; local `.env.local` | 32-byte base64. If unset, HKDF-derived from AUTH_SECRET — only documented fallback, NOT recommended (couples rotation of the two properties); set it in prod. Rotation → manual re-encrypt (runbook §) |
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

Completeness: this is the FULL set of env vars read by the app (grep-verified over `src/`).

## 2. Vercel setup (one-time)

1. **Project**: Vercel Dashboard → Add New → Project → import the GitHub repo. Framework preset auto-detects Next.js.
2. **Database**: Storage → Create Database → **Vercel Postgres**. Copy the `DATABASE_URL` from the .env.local table shown.
3. **Env vars** (Project → Settings → Environment Variables): add each var from §1, setting scope checkboxes:
   - `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `LOG_LEVEL`, `AUTH_TRUST_HOST=true` (or `NEXTAUTH_URL`), and any optional vars → both **Preview** and **Production**.
   - Never set `PGLITE_DATA_DIR` in Vercel.
4. `AUTH_TRUST_HOST=true` is required: Auth.js runs behind Vercel's proxy; HTTPS detection also drives the session cookie `Secure` flag.
5. **Deploy**: PR branches get Preview URLs automatically; pushes to `main` deploy to Production. No `vercel.json` needed.

## 3. Build without a live DB (US-503 / AC.7)

`next build` never connects to Postgres. Mechanism: all API route handlers are `force-dynamic` — they are not executed or type-evaluated against a live connection at build time; page prerenders that touch data are also dynamic. CI and the Vercel build therefore run with the harmless sentinel:

```
DATABASE_URL=postgres://offline:offline@localhost:5432/offline
```

The sentinel must be a `postgres://` URL (never `file:`) so the module-level driver branch (US-510) resolves to the node-postgres path lazily and never makes a connection at import/build time. Verified by `next build` in CI (`.github/workflows/ci.yml`) and by AC.7 experience locally:

```
DATABASE_URL='postgres://offline:offline@localhost:5432/offline' npx next build
```

## 4. First-deploy checklist

1. Apply migrations to the fresh database (runbook §2 note — migrations are forward-only):
   ```
   DATABASE_URL=<prod url> npm run db:migrate
   ```
2. Health: `curl -s https://<prod-url>/api/health` → expect `200 {"status":"ok", dbReachable:true, providerResolved:true, migrationsApplied:true}`; 503 ⇒ triage runbook §5.
3. Smoke checklist runbook §6 (signup → chat → send → branch → 2-node tree → delete/undo → export md) — all 7 green.
4. Spot-check session cookie is `Secure` over HTTPS; confirm `X-Request-Id` present on an API response.
5. Record audit (`npm audit`) result in the gate evidence (US-509 AC.14).
