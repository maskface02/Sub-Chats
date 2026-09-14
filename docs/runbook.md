# Runbook — sub-chats production operations

Phase 5 (US-508). Companion: `docs/deploy.md` (env manifest, Vercel setup, first deploy).

## 1. Deploy

- Vercel push-to-deploy: every PR build → **Preview** deployment; every push to `main` → **Production**. No `vercel.json` needed (verified defaults).
- First deploy: follow `docs/deploy.md` → "First-deploy checklist".
- Every deploy is verified with: `curl https://<url>/api/health` → 200 `{status:"ok"}` then the smoke checklist (§6).

## 2. Rollback

Vercel Dashboard → Deployments → last known-good deployment → **… → Rollback** (instant, traffic reverts in seconds). DB caveat: migrations are **forward-only**. Rolling app code back to a commit that was built against a NEWER schema is safe while our DDL stays additive (drop-column-free), but check explicitly: if the rollback target predates the currently applied migrations, the DB schema is ahead of the app code — verify the older app version doesn't reference columns it doesn't know (`npx tsc --noEmit` against that commit before rolling back). Never roll the DB itself backward.

## 3. Backup / restore

- Vercel Postgres provides **point-in-time recovery (PITR)**. Retention window depends on the plan tier: Hobby ≈ days, Pro ≈ 7 days (check the dashboard "Backups" tab for the authoritative window for your plan).
- Restore procedure (no custom cron in v1 — out of scope):
  1. Vercel Postgres dashboard → **Backups → restore to a point in time** (or use **Database branching** to create a branched DB at the timestamp).
  2. Use the branched/restored DB as-is for investigation, or promote: point `DATABASE_URL` at the restored instance and redeploy.
  3. For disasters requiring operator intervention, open a Vercel support ticket with the timestamp to restore.
- `npm run db:migrate` is forward-only; a restored DB may be behind the latest migration — run `db:migrate` against it once DATABASE_URL points there.

## 4. Secret rotation

### AUTH_SECRET
- Rotation **invalidates all existing sessions** — every user is logged out and must log in again. Backfilling encrypted data is not required.
- Steps: generate `openssl rand -base64 32` → set as `AUTH_SECRET` in Vercel (Prod scope) → redeploy (env change alone doesn't restart the runtime on all plans; redeploy to be safe). Comms: notify users of forced re-login.

### ENCRYPTION_KEY
- This key decrypts every user-stored provider key (`providers.apiKeyCiphertext`).
- Rotation **REQUIRES re-encrypting every row**: for each `providers` row with a non-null `api_key_ciphertext`: decrypt with the OLD key → encrypt with the NEW key → update the row. **Doing this wrong (or losing the old key before the sweep completes) permanently loses the user's API keys** — there is no recovery; users must re-enter keys manually at best. Take a Vercel Postgres PITR backup immediately before starting.
- Steps:
  1. Snapshot the DB (branch backup, §3).
  2. Read `OLD_KEY` and `NEW_KEY` (both 32-byte base64) from Vercel (temporarily set NEW as draft var or keep locally).
  3. Scripts: fetch all providers rows; per row: AES-decrypt `api_key_ciphertext` with OLD → AES-encrypt with NEW → `UPDATE providers SET api_key_ciphertext = ? WHERE id = ?` (batched in a transaction).
  4. Verify: per-user "test provider" round-trip via `/api/providers` GET before proceeding.
  5. Set `ENCRYPTION_KEY=NEW_KEY` in Vercel Prod → redeploy; delete OLD_KEY anywhere it was staged.
- The migration script is deliberately not shipped as `db:*` command; run it from an operator machine with read/write DB credentials.

## 5. Incident response

### Health 503 triage — `GET /api/health` returns `{"status":"degraded", dbReachable, providerResolved, migrationsApplied}`
1. `dbReachable: false` → Postgres down / connection limit exhausted / wrong DATABASE_URL. Check Vercel Postgres dashboard + Vercel status (status.vercel.com).
2. `providerResolved: false` → no provider available (env keys unset AND no BYOK row yet; or OLLAMA_BASE_URL mis-set). Check env vars §6.
3. `migrationsApplied: false` → migration chain not fully applied. Run `DATABASE_URL=<prod url> npm run db:migrate`.
4. Health endpoint is anonymous-accessible but non-revealing — it contains no provider names or DSNs.

### Where logs live
- Vercel Dashboard → Project → Logs (runtime + build logs); 1-hour visibility on Hobby, longer with Pro / log drains. Structured pino JSON output: filter by level (`info`=`warn` prod default is `LOG_LEVEL`) and route.
- Every response carries `X-Request-Id` — ask the user for it (or extract from their network tab) and grep for it in logs to get the full request lifecycle: requestId, userId (when authenticated), route, status, durationMs.
- Severe incident: Rollback (§2) first, investigate after.

Post-mortem template: `.orchestrator/specs/phase-5.md` project docs — create `docs/postmortems/<date>-<slug>.md`, 5-part structure (timeline, impact, root cause, remediation, follow-ups).

## 6. Smoke checklist (US-507 AC.12)

Run on a deployed environment (prod or fresh preview) after every deploy:

| # | Step | Expected |
|---|---|---|
| 1 | Sign up with a new email (email + password) | redirected in, session cookie `Secure` set (HTTPS), user row exists |
| 2 | Create a new chat from sidebar | empty chat, "New chat" title, URL contains chat id |
| 3 | Send a message | user message + assistant response stream in; `messages` gets 2 rows |
| 4 | Highlight part of the assistant response → "branch into sub-chat" | branching works; new conversation created |
| 5 | Open the conversation tree | tree shows **2 nodes** (root chat + the sub-chat), edge from root → subtree visible |
| 6 | Delete the sub-chat batch → click undo | soft-deleted (row gone from live list) → undo restores it to the tree and live lists |
| 7 | Export the root chat as markdown | downloaded `.md` file with all messages in order |

Pass criterion: all 7 green → deployment verified. Any red → triage §5 with X-Request-Id from the failed step.
