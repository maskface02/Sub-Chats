# Phase 0 Security Audit — Placeholder

**status:** **pending_code_review**
**phase:** 0 — Setup + Root Chat End-to-End
**date:** 2026-09-13
**reviewer:** security

---

## why placeholder

Backend and Frontend agents have not yet written code. Per the role definition, this audit is a two-pass deliverable:
- **Pass 1 (this file):** spec review + pre-implementation findings → handed to Backend/Frontend as input to their implementation.
- **Pass 2 (next iteration):** actual code review once Backend + Frontend deliver. Will be appended below.

---

## spec review summary

Reviewed: `.orchestrator/specs/phase-0.md` (frozen rev 2, 661 lines, 8 user stories, 4 PM fixes applied).

### spec strengths (from security POV)

1. **Email + password only** — defers OAuth/magic-link/MFA correctly (less attack surface in phase 0).
2. **DB sessions, not JWT** — enables server-side revocation on signout (T-S-3 mitigation).
3. **bcrypt cost 12** — explicit, prevents weak hash (A02).
4. **Cross-user 404 (not 403)** — explicit, prevents enumeration (T-I-5, A01).
5. **Sign-in rate limit 5/15min/IP** — explicit, addresses credential stuffing (A07).
6. **Schema-ready branching columns** — `parentId`, `rootConversationId`, `depth`, `highlightText`, `highlightContext` present from day 1; future migrations minimized.
7. **Single in-flight stream lock** — explicit, prevents stream interleaving / cost amplification (A04).
8. **`providerId` and `model` set server-side** — explicit in spec §5 AC.5 (T-E-5 mitigation).
9. **Plain text message rendering in phase 0** — eliminates XSS surface (T-T-3).
10. **AUTH_SECRET in `.env.example`** with rotation comment — good defaults.

### spec gaps identified (full list in `threat-models/phase-0.md`)

Top 4 gaps requiring spec or implementation decision before code lands:

1. **No rate limit on `/api/chats/:id/messages`** — cost amplification vector. Recommended: 60/min/user + 500/hr/user.
2. **No `Content-Length` cap at API edge** — recommended 16KB.
3. **No max stream duration cap** — recommended 5 min.
4. **No `Cache-Control: no-store` on SSE** — proxy could cache streamed content.

Secondary (recommended as Vitest additions, not blockers):
- cross-user 404 (not 403) explicit test
- callbackUrl off-origin rejection explicit test

---

## pre-implementation findings (for Backend)

These are items Backend should bake in from line 1 — easier than retrofitting.

| # | finding | severity | reference |
|---|---|---|---|
| B-1 | Use a `requireAuth()` helper that calls `auth()` and throws 401 if missing — apply at top of every protected handler | high | T-E-3, T-E-4 |
| B-2 | Never read `userId` from request body or query — always from `session.user.id` | critical | T-S-5, T-E-6 |
| B-3 | Use Zod `.strict()` on all POST schemas — rejects unknown fields (mass-assignment defense) | high | T-T-7 |
| B-4 | Signin error: identical message for wrong email vs wrong password | medium | T-S-1 |
| B-5 | `callbackUrl` validation: must start with `AUTH_URL` origin; reject otherwise | high | T-S-2 |
| B-6 | `requireConversationOwnership(conversationId)` helper: 404 on cross-user, never 403 | critical | T-E-1, T-E-2, T-I-5 |
| B-7 | Production error handler: catch all, log internally, return `{error:{code:'INTERNAL',message:'Something went wrong'}}` | high | T-I-1, T-I-3 |
| B-8 | pino `redact` config: include `*.email`, `*.passwordHash`, `*.OPENAI_API_KEY`, `req.headers.cookie`, `req.headers.authorization` | critical | T-I-2, T-I-6 |
| B-9 | `secureHeaders` middleware applied to every response (see handoff for values) | high | T-I-8 |
| B-10 | Provider errors: log full body server-side, return generic code to client | medium | T-I-4 |
| B-11 | Drizzle: no `sql\`\`` outside `drizzle/` migrations folder | critical | T-T-1 |
| B-12 | `authorize()` returns explicit allowlist `{id, email, name, image}` — never spread | high | T-E-7 |
| B-13 | Stream lock: use Promise-based mutex, not 100ms race | low | T-T-6 |
| B-14 | `passwordHash` never in any JSON response — code review grep for `.select()` on users | critical | T-I-9 |
| B-15 | `/api/health` returns explicit builder, never reads from DB | low | T-I-10 |

---

## pre-implementation findings (for Frontend)

| # | finding | severity | reference |
|---|---|---|---|
| F-1 | Render messages via `{message.content}` only — never `dangerouslySetInnerHTML`, no markdown lib in phase 0 | critical | T-T-3 |
| F-2 | Never construct request bodies with `userId`, `providerId`, `model` fields — server is the source of truth | critical | T-E-5, T-E-6 |
| F-3 | Never read `process.env.OPENAI_API_KEY` or any AI key in client code (Next.js will inline at build — verify) | critical | T-I-2 (client variant) |
| F-4 | Sign-out form must include Auth.js CSRF token (Auth.js handles this if you use its built-in component) | high | T-S-4 |
| F-5 | Don't render raw error objects from API — only `.error.message` (avoid leaking provider details) | medium | T-I-4 |
| F-6 | Client-side rate limit is UX only — server is the real enforcement. Client throttling is optional | low | T-D-1 |
| F-7 | Composer should disable send button while sending (prevents duplicate-submit races on client) | low | T-T-6 |
| F-8 | `callbackUrl` passed to `/signin` only via same-origin redirect (e.g. middleware setting it) | medium | T-S-2 |

---

## pre-implementation findings (for DevOps)

| # | finding | severity | reference |
|---|---|---|---|
| D-1 | `.env` in `.gitignore` (verify `package.json` `.gitignore`) | critical | A02 |
| D-2 | `.env.example` documents every var, no real values | medium | A02 |
| D-3 | Production env: `AUTH_SECRET` rotated on a schedule (phase 1) | medium | A02 |
| D-4 | HTTPS-only + HSTS in prod (phase 1) | high | T-I-12 |
| D-5 | `npm audit` run in CI on every PR | medium | A06 |
| D-6 | Vercel function timeout ≥ 60s on `/api/chats/:id/messages` route segment | high | T-D-6 |
| D-7 | No real AI keys in any non-production env | critical | T-I-2 |
| D-8 | Log aggregation access restricted (redacted fields actually redacted) | high | T-I-6 |

---

## pass 2 (code review) — to be appended

When Backend and Frontend deliver code, this section will be filled with:

- file-by-file review notes
- `npm audit` output (run by DevOps, copied here)
- verification that each pre-implementation finding above was honored
- any new findings from actual code (e.g. missed validation, leaked headers, etc.)
- final sign-off decision: `approved` | `needs-mitigation` | `rejected`

---

## sign-off

- reviewed by: security
- date: 2026-09-13
- status: **pending_code_review**
- next pass: after Backend + Frontend delivery
