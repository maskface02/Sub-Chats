# Phase 1 Security Audit — Placeholder

**status:** **pending_code_review**
**phase:** 1 — Sub-Chat Core
**date:** 2026-09-13
**reviewer:** security
**spec:** `.orchestrator/specs/phase-1.md` (frozen rev 2)
**threat_model:** `.orchestrator/security/threat-models/phase-1.md`

---

## why placeholder

Backend and Frontend agents have not yet written phase-1 code. Per the role definition, this audit is a two-pass deliverable:
- **Pass 1 (this file):** spec review + pre-implementation findings → handed to Backend/Frontend as input to their implementation.
- **Pass 2 (next iteration):** actual code review once Backend + Frontend deliver. Will be appended below.

---

## spec review summary

Reviewed: `.orchestrator/specs/phase-1.md` (frozen rev 2, 700 lines, 8 user stories US-101..108, 14 phase-level ACs). 3 Orchestrator decisions applied (Q1 verified route already `/c/[id]`; Q7 added `parentId` FK; Q8 added `parentTitle`/`rootTitle`). 9 other Qs adopted PM defaults.

### spec strengths (from security POV)

1. **Cross-user 404 not 403** — explicit in US-103 AC.7 and US-107 AC.1; prevents ID enumeration (T-I-5 from phase 0).
2. **Foreign-owned ancestor returns SAME code as missing ancestor** — US-107 AC.2 mandates 503 ANCESTOR_UNAVAILABLE for both; prevents distinguishing foreign-owned from missing (T-I-1, T-I-6).
3. **Ancestor walk ownership check inside the loop** — spec §7 pseudocode shows `cursor.userId !== sessionUserId` check on every iteration; defensive against partial-chain attacks (T-E-2, T-E-7).
4. **`selectedText` slice validation with whitespace tolerance** — US-103 AC.2(d); defense against spoofed selection (T-S-3).
5. **`messageId` must belong to conversation `:id`** — explicit in US-103 AC.2; prevents cross-conversation message injection (T-S-2, T-E-5).
6. **Rate limit on branch route** — US-107 AC.4: 30 / 10 min / user; LLM cost amplification protection (T-D-1).
7. **`parentTitle` / `rootTitle` additive in GET response** — Q8 decision; one fewer round-trip; backward-compatible.
8. **Schema-ready branching columns from phase 0** — no DB migration required for fields; only `parentId` FK constraint addition (Q7, small/safe).
9. **System note model-context only** — explicit in US-105 AC.2; not persisted to `messages` table, not rendered to user; correct architectural decision (no trust-boundary pollution).
10. **`<mark>` element + CSS only for highlight** — no `dangerouslySetInnerHTML` needed; defense-in-depth for T-T-2.
11. **`new chat` placeholder title** — auto-derive only on first user message send; deterministic; no LLM latency dependency.
12. **Spec §10 explicit out-of-scope list** — 20 items enumerated; covers share/public, depth cap, rename, markdown, attachments, etc.

### spec gaps identified (full list in `threat-models/phase-1.md`)

**Top gaps requiring spec or implementation decision before code lands:**

1. **Ancestor walk O(d) round-trips for conversations** (T-D-2). Spec §7 pseudocode shows sequential `db.conversations.get(parentId)` — recommend batched fetch or recursive CTE. **Recommended for phase 1 sign-off.**
2. **Breadcrumb full-chain title fetch — SPEC GAP for depth ≥ 3** (T-D-5). GET /api/chats/:id only returns `parentTitle` + `rootTitle`; US-108 AC.3 requires full chain. Recommend additive `ancestorTitles: [{id, title, depth}]` array. **Recommended for phase 1 sign-off.**
3. **Pino redact list must extend to phase 1 fields** (T-I-8, T-R-1). Spec doesn't mention redact updates; Backend should add `*.selectedText`, `*.highlightText`, `*.highlightContext`, `*.clientHighlightContext` to pino redact.

**Secondary (recommended as additions, not blockers):**

4. **422 INVALID_SELECTION should not echo user-supplied content** (T-I-3).
5. **No explicit "no dangerouslySetInnerHTML" mandate in spec §9/§10** — phase 0 had this; phase 1 should repeat for new surfaces (banner, breadcrumb, highlight).
6. **Branch rate-limit headers not specified** — recommend mirror of phase 0 signin pattern (`X-RateLimit-*`, `Retry-After`).
7. **Migration safety note for FK** — Q7 should document NULL-allowed + backfill check before prod apply.

---

## pre-implementation findings (for Backend)

| # | finding | severity | reference |
|---|---|---|---|
| B-1 | Use `requireAuth()` at top of `POST /api/chats/:id/branch` — return 401 if missing | high | T-E-1 |
| B-2 | Use `requireConversationOwnership(:id)` helper — 404 on cross-user, NEVER 403 | critical | T-E-1, T-I-5 |
| B-3 | In branch body, use Zod `.strict()` with EXACTLY 5 fields (messageId, selectedText, charStart, charEnd, clientHighlightContext?); reject all others | critical | T-S-1, T-E-3, T-E-4, T-E-6 |
| B-4 | Server-side validation: `message.content.slice(charStart, charEnd).trim() === selectedText.trim()` — 422 INVALID_SELECTION on mismatch; never persist mismatch | critical | T-S-3 |
| B-5 | Server-side validation: message must have `conversationId === :id` AND `role === 'assistant'` — 422 on miss | critical | T-S-2, T-E-5, T-T-10 |
| B-6 | Server-side validation: `charStart >= 0`, `charStart < charEnd`, `charEnd <= message.content.length` — Zod `.int().nonnegative()` plus range check | high | T-T-5 |
| B-7 | `parentId`, `rootConversationId`, `depth`, `userId`, `createdAt` MUST be set server-side — never read from body. parentId = :id; rootConversationId = source.rootConversationId ?? source.id; depth = source.depth + 1; userId = session.user.id | critical | T-S-1, T-E-3, T-E-4 |
| B-8 | In `POST /api/chats/:id/messages` (US-105), ancestor walk MUST verify `cursor.userId === session.user.id` on EVERY iteration; throw 503 ANCESTOR_UNAVAILABLE on first miss | critical | T-E-2, T-E-7 |
| B-9 | **Implement ancestor walk as batched fetch or recursive CTE** (not sequential `db.conversations.get(parentId)`) — see hardening #1 | medium | T-D-2 |
| B-10 | On 422, `fields` contains ONLY field name + static message — never the user-supplied value (no `fields: { selectedText: <echo> }`) | medium | T-I-3 |
| B-11 | Branch route rate limit: in-memory token bucket, 30/10min/user; return 429 + `X-RateLimit-*` + `Retry-After` headers | high | T-D-1 |
| B-12 | **Pino redact extended**: add `*.selectedText`, `*.highlightText`, `*.highlightContext`, `*.clientHighlightContext` to redact list | high | T-I-8, T-R-1 |
| B-13 | Log branch events at `info` (success) / `warn` (cross-user 404) / `warn` (ANCESTOR_UNAVAILABLE); never log content fields | medium | T-R-1, T-R-2, T-R-3 |
| B-14 | `clientHighlightContext` ≤ 500 chars — Zod `.max(500)`; truncate or reject if longer | low | T-S-4 |
| B-15 | `highlightContext` (server-computed): regex `\s*[^.!?]+[.!?]+`; sentence containing charStart + 1 before + 1 after; cap at 500 chars; fall back to full content if no terminators | low | T-T-9, T-D-6 |
| B-16 | Title auto-derive on first user message: split on whitespace, take first 6 tokens, max 60 chars total; never include HTML; React-text-safe | low | T-T-12, T-E-9 |
| B-17 | Add `parentId` FK constraint `.references(() => conversations.id)` per Q7 — verify pglite compiles + safe migration (NULL allowed, no orphan rows in phase 0 dev) | low | T-T-11 |
| B-18 | GET /api/chats/:id: when loading `parentTitle`/`rootTitle`, filter by `userId === session.user.id`; set field to null on miss (defense-in-depth) | medium | T-I-5, T-E-10 |
| B-19 | GET /api/chats/:id: extend response with `ancestorTitles: Array<{id, title, depth}>` — additive, supports breadcrumb full chain at depth ≥ 3 (US-108 AC.3) | medium | T-D-5 |
| B-20 | Phase 0 message rate limit (60/min/user) applies to sub-chat conversations too — same lock, same bucket, same key (userId) | medium | T-D-3 |
| B-21 | Content-Length cap (16KB) from phase 0 hardening T-D-5 applies to `/api/chats/:id/branch` — verify middleware | low | T-D-10 |

---

## pre-implementation findings (for Frontend)

| # | finding | severity | reference |
|---|---|---|---|
| F-1 | Render `highlightText`, `parentTitle`, `rootTitle`, breadcrumb crumbs, banner source message — all via React text child (`{value}`); NEVER `dangerouslySetInnerHTML` anywhere in `src/components/chat/**` | critical | T-T-2, T-T-3, T-T-4 |
| F-2 | Highlight rendering: split source message into three text segments (before / `<mark>{highlightText}</mark>` / after); render via React text child — DO NOT inject `highlightText` into the source message HTML | critical | T-T-2 |
| F-3 | `<mark>` element styling: `bg-yellow-100` (light) / `bg-yellow-900/30` (dark) + `underline decoration-yellow-500 decoration-2` for color independence (spec §9) | low | (UX/a11y, not security) |
| F-4 | Never construct branch body with `userId`, `parentId`, `rootConversationId`, `depth`, `createdAt` — server is the source of truth | critical | T-S-1, T-E-3, T-E-4 |
| F-5 | Floating pill: 50ms debounce on `selectionchange` listener (Q10); use `requestAnimationFrame` to position pill on scroll; hide pill immediately when selection is cleared (US-101 AC.3) | medium | T-D-4, T-D-8 |
| F-6 | Right-click menu: `event.preventDefault()` only when selection is valid + inside single assistant bubble; otherwise let native menu show | low | T-D-9 |
| F-7 | On `POST /api/chats/:id/branch` 422/5xx: re-enable pill, show toast "Could not create sub-chat — try again"; source chat unchanged | low | (UX) |
| F-8 | On 201: `router.push('/c/<new-id>')` within 500ms; move focus to `<h1 tabindex="-1">` of conversation header | low | (UX/a11y) |
| F-9 | Render `parentId`/`rootConversationId` in breadcrumb ONLY when their titles are non-null; else show "Unknown" or "Private" (US-106 AC, US-107 AC.3) | medium | T-I-1, T-I-2, T-I-5 |
| F-10 | Composer placeholder: "Ask about <first-3-words-of-highlight>…" — derive from server-returned `highlightText`; plain text, React-text-safe | low | T-T-12 |
| F-11 | Error rendering: only show `error.message` from API responses — never render the full `error` object (avoids leaking selectedText from `fields`) | medium | T-I-3 |
| F-12 | Treat 403 and 404 identically in chat view: "Conversation not found" + link to `/` | low | T-I-5 (phase 0) |
| F-13 | Verify selection on RIGHT-CLICK also has guard: must lie entirely within single assistant bubble | low | (UX) |
| F-14 | On `POST /api/chats/:id/messages` 503 ANCESTOR_UNAVAILABLE: show inline banner "Sub-chat parent is unavailable — start a new chat" + "New chat" button (US-105 AC.6) | low | T-E-2 |
| F-15 | Never read AI provider env vars (`OPENAI_API_KEY`, etc.) from client code; only `NEXT_PUBLIC_*` is safe (phase 0 F-3 carries over) | critical | T-I-2 (phase 0, client variant) |
| F-16 | No client-side rate limit substitution — server is the real enforcement; client throttling is optional UX | low | T-D-1 |
| F-17 | `disable send button while sending` — prevents duplicate-submit races on client; carry-over from phase 0 F-7 | low | T-T-13 |

---

## pre-implementation findings (for DevOps)

| # | finding | severity | reference |
|---|---|---|---|
| D-1 | `.env` in `.gitignore` (verify `package.json` `.gitignore`) | critical | A02 |
| D-2 | `.env.example` documents `SUBSCHAT_SYSTEM_PROMPT` (Q11) with safe default value (current spec default string) | medium | A05 |
| D-3 | Production env: `AUTH_SECRET` rotated on schedule | medium | A02 |
| D-4 | HTTPS-only + HSTS in prod | high | T-I-12 (phase 0) |
| D-5 | `npm audit` run in CI on every PR | medium | A06 |
| D-6 | Vercel function timeout ≥ 60s on `/api/chats/:id/messages` route segment | high | T-D-6 (phase 0) |
| D-7 | No real AI keys in any non-production env | critical | T-I-2 (phase 0) |
| D-8 | Log aggregation access restricted; verify pino redact actually redacts in production logs | high | T-I-8 |
| D-9 | FK migration for `parentId` (Q7): verify Drizzle migration generates cleanly; verify pglite accepts FK; verify NULL allowed so no orphan rows possible | medium | T-T-11 |
| D-10 | Production deploy: confirm `parentId` FK backfill — any orphan rows in prod must be deleted before applying FK | medium | T-T-11 |

---

## pass 2 (code review) — to be appended

When Backend and Frontend deliver code, this section will be filled with:

- file-by-file review notes
- `npm audit` output (run by DevOps, copied here)
- verification that each pre-implementation finding above was honored
- any new findings from actual code (e.g., missed validation, leaked headers, missed ownership check, etc.)
- ancestor walk implementation review (batched vs sequential)
- final sign-off decision: `approved` | `needs-mitigation` | `rejected`

---

## sign-off

- reviewed by: security
- date: 2026-09-13
- status: **pending_code_review**
- blocking findings: 0 (all criticals have proposed mitigations)
- next pass: after Backend + Frontend delivery
