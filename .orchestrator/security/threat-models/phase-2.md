# Phase 2 STRIDE Threat Model

**status:** preliminary (code not yet written — pre-implementation review)
**phase:** 2 — Tree-Map Visualization + Split View
**spec:** `.orchestrator/specs/phase-2.md` (frozen rev 2)
**framework:** STRIDE + OWASP Top 10 (2025)
**reviewer:** security (GLM 5.3 Flash tier)
**builds_on:** `.orchestrator/security/threat-models/phase-1.md` (baseline; all phase-1 threats carry over unchanged)

---

## scope

Phase 2 adds two read-only navigation surfaces:

1. **NEW** — `GET /api/chats/:id/tree` (US-201, US-207) — returns the FULL subtree rooted at the conversation's ROOT in a single `(rootConversationId, userId)`-filtered query, DFS-pre-order-capped at 500 nodes, with `totalNodes` pre-truncation count.
2. **MODIFIED (client)** — tree-map sidebar (desktop panel / mobile drawer) rendering the tree with `@visx/hierarchy`, tooltips showing FULL title + createdAt (US-202, US-203).
3. **MODIFIED (client)** — split view with `react-resizable-panels`: two independent ChatView instances, two concurrent SSE streams (US-204..206).
4. **NEW (client state)** — split store (Zustand) holding the secondary pane's conversation id.

No DB changes, no mutation endpoints — phase 2 is a **read-only API phase**. Markdown rendering, rename, delete stay deferred (spec §10). Phase 1 surfaces (branch, messages, ancestor walk) are unchanged and not re-modeled here beyond interaction effects (split doubles concurrent use).

---

## data flows

1. **Tree fetch.** Client (on chat-view mount / after branch creation per US-202 AC.3) → `GET /api/chats/:id/tree` with session cookie → `requireAuth()` → load `:id` row filtered by `userId = session.user.id` (404 on miss/foreign) → resolve `rootId = rootConversationId ?? :id` → single `SELECT ... WHERE rootConversationId = :rootId AND userId = :session` → in-memory parent→children assembly → optional 500-node DFS cap → 200 `{root, currentId, totalNodes, truncated}`.
2. **Tree render.** Client maps nodes to `@visx/hierarchy` layout; node titles + 📌 + createdAt tooltip rendered as React text.
3. **Node navigation.** Click / Enter on treeitem → client-side navigate to `/c/<id>` → existing phase-1 `GET /api/chats/:id` (404 page per phase 1 if deleted/foreign).
4. **Split open.** "Split" button → picker (data from already-fetched tree, no new request) → Zustand split store receives `secondaryId` → second `<ChatView>` mounts → its own `GET /api/chats/:id`.
5. **Split streaming.** Each pane has instance-scoped SSE client (no module-level state — US-204 AC.4) → both streams may run concurrently (US-205 AC.2) → close aborts the pane's stream (US-206 AC.2).
6. **Rate limits hit on each pane independently.** Existing per-user message limits apply globally (per user, not per conversation) → the split pane cannot raise the user's per-user ceiling.

---

## trust boundaries

(Re-using TB-1..11 from phase 1 where applicable; new boundaries in bold.)

- **TB-12 (NEW):** Frontend split store (Zustand, client-owned) ↔ API ownership model. Threat: the client crafts a `secondaryId` belonging to another user (or a deleted conversation). The pane's `GET /api/chats/:id` returns 404. Server is safe (phase-1 ownership check covers it); the risk is client-side — the pane must degrade gracefully. This is the "trust nothing from the split store" boundary.
- **TB-13 (NEW):** Tree endpoint bulk-read surface. Unlike `GET /api/chats/:id` (one row), the tree endpoint returns potentially 500 rows of metadata in one response — an amplified IDOR blast-radius if the ownership filter is wrong even once.
- **TB-14 (NEW):** Tooltip / traversal title rendering ↔ DOM. Same class as TB-9: user-controlled titles must be text children, never HTML.

---

## threats (STRIDE)

### Spoofing

- **T-S-1: No new spoofing surface.** Tree endpoint takes no body; path param is a UUID validated to 404 on parse failure. Split flows send no new server-writable identity fields (pane params are re-fetched via `GET /api/chats/:id`, ownership-checked). Session spoofing is inherited from phase 0/1 posture.
  - likelihood: n/a; impact: n/a
  - mitigation: nothing new required; carry-over checks (auth, cookie flags) apply.

### Tampering

- **T-T-1: SVG tree node rendering via `dangerouslySetInnerHTML`.**
  `@visx/hierarchy` renders SVG; node labels show conversation titles (user-controlled, auto-derived from message content). If the TreeNode implementation sets `dangerouslySetInnerHTML` (a known @visx `<text>` shortcut via `@visx/text`'s multi-line rendering or hand-rolled `<text>` hydration), a title like `<img src=x onerror=...>` becomes DOM XSS.
  - likelihood: medium (SVN text wrapping is a common shortcut); impact: high (XSS, self-XSS only in phase 2 — single-user trees — but the pattern persists)
  - mitigation: node titles rendered as React text children inside `<text>`; prohibit `dangerouslySetInnerHTML` in all phase-2 components (grep gate). See checklist.

- **T-T-2: Tooltip content injection.** Tooltip shows FULL title + created date. Same class — must be text. No markdown, no HTML (markdown was explicitly deferred to phase 3).
  - likelihood: low; impact: medium
  - mitigation: text children only; tooltip is a plain positioned div.

- **T-T-3: Split store holds foreign/deleted `secondaryId`.**
  User edits client state (Zustand devtools, console script) → pane issues `GET /api/chats/<foreign-id>` → 404. Threat: pane code retries in a loop (unbounded 404 fetch churn) or its error handling crashes (unmounts SplitView, or worse, runs an error state that throws during render → Next.js error boundary takes down BOTH panes).
  - likelihood: medium (trivial to do); impact: low (self-DoS of own UI — no server impact; phase-1 server ownership holds)
  - mitigation: Frontend treats per-pane 404 as a terminal pane state ("Conversation not found", no retry, no refetch loop); SplitView must never crash from one pane's failure (US-204 AC.7 already requires isolation). Add Playwright case.

- **T-T-4: Drizzle parameterization carry-over.** New tree query is a single parameterized SELECT with two literals (`rootId`, `userId`). No raw SQL.
  - likelihood: very low; impact: critical
  - mitigation: same code-review ban as phase 1 T-T-1.

- **T-T-5: No tampering in tree assembly.** Tree ordering (`createdAt ASC`, DFS pre-order) is server-computed from server-owned columns; client renders the server's payload verbatim. No client input re-enters the tree before render.
  - likelihood: n/a; impact: n/a
  - mitigation: n/a.

### Repudiation

- **T-R-1: No audit of tree reads.** Tree fetches reveal a user's own data only; per-tenant audit value is low. But a 404 on `:id` should log at `warn` for probing telemetry, consistent with phase 1 T-R-2.
  - likelihood: n/a; impact: low
  - mitigation: log `warn` on tree 404 `{route, userId, attemptedConvId, requestId}` — no content. No other logging change needed (tree response contains only own-row metadata; titles must NOT be logged — add `*.title` handling at code-review time if tree logs ever row-dump).

### Information Disclosure

- **T-I-1: Cross-user tree enumeration via missing `userId` filter on the subtree query — HIGH.**
  Spec mandates the subtree query filter `WHERE rootConversationId = :rootId AND userId = :session` (US-207 AC.2, §5 step 3). Threat scenario: Backend resolves `rootId` from an ownership-checked `:id` row, then fetches the subtree WITHOUT the `userId` filter, reasoning "the root is owned, so its subtree must be owned". That reasoning breaks under inconsistency: a `parentId`/`rootConversationId` thread could (via buggy branch logic, manual DB edits, or a future bug) make a foreign conversation a descendant of the user's root. The single-filtered-query is the ONLY structural guarantee.
  - likelihood: low (spec is explicit, one query, easy) ; impact: **critical** (full metadata leak of a foreign subtree — titles, timestamps, structure; with title auto-derivation from user messages, this leaks message-derived content)
  - mitigation: the single query filters BOTH `rootConversationId` AND `userId`, per spec. Code review: one query, both filter literals — no post-filtering in JS as sole control (JS filter acceptable only as defense-in-depth). Vitest: foreign descendant injected into a user's root is NOT returned.

- **T-I-2: Ownership check on `:id` but not on the resolved root.**
  Threat: if `rootConversationId` on the user's `:id` row points to a foreign conversation (tampered/corrupt row), and Backend fetches the root row without an ownership filter, the response could bootstrap the tree at a foreign root. Mitigation: the tree assembly builds from the `userId`-filtered subtree query result — the root node is "the row with `id === rootId`" *within that filtered set*. If the root itself is absent from the filtered set (foreign), the assembly must 404, not synthesize a root from an unfiltered read.
  - likelihood: low (needs row corruption); impact: high (foreign root's whole subtree leaked)
  - mitigation: root node selected ONLY from within the already-`userId`-filtered rows; spec §5 step 4 read carefully by Backend — "Root node = the row with `id === rootId`" means among the filtered rows. If missing → 404 INTERNAL-safe. Vitest case.

- **T-I-3: `totalNodes` reveals full subtree size even when truncated.** Attacker = user themselves; data is their own. Accepted by design (spec documents the count for the "Showing 500 of N" notice).
  - likelihood: n/a (own data); impact: none
  - mitigation: none required — but the count must be computed with the same `userId` filter as the fetch (otherwise the count itself becomes a cross-user metadata oracle in the inconsistent-data scenario; see T-I-1).

- **T-I-4: Response time / size distinguishes "exists but foreign" from "missing".** Spec US-207 AC.3 mandates byte-identical 404s and ≤ 50ms delta. The two 404 paths (missing row vs foreign row) must take the same code path: the phase-0 `requireConversationOwnership` pattern (`WHERE id = :id AND userId = :session` in ONE query) gives this for free. Threat: Backend implements two-step "load row → compare userId" and short-circuits, giving a timing oracle.
  - likelihood: low; impact: low (uuid-space makes enumeration useless anyway)
  - mitigation: single ownership query; Vitest timing/parity test (AC-P2-14 covers unit; parity asserted in AC-P2-15 e2e).

- **T-I-5: Tree response field leakage.** Node shape is `{id, title, depth, highlightText, createdAt, children}` (US-201 AC.2, with OQ-3 confirmed). No `userId`, no email, no messages content. Threat: dev adds fields for debugging (`parentTitle` of a highlight context, `highlightContext`).
  - likelihood: low; impact: low
  - mitigation: minimal payload per spec; code review — no `highlightContext` in tree nodes (it contains source-message context; unnecessary exposure).

- **T-I-6: Split pane error cross-leak.** Pane A's stream error must not render pane B's conversation title/content (e.g., shared error banner reading the wrong store slice). With instance-scoped state (US-204 AC.4) crosstalk is a bug, not a design. Impact low (user's own data both panes).
  - likelihood: very low; impact: very low
  - mitigation: per-pane state isolation testable (AC-P2-8 QA); no shared error state.

- **T-I-7: Tooltip reveals createdAt of a foreign node.** Impossible by construction: tree payload contains only the user's own rows (T-I-1 mitigation). In split view, the picker lists conversations of the current tree only (US-204 AC.6) — the picker dataset is the same own-tree payload. No new exposure.
  - likelihood: n/a; impact: none
  - mitigation: n/a (contingent on T-I-1 mitigation holding).

### Denial of Service

- **T-D-1: Tree query cost amplification on day-grown trees.** Over days a user can accrue thousands of sub-chats (30/10min branch limit ≈ 4.3k/day theoretical max). Without the cap, the tree query returns all rows, and in-memory DFS + JSON serialization is O(n). 10k rows × ~150 bytes serialized ≈ 1.5MB JSON per tree fetch — and the sidebar refetches after EVERY branch creation (US-202 AC.3): creating node 10,001 triggers a multi-megabyte refetch on every subsequent branch.
  - likelihood: medium (long-lived power user, branch-creation loop); impact: medium (DB read + bandwidth + serialization CPU)
  - mitigation: spec-mandated 500-node DFS cap + `truncated`. Verify the cap is applied DURING assembly (stop DFS at 500) — not "fetch all, serialize 500" (which still pays full fetch cost).

- **T-D-2: `totalNodes` count query cost — count must NOT be a full fetch.**
  Spec says pre-truncation total. Threat: Backend computes it by fetching all rows then `.length` — reintroducing T-D-1's full read under the cover of the cap. Threat 2: Backend issues a second `SELECT count(*)` — acceptable IF cheap. `SELECT count(*) FROM conversations WHERE rootConversationId = :rootId AND userId = :session` is index-covered (rootConversationId index) and cheap at any realistic size; acceptable.
  - likelihood: medium (implementation shortcut); impact: medium
  - mitigation: **spec-verification item** — code review confirms count is `count(*)`-style aggregate (or index-only scan), never a full payload fetch. Cheap within one call; the combined cost stays O(indexed count).

- **T-D-3: Double SSE cost per user.** Split view = 2 concurrent provider streams. Existing per-user message rate limit (60/min + 500/hr, phase 0) is per-USER — split panes draw from the SAME budget, so total provider spend per user is unchanged (documented in the brief). Threat: a future refactor changes the key to `conversationId` — doubling the effective limit for split users.
  - likelihood: low; impact: medium (2× provider cost ceiling)
  - mitigation: rate-limit key MUST remain per-user (document; checklist). Split cannot raise the ceiling — verify during code audit.

- **T-D-4: Unbounded refetch loop.** US-202 AC.3 requires tree refetch after branch creation from ANY pane. Threat: Frontend wires the refetch trigger to a store event that also fires on tree-load completion (feedback loop: fetch → trigger → fetch).
  - likelihood: low; impact: low (self-inflicted API churn; small responses post-cap)
  - mitigation: refetch trigger fires ONLY on branch-success events, not on tree-load; QA catches in e2e (branch → refetch shows node — AC-P2-14).

- **T-D-5: Tooltip/picker amplification: none.** Both consume the already-fetched tree; no new requests.

### Elevation of Privilege

- **T-E-1: IDOR on tree endpoint via `:id` — cross-user enumeration.**
  Spec US-207 AC.1: ownership on `:id` → 404, never 403. Threat: missing or wrong-side check = the phase-1 T-E-1 failure found in a bulk-read endpoint (amplified per T-I-1/TB-13).
  - likelihood: low (spec crystal-clear; existing helper); impact: **critical**
  - mitigation: reuse `requireConversationOwnership` (phase 0/1 helper) FIRST in the handler; 404 `{code: 'NOT_FOUND'}` only. Code review + Vitest + the AC-P2-15 e2e (cross-user 404) make this a tri-gated check.

- **T-E-2: Privilege escalation via split.** Split creates nothing server-side; each pane re-authenticates via its GET. Neither pane can grant the other access. Client-crafted secondaryId → 404 (T-T-3). No elevation path.
  - likelihood: n/a; impact: n/a
  - mitigation: n/a — structurally read-only.

- **T-E-3: New mutation endpoints — none.** Only endpoint is the tree GET (read-only). CSRF surface unchanged from phase 1 (no new state-changing routes to protect; the existing message POST protections carry over inside both panes unchanged).
  - likelihood: n/a; impact: n/a
  - mitigation: explicitly verify no phase-2 code adds a mutating route (spec DoD).

---

## assumptions

1. Phase 1 ownership helper (`requireConversationOwnership`, single-query ownership check, 404 parity) exists and is reused — verified in phase 1 audit.
2. Rate-limit key for messages remains per-user (phase 0 `src/lib/auth/rate-limit.ts` pattern) — re-verify with split view.
3. Single-instance deployment retains in-memory rate limiting (phase 1 residual #6 carries over).
4. Titles remain plain text, server-truncated (60 chars, no HTML) — markdown rendering stays deferred to phase 3; when it lands, threat models T-T-1/T-T-2 must be re-opened for the renderer.
5. `@visx/hierarchy` is used for layout only (positioning/scaling), with text nodes hand-rendered by Frontend — no library HTML rendering of labels.
6. No caching/ETag on the tree response (spec §10) — no cache-poisoning surface.

---

## out of scope (phase 2)

Per spec §10: drag/rearrange, multi-root forest, tree search, split persistence, >2 panes, mobile split, rename/delete, markdown rendering (phase 3 — revisit XSS then), tree caching, sidebar persistence, per-user providers (phase 3), attachments/tool use (phase 4), sharing/public links (never).

Not modeled: phase 1 surfaces (branch/messages/ancestor walk), markdown XSS (deferred), sub-domain/infra (DevOps).

---

## residual risk

| risk | likelihood | impact | decision |
|---|---|---|---|
| T-T-1 tree title XSS (self-XSS window phases 0–2) | low post-mitigation | high | **mitigate** — grep gate + text-only render; re-review at phase 3 markdown |
| T-I-1 cross-user subtree leak if `userId` filter dropped | low | critical | **mitigate** — spec-locked single filtered query + Vitest |
| T-T-3 split store foreign/deleted id | medium | low | **accept** — graceful per-pane 404 state; self-DoS only |
| T-D-1/T-D-2 tree growth cost | medium | medium | **mitigate** — in-assembly cap + cheap count; revisit only if real users hit 500 cap (per OQ-4) |
| T-D-3 rate-limit key regression | low | medium | **mitigate** — documented per-user invariant, code-audit gate |
| "extend cap beyond 500 / lazy-load" future behavior change | — | — | avoid until data shows need (OQ-4) |

No critical residual risk remains if T-I-1/T-I-2 and T-T-1 mitigations are enforced in code review.

---

## OWASP Top 10 (2025) mapping

| OWASP | threats | coverage |
|---|---|---|
| A01 Broken Access Control | T-I-1, T-I-2, T-E-1 | single-ownership-query pattern + 404 parity; triple verification (unit/e2e/code review) |
| A03 Injection | T-T-1, T-T-2, T-T-4 | text-only rendering gate; Drizzle parameterization |
| A04 Insecure Design | T-D-1, T-D-2, T-D-3 | cap + aggregate count + per-user rate-limit invariant |
| A05 Security Misconfiguration | T-I-5 | minimal payload fields; no debug leaks |
| A09 Logging & Monitoring | T-R-1 | tree 404 warn-logged; titles not logged |
| A05/A10 etc. | (others inherited) | no new SSRF/crypto/auth changes; no new deps |

---

## spec hardening requests (to PM / Orchestrator)

1. **US-207/§5: add explicit wording that `totalNodes` count uses the SAME `userId`-filtered predicate** (T-I-3 contingent). The spec's step 5 says "count of the FULL subtree" — make "the user's own full subtree" unambiguous so Backend doesn't count a foreign subtree in the inconsistent-row scenario.
2. **§5 step 4: clarify "Root node = the row with `id === rootId`" means WITHIN the `userId`-filtered result set** — if the root is not in the filtered set, return 404, never synthesize from an unfiltered read (T-I-2).
3. **Verify in DoD wording that the 500-node cap is applied during in-memory DFS assembly**, and that the count query is an aggregate (`count(*)` / index-only scan), NOT `rows.length` after a full fetch (T-D-1/T-D-2).
4. **Document the rate-limit invariant: message rate limit key MUST stay per-user** so split view cannot double the per-user ceiling (T-D-3). One sentence in the spec (§5 or phase-2 checklist) suffices.
5. **Pane error-state behavior: codify "per-pane 404 = terminal state, no retry loop"** — US-204 AC.7/§4 imply it but never forbid automatic retries of a 404. One sentence addition to US-204 states, avoids unbounded fetch churn (T-T-3).
6. **Prohibit `dangerouslySetInnerHTML` in ALL phase-2 components** (TreeNode/tooltip/picker) with the same grep gate as phase 1 (T-T-1/T-T-2). Add to AC-P2-13 or the phase-2 DoD security row.
7. **Recommend NOT including `highlightContext` in tree nodes** even as a future field — it duplicates source-message content; the minimal node shape in US-201 AC.2/OQ-3 should be preserved verbatim (T-I-5).
8. **Add Vitest cases**: (a) foreign descendant injected under a user's root is NOT returned by the subtree query (T-I-1); (b) foreign-owned root resolution → 404 (T-I-2); (c) `totalNodes` equals the count of the user's OWN rows (T-I-3); (d) 404 parity on tree endpoint (covered by AC-P2-14 already).

---

## sign-off

- reviewed by: security (GLM 5.3 Flash tier)
- date: 2026-09-13
- status: **needs-mitigation** (audit pending code review; all findings have proposed mitigations)
- blocking findings: 0
- hardening requests: 8 (items 1–6 recommended for spec/doD adoption pre-build; 7–8 code-audit gates)
