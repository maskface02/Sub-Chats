# Phase 1 STRIDE Threat Model

**status:** preliminary (code not yet written — pre-implementation review)
**phase:** 1 — Sub-Chat Core
**spec:** `.orchestrator/specs/phase-1.md` (frozen rev 2; decisions `.orchestrator/decisions/phase-1-open-questions.md`)
**framework:** STRIDE + OWASP Top 10 (2025)
**reviewer:** security (GLM 5.3 Flash tier)
**builds_on:** `.orchestrator/security/threat-models/phase-0.md`

---

## scope

Phase 1 adds the branching primitive: a user selects text in any assistant message → invokes a context menu or floating pill → server creates a sub-chat with `parentId` pointing at the source, then on any subsequent message in the sub-chat the server walks the ancestor chain and prepends a system note to the model context. The chain can be arbitrarily deep (Q3: uncapped). Cross-user access remains 404 on the source conversation and `503 ANCESTOR_UNAVAILABLE` for any foreign-owned link in the ancestor chain.

Surfaces introduced or modified in phase 1:

1. **NEW** — `POST /api/chats/:id/branch` (US-103 §5) — creates sub-chat from a selection.
2. **MODIFIED** — `GET /api/chats/:id` (US-104 §5) — response gains additive fields `parentId`, `rootConversationId`, `depth`, `highlightText`, `highlightContext`, `parentTitle`, `rootTitle`.
3. **MODIFIED** — `POST /api/chats/:id/messages` (US-105 §5) — when `depth ≥ 1`, walk ancestors, prepend system note to model context only (NOT persisted in `messages`).
4. **NEW** — `parentId` FK constraint (Q7 decision) — Drizzle `.references(() => conversations.id)`.
5. **NEW** — Title auto-derivation (US-104 AC.6 / Q2) — on first user message, derive title from first 6 words of message, max 60 chars.
6. **NEW** — Branch rate limit (US-107 AC.4) — 30 / 10 min / user, in-memory bucket.
7. **NEW** — Frontend: floating "Ask about this" pill (US-101), right-click custom menu (US-102), parent-context banner (US-104), breadcrumb (US-106), selection listener (Frontend-only).
8. **NEW** — Env var `SUBSCHAT_SYSTEM_PROMPT` (Q11) — operator-overridable system note template.

Explicitly **not** modeled (per spec §10): tree-map sidebar (phase 2), split view (phase 2), per-user provider selection (phase 3), markdown rendering (phase 2), attachments (phase 4), depth cap (Q3: uncapped), summarization/truncation of long ancestor chains (Q6: full chain), share / public links (never), sub-chat rename/delete (phase 2).

---

## data flows

1. **Selection → branch POST.** Browser captures `selectionchange` (50ms debounced, Q10) → computes `charStart`/`charEnd` against the assistant message bubble → on pill click or right-click menu item, posts `{messageId, selectedText, charStart, charEnd, clientHighlightContext?}` to `POST /api/chats/:id/branch`.
2. **Branch handler.** `requireAuth()` → load `conversations` row by `:id` filtered by `userId=session.user.id` (404 on miss) → load message by `messageId` filtered by `conversationId=:id` (422 if not assistant, 422 if slice mismatch, 422 if out-of-bounds) → compute or accept `highlightContext` (≤500 chars) → token-bucket rate limit (30/10min/user) → insert new `conversations` row (`userId=session`, `parentId=:id`, `rootConversationId=<source.rootConversationId>` if depth=0 else `<source.rootConversationId>`, `depth=<source.depth+1>`, `highlightText`, `highlightContext`, `title='New chat'`) → 201.
3. **Navigate.** Client `router.push('/c/<new-id>')` → `GET /api/chats/<new-id>` (same as root conv but with new fields populated) → renders banner + breadcrumb + composer.
4. **Sub-chat send.** User types → `POST /api/chats/<sub-id>/messages` body `{content, clientMessageId}` → `requireAuth()` → ownership check (404 on miss) → persist user message → if `conversation.depth ≥ 1`, call `buildModelContext(targetId, content, session.user.id)` (spec §7 algorithm).
5. **Ancestor walk (spec §7).** Load target conversation → loop: load `cursor.parentId` row, verify `userId === session.user.id` (else 503 ANCESTOR_UNAVAILABLE), collect ancestor ids in root-first order → batched fetch messages for all ancestor + target ids → flatten in chain order → prepend system note (template from `SUBSCHAT_SYSTEM_PROMPT` or default) → append new user message → pass array to `streamText` → SSE → on finish persist assistant message on sub-chat only.
6. **Breadcrumb fetch.** `GET /api/chats/<sub-id>` response includes `parentTitle`/`rootTitle` (Q8 additive). For depth ≥ 3 the spec requires the full chain in the breadcrumb (US-108 AC.3); see **T-D-5** below for the spec gap this exposes.
7. **Selection listener (Frontend).** `document.addEventListener('selectionchange', …)` debounced 50ms → if `selection.rangeCount > 0` and range lies entirely within a single assistant message bubble → render floating pill positioned near `range.getBoundingClientRect()`.
8. **Right-click handler.** `oncontextmenu` on assistant bubble → if valid selection range → `preventDefault()` + render custom menu positioned at `event.clientX/Y` with viewport-edge flip.
9. **Server boot env.** Module init reads `SUBSCHAT_SYSTEM_PROMPT` env var (Q11); default string applied if absent.

---

## trust boundaries

(Re-using TB-1..8 from phase 0 where applicable; new boundaries in bold.)

- **TB-1:** internet ↔ Next.js edge (TLS terminates here; assume HTTP only inside).
- **TB-2:** Next.js route handler ↔ `auth()` / session lookup (session-token cookie ↔ `sessions` row).
- **TB-3:** Route handler ↔ Drizzle ORM (parameterized SQL; dev pglite, prod Postgres).
- **TB-4:** Route handler ↔ AI provider SDK (network egress to `api.openai.com` or `localhost:11434`).
- **TB-5:** Browser ↔ Auth.js session cookie (HttpOnly, Secure, SameSite).
- **TB-6:** Browser ↔ SSE stream (Server-Sent Events over chunked HTTP).
- **TB-7:** Dev environment env vars ↔ process memory.
- **TB-8:** Single-user client state ↔ DB.
- **TB-9 (NEW):** Browser DOM ↔ React rendering layer for selection-derived values (`selectedText`, `highlightText`, `parentTitle`, `rootTitle`, `highlightContext`, `message.content` rendered in banner). All values flow from server-validated storage → React text rendering → DOM text node. Threat: any `dangerouslySetInnerHTML` or un-escaped prop opens XSS.
- **TB-10 (NEW):** Source assistant message `content` ↔ sub-chat system note (model context). Threat: model reads selected text as part of `system` role; not a trust boundary break for the user's own chain but a hardening consideration if multi-tenant chains ever land.
- **TB-11 (NEW):** Source message `content` ↔ breadcrumb title leak via `parentTitle`/`rootTitle`. Threat: conversation title is settable (future phase 2 rename); for phase 1 titles are auto-derived from first 6 words of first user message, so titles are user-controlled within their own conversation. No cross-user leak in phase 1 by construction.

---

## threats (STRIDE)

### Spoofing

- **T-S-1: Client-supplied `parentId`/`rootConversationId`/`depth` in branch body → impersonation.**
  Spec §5 lists request body as `{messageId, selectedText, charStart, charEnd, clientHighlightContext?}`. If Backend accepts any of `parentId`/`rootConversationId`/`depth`/`userId`/`createdAt` and uses them, attacker creates sub-chats with arbitrary depth or fakes ownership tree.
  - likelihood: low (spec clear; Zod `.strict()` rejects extras); impact: **critical** (IDOR + audit corruption)
  - mitigation: Zod schema in branch route rejects unknown fields (`.strict()`); `parentId` set server-side as `= :id`; `rootConversationId` derived as `parent.rootConversationId || parent.id`; `depth = parent.depth + 1`; `userId = session.user.id`. Code review must grep for `body.parentId` / `body.userId` and confirm absence.

- **T-S-2: `messageId` forgery — messageId belongs to a different conversation the user owns.**
  Spec §5 AC.2 says "messageId must be an assistant message belonging to conversation `:id`." Threat: user A owns conv X (depth 0) and conv Y (depth 0). User A sends `POST /api/chats/X/branch` with `messageId` from conv Y. Server must verify `message.conversationId === :id` not just `message.userId === session.user.id`.
  - likelihood: medium (trivial to script); impact: high (cross-conversation state corruption, possibly cross-user if reused with intent)
  - mitigation: Backend query `SELECT ... FROM messages WHERE id = :messageId AND conversationId = :id AND role = 'assistant'` — both filters on the same query. Spec §5 is explicit ("belonging to conversation `:id`"). Verify in code review.

- **T-S-3: `selectedText` doesn't match actual slice — attempt to capture content the user can't see.**
  Spec §5 AC.2(d): `content.slice(charStart, charEnd).trim() === selectedText.trim()`. Whitespace tolerance reduces false rejects but does NOT relax the match.
  - likelihood: low (validation); impact: medium (poisoned highlightText saved to sub-chat)
  - mitigation: enforce exact-after-trim match; 422 INVALID_SELECTION on mismatch; never persist mismatch.

- **T-S-4: `clientHighlightContext` accepted beyond 500 chars (length spoofing).**
  Spec §5 says `clientHighlightContext ≤ 500 chars`. Threat: backend uses `body.clientHighlightContext.length` check; if check is `body.clientHighlightContext.slice(0, 500)` and the substring is taken, attacker still injects a 500-char context that may not match the actual surrounding text — but more concerning: if cap is missed entirely, DB row bloats.
  - likelihood: low; impact: low (DB bloat only; not a security boundary)
  - mitigation: Zod `z.string().max(500).optional()`; explicit length check on insert.

- **T-S-5: SSE stream spoofing — attacker on-path injects tokens.**
  TLS terminates at edge; SSE has no per-token integrity. On-path attacker could inject fake assistant tokens. Phase 0 accepted; phase 1 same posture.
  - likelihood: very low (requires TLS MITM); impact: low (no client trusts stream content)
  - mitigation: TLS only; document that streamed content is not authenticated to the client beyond server origin. Phase 1 inherits phase 0 mitigation.

### Tampering

- **T-T-1: SQL injection via Drizzle (carry-over from phase 0).**
  Drizzle uses parameterized queries. New branch route has more inputs (`selectedText`, `clientHighlightContext`) but Zod validates types. `charStart`/`charEnd` parsed as int by Zod `z.number().int().nonnegative()`.
  - likelihood: very low (Drizzle safe); impact: critical
  - mitigation: code review bans `sql\`\`` outside migrations; Zod schemas on every branch route input.

- **T-T-2: XSS via `highlightText` rendered in banner — `<mark>` element.**
  Spec §8/§9 renders `highlightText` with `<mark class="bg-yellow-100">` (light) / `bg-yellow-900/30` (dark). Threat: if Frontend uses `dangerouslySetInnerHTML` to interpolate the highlight into the source message, attacker controls `<mark>` content.
  - likelihood: low (plain text mandate); impact: high (XSS in own conversation is account takeover if session is high-privilege)
  - mitigation: render highlight as React child text, NOT via `dangerouslySetInnerHTML`; split source message into three text segments (before / highlight / after) and render each as React text child; React auto-escapes. Code review grep `dangerouslySetInnerHTML` in `src/components/chat/**` must remain zero.

- **T-T-3: XSS via `parentTitle` / `rootTitle` in breadcrumb.**
  Breadcrumb is `<nav aria-label="Conversation path"><ol><li>Home</li><li><a>{parentTitle}</a></li><li><a>{rootTitle}</a></li><li aria-current="page">{subTitle}</li></ol></nav>`. Threat: if title contains `<script>` and rendered with `dangerouslySetInnerHTML`. Phase 1 derives titles from first 6 words of first user message — user-controlled within their own conversation. Cross-user leak impossible by construction (user only sees their own chain), but in-conversation XSS is still account-takeover if a session cookie is accessible from JS (HttpOnly mitigates).
  - likelihood: low; impact: medium
  - mitigation: render titles as React text child only; never as HTML. Title auto-derivation: server truncates at 60 chars (spec US-104 AC.6), no HTML, no markdown — plain text only.

- **T-T-4: XSS via source assistant message content rendered in banner.**
  The banner shows the source assistant message with `<mark>` highlighting `highlightText`. Threat: assistant content is LLM-generated — model could be prompted to produce `<script>` (the user owns the conversation and supplied the input, but the LLM output may contain HTML). If rendered via `dangerouslySetInnerHTML`, XSS.
  - likelihood: medium (LLM output is untrusted text per phase 0 T-T-2); impact: medium (within the user's own session, but XSS is XSS)
  - mitigation: render content as React text child; no markdown in phase 1; phase 0 T-T-3 mitigation applies. Code review enforces no markdown lib and no `dangerouslySetInnerHTML`.

- **T-T-5: charStart/charEnd out-of-bounds or non-integer.**
  Spec §5: `0 ≤ charStart < charEnd ≤ message.content.length`. Threat: charStart=-1, charEnd=2^53, charStart='abc'.
  - likelihood: medium (trivial client tampering); impact: low (caught by 422)
  - mitigation: Zod `z.number().int().nonnegative()` for both; explicit `<=` upper bound check after fetching message content.

- **T-T-6: charStart/charEnd indexing breaks at surrogate pairs / emoji combining characters.**
  JS strings are UTF-16; `String.prototype.slice` indexes code units, not grapheme clusters. If user selects an emoji or ZWJ sequence, charStart/charEnd from `Selection.getRangeAt(0)` may index into the middle of a surrogate pair, producing a `selectedText` that does not match the visual selection. Spec §5 AC.2(d) requires `content.slice(charStart, charEnd).trim() === selectedText.trim()` — but the comparison itself indexes code units, so it CAN match even when grapheme boundaries are wrong. Threat: malformed `highlightText` saved (e.g., lone high surrogate).
  - likelihood: low (only triggers on emoji / RTL selections); impact: low (visual artifact, no security loss)
  - mitigation: add a Vitest case for emoji-containing messages; if mismatch occurs, return 422 INVALID_SELECTION with field `charStart: 'selection contains partial grapheme cluster — adjust selection'`. Acceptable to defer grapheme-aware slicing to phase 2.

- **T-T-7: Whitespace-only selection passes Zod but content.slice().trim() fails.**
  Spec US-101 AC.2: "selected text is only whitespace → pill does NOT appear". Spec §5 AC.2(b): "trimmed non-empty". Threat: Frontend lets whitespace-only selection through (race with debounce), client posts `selectedText='   '`, server validates `selectedText.trim().length > 0`. Server-side validation is the gate.
  - likelihood: low; impact: very low
  - mitigation: Zod `z.string().min(1).max(2000).refine(s => s.trim().length > 0)`; combined with slice comparison, both server-side gates enforce.

- **T-T-8: clientHighlightContext bypassed via crafted 500-char string.**
  Spec §5: "if present and valid, used as highlightContext". Threat: attacker crafts `clientHighlightContext` that doesn't match the surrounding sentence — appears as the "context" of a highlight when it's actually attacker-chosen text.
  - likelihood: medium; impact: low (poisoned context is stored in user's own sub-chat only; no cross-user risk)
  - mitigation: server MAY verify clientHighlightContext contains the highlightText substring; if not, fall back to server-computed. Recommended spec clarification (see **T-D-5 hardening requests**). Acceptable to ignore in phase 1 since it's user-controlled → user-only impact.

- **T-T-9: highlightContext server-computation edge cases — empty sentence splitter result.**
  Spec §5: regex `\s*[^.!?]+[.!?]+` — fails on messages with no terminators (e.g., "What is a vector database" with no period). Spec covers: "fall back to the full message.content truncated to 500 chars". Verify fallback is implemented.
  - likelihood: low; impact: low (highlightContext just shorter than ideal)
  - mitigation: spec-mandated fallback; add Vitest test for no-terminator message.

- **T-T-10: Branching from a non-assistant message (user message or system message).**
  Spec §5 AC.2 implies assistant-only (highlight comes from assistant response). Threat: user crafts `messageId` pointing to a user message; server accepts, branch context is meaningless.
  - likelihood: low; impact: low (UX, not security)
  - mitigation: server query filters `messages.role = 'assistant'`; 422 INVALID_SELECTION with `messageId: 'must be an assistant message'` on mismatch.

- **T-T-11: Orphan rows from manual DB edits — FK constraint (Q7 hardening).**
  Phase 0 ships `parentId` column without `.references()`. Manual DB edits (or a future buggy migration) could insert a `parentId` pointing at a non-existent conversation. The ancestor walk would silently skip (no row found) → 503 ANCESTOR_UNAVAILABLE (per spec §7 walk-on-missing behavior), but the sub-chat row still exists. Q7 decision: add `.references(() => conversations.id)` FK now.
  - likelihood: low (only via DB admin or buggy migration); impact: low (orphan is just unusable)
  - mitigation: add FK in Drizzle schema; SQLite/Postgres enforce at insert/update; nulls allowed (parentId=null for root); migration safe (no existing non-null parentId rows in phase 0). Verify pglite accepts FK declaration.

- **T-T-12: Title auto-derivation injection — only affects own conversation.**
  US-104 AC.6 / Q2 decision: derive title from first 6 words of first user message, max 60 chars. Threat: user crafts first message containing HTML/markdown. Title is stored in DB; rendered in chat list, header, breadcrumb. Cross-user risk impossible (title is per-user), but in-conversation XSS possible.
  - likelihood: medium (LLM/users do this); impact: low (own conversation only, HttpOnly cookie mitigates session theft)
  - mitigation: server truncates to 60 chars, splits on whitespace, takes first 6 tokens; React text rendering; never HTML escape — text truncation prevents markup patterns.

- **T-T-13: SSE content via phase 0 stream lock — race on concurrent sends.**
  Phase 0 T-T-6: stream lock prevents interleaving. Phase 1 inherits the lock per-conversation-id; sub-chat conversations get the same lock. No new race.
  - likelihood: low; impact: low
  - mitigation: phase 0 mitigation (Promise-based mutex) carries over. No phase 1 code change.

### Repudiation

- **T-R-1: No audit trail of branch creation events.**
  Spec doesn't mandate logging on branch success/failure. Without logs, disputes about "I didn't create that sub-chat" are unresolvable.
  - likelihood: medium; impact: medium
  - mitigation: pino structured log on `POST /api/chats/:id/branch`: `info` on 201 `{userId, sourceConvId, newConvId, parentId, rootConvId, depth, messageId, charStart, charEnd}`; `warn` on 422 (validation failure) and 404 (cross-user); **never log** `selectedText` or `highlightContext` content (may contain private context — same redact posture as phase 0 T-I-6).

- **T-R-2: No audit of cross-user 404 attempts on branch route.**
  Detection of probing (UUID enumeration of foreign-owned conversation IDs) requires logging the 404 itself.
  - likelihood: medium (UUIDs are not enumerable at scale but probing does happen); impact: medium
  - mitigation: log at `warn` `{route, ip, attemptedConvId, userId, ts}`; sample for security telemetry in phase 3.

- **T-R-3: No audit of `ANCESTOR_UNAVAILABLE` events.**
  Spec US-105 AC.6 acknowledges this as "theoretical race". Logging helps confirm whether it actually occurs (could indicate a bug or an attempt to compromise).
  - likelihood: very low (requires race or tampering); impact: medium
  - mitigation: log at `warn` `{userId, subConvId, ancestorId, reason}` — never log message content.

- **T-R-4: 422 INVALID_SELECTION not logged.**
  Helps debug and detect probe scripts that try invalid selections.
  - likelihood: low; impact: low
  - mitigation: log at `info` `{userId, convId, messageId, reason}` without the input values themselves.

### Information Disclosure

- **T-I-1: Foreign-owned ancestor in chain → leak via 503 vs 404 distinction.**
  US-107 AC.2 mandates 503 ANCESTOR_UNAVAILABLE for foreign-owned ancestor — same code as missing ancestor. **Threat:** if Backend returns different HTTP status for "foreign-owned" vs "missing" (e.g., developer thinks "foreign-owned is 404, missing is 503"), the existence of foreign-owned conversations becomes enumerable: 503 = ancestor exists but I don't own it; 404 = I don't own the source. Combined with breadcrumb timing (T-I-2), an attacker could enumerate.
  - likelihood: low (spec explicit); impact: medium (existence enumeration)
  - mitigation: spec-mandated — single code `ANCESTOR_UNAVAILABLE` for both. Verify in code review: the ancestor walk's error branch returns one status, not two. Add Vitest test.

- **T-I-2: Breadcrumb timing attack — "Private" vs "Unknown" vs real title.**
  Spec US-106 AC: render "Unknown" for unresolvable crumbs, "Private" for foreign-owned. Threat: if Frontend fetches crumbs sequentially (await parent, then await root), the time-to-first-paint reveals which crumb is which. An attacker observing network latency can infer chain structure.
  - likelihood: very low (requires sophisticated timing attack); impact: low
  - mitigation: pre-fetch all ancestor titles in a single query (or batched queries) so all crumbs paint simultaneously. The API change in §5 (parentTitle/rootTitle in single response) helps; for depth ≥ 3 see **T-D-5**.

- **T-I-3: 422 INVALID_SELECTION echoes `selectedText` content back to client.**
  Spec §5: `fields: { selectedText: '...' }`. If `fields` includes the user-supplied value verbatim, an automated tool that posts crafted `selectedText` payloads (e.g., for log injection) gets the same value echoed. Threat: log injection if Backend logs the response body; reflected XSS if Frontend renders `fields.selectedText` as HTML.
  - likelihood: low; impact: low
  - mitigation: `fields` should contain only the field NAME and a static message — never the user-supplied value. Example: `fields: { charEnd: 'must be less than message length' }`. Code review: grep for `fields: { ...selectedText` — should not exist.

- **T-I-4: highlightContext edge cases leak adjacent content.**
  Spec §5 server-computes context: "sentence containing charStart, plus one sentence before and one after if they exist". Threat: if `charStart` is at the very edge of a message (e.g., charStart=0), the "sentence before" is empty — fallback to truncated full content. If the message is short (< 500 chars), the fallback exposes the full message content as the highlight context. This is the user-selected text + surrounding context of their own selection in their own conversation. No cross-user leak.
  - likelihood: low; impact: very low (within own conversation only)
  - mitigation: spec-mandated 500-char cap; acceptable risk.

- **T-I-5: parentTitle/rootTitle leak in `GET /api/chats/:id` response.**
  Spec §5: response gains `parentTitle`, `rootTitle`. Threat: parent and root are always user-owned by construction (branching requires the source be user-owned, so parent.userId = user; root.userId = user by induction). However, defense-in-depth: if parent.userId !== session.user.id, return null instead of title.
  - likelihood: low (by construction); impact: low
  - mitigation: when loading parent/root title for the response, filter by `userId === session.user.id`; if miss, set field to null. Add Vitest test for defense-in-depth.

- **T-I-6: Foreign-owned conversation existence probed via 503 vs 404.**
  See T-I-1 — same mitigation. Spec is explicit that source conversation is 404 (US-107 AC.1) and ancestor is 503 (US-107 AC.2). The two codes together reveal structure (foreign-owned source returns 404; foreign-owned ancestor returns 503). If we want to hide this distinction, we could make both 404. Spec chose 503 for ancestor to allow UX distinction (UI shows "parent unavailable" instead of "source not found").
  - likelihood: low; impact: low (UX-distinguishing codes are intentional)
  - mitigation: spec-mandated; verify in code review that 404 is for source only and 503 is for ancestor only.

- **T-I-7: System note contains user-supplied `highlightText`.**
  US-105 AC.3: system note template includes `{highlightText}` — the user's selected text. Spec §7 substitutes `highlightText ?? 'a highlighted passage'`. The system note is sent to the model in `system` role — not rendered to user. Threat: if `highlightText` contains `"</system>"` or `<|im_end|>` style injection, model may treat as instruction. Acceptable: it's the user's own content in their own conversation; the model is supposed to follow the system note, not bypass it.
  - likelihood: low; impact: low (own conversation only)
  - mitigation: acceptable in phase 1; document that system note is model-trusted input from the user's own chain. If multi-tenant sub-chats ever land (never per spec §10), revisit.

- **T-I-8: Logs leak user selection content.**
  Phase 0 T-I-6 mitigation: pino redact list includes `email`, `passwordHash`, `OPENAI_API_KEY`, `cookie`, `authorization`. Phase 1 adds: `selectedText`, `highlightText`, `highlightContext`, `clientHighlightContext` (all contain user-chosen content; none should be logged at any level).
  - likelihood: medium; impact: medium (PII / private thought)
  - mitigation: explicitly add to pino redact: `'*.selectedText'`, `'*.highlightText'`, `'*.highlightContext'`, `'*.clientHighlightContext'`. Code review: no log line should include these field names except as `{hasHighlightText: true}` booleans, never the content.

- **T-I-9: Parent context banner reveals full source message content.**
  US-104 AC.2: banner shows the source assistant message with the highlight rendered. The user is looking at their own branch of their own chat — they already saw the source message. No cross-user disclosure.
  - likelihood: n/a; impact: none (intentional UX)
  - mitigation: n/a — this is the design.

- **T-I-10: Sub-chat listed in user's conversation list.**
  Phase 0 §6 US-006: `/` lists root conversations only. Threat: sub-chats appear as siblings and confuse the user. Spec §3 AC-P1-4 only requires `/c/[id]` for viewing — the list page is unchanged. Verify list query filters `parentId IS NULL` (root only).
  - likelihood: low; impact: very low (UX)
  - mitigation: `GET /api/chats` query filters `parentId IS NULL`; verify in code review (carry-over from phase 0 schema but new concern with phase 1 data).

- **T-I-11: Composer placeholder leaks highlight preview.**
  US-104: placeholder "Ask about <first-3-words-of-highlight>…". Threat: if the first 3 words are sensitive and the screen is shoulder-surfed, exposure. Acceptable: it's the user's own screen.
  - likelihood: n/a; impact: none
  - mitigation: n/a — UX feature, no security concern.

### Denial of Service

- **T-D-1: No rate limit on `/api/chats/:id/branch` (spec gap → now resolved by US-107 AC.4).**
  Phase 1 spec mandates 30 requests / 10 min / user. Verify Backend implements this with in-memory bucket (same pattern as phase 0 signin).
  - likelihood: low (post-mitigation); impact: high (LLM cost via downstream `POST /api/chats/:id/messages` on each branch)
  - mitigation: token-bucket rate limit at branch route; 429 `{error: {code: 'RATE_LIMITED', message: 'Too many sub-chats — try again in 10 minutes'}}`. Add `X-RateLimit-*` headers for observability.

- **T-D-2: Ancestor walk cost — O(d) round-trips for the conversations themselves.**
  Spec §7 pseudocode line 412–419:
  ```
  let cursor = target.parentId ? await db.conversations.get(target.parentId) : null;
  while (cursor) {
    ...
    cursor = cursor.parentId ? await db.conversations.get(cursor.parentId) : null;
  }
  ```
  This is O(d) sequential round-trips for conversations. For depth=10, that's 10 round-trips per message. Combined with T-D-3 (60 messages/min) and T-D-7 (uncapped depth), a determined user with depth=100 could trigger 100 × 60 = 6000 conversation reads/min.
  - likelihood: medium; impact: medium (DB read amplification)
  - mitigation: **spec hardening request** — Backend should implement ancestor walk as a recursive CTE (Postgres) or batched fetch `WHERE id IN (...)` followed by client-side re-ordering. Single round-trip for all ancestor conversation rows.

- **T-D-3: Deep ancestor walk cost per message — `POST /api/chats/:id/messages` cost amplification.**
  Inherits T-D-2: each message in a deep sub-chat walks ancestors. Phase 0 message rate limit (60/min/user, from phase 0 spec hardening T-D-1) caps the multiplier.
  - likelihood: low (post-phase-0-mitigation); impact: medium
  - mitigation: phase 0 message rate limit carries over; combine with T-D-2 mitigation (batched walk).

- **T-D-4: Selectionchange listener fires on every mouse movement — UI thread churn.**
  Spec §11 Q10: 50ms debounce. Without debounce, on mobile during drag-select the listener fires 100+ times/sec causing layout reflows.
  - likelihood: high (pre-mitigation); impact: low (UX, not security)
  - mitigation: Frontend must use `useDebounce` or equivalent at 50ms (Q10 decision); add Vitest or Playwright assertion that pill does not appear more than N times per second during a drag.

- **T-D-5: Breadcrumb full-chain title fetch — SPEC GAP for depth ≥ 3.**
  US-108 AC.3: "breadcrumb always shows the FULL chain from root to current". US-106 AC.1 lists `<rootTitle>` / `<parentTitle>` / `<subChatTitle>`. Spec §5 GET /api/chats/:id only adds `parentTitle` and `rootTitle`. **For depth ≥ 3, the spec does not specify how the breadcrumb obtains grandparentTitle / great-grandparentTitle / ...**
  - likelihood: medium (depth ≥ 3 will be common once users discover recursion); impact: medium
  - mitigation options (all are spec changes — see **hardening requests**):
    - (a) Extend `GET /api/chats/:id` response with `ancestorTitles: [{id, title}]` array.
    - (b) Add `GET /api/chats/:id/ancestors` returning ordered chain.
    - (c) Reduce spec: show only `Home / Root / Parent / Current` (cap display at root+parent).
    - **(a) recommended** — single round-trip, backward-compatible additive.

- **T-D-6: highlightContext computation cost — regex on long content.**
  Spec §5: regex `\s*[^.!?]+[.!?]+` runs on `message.content` which can be up to 8000 chars (phase 0 message cap). Regex backtracking risk if pattern is poorly written — the pattern is character-class-based and not catastrophic. Negligible cost.
  - likelihood: very low; impact: very low
  - mitigation: no change; flag if implementation deviates from spec regex.

- **T-D-7: Recursive depth attack — uncapped per Q3.**
  US-108 AC.2: no max depth. User can create 100-deep tree. Each message at depth 100 walks 100 ancestors. Rate limit (T-D-1 + phase 0 message limit) bounds total work per user but not per request.
  - likelihood: medium; impact: medium (DB read amplification per request)
  - mitigation: combined T-D-1 + T-D-2 + T-D-3 mitigations; no depth cap per spec. Accept residual risk; phase 2 revisit if real user pain.

- **T-D-8: Pill positioning recomputes on every scroll — layout thrash.**
  Spec §8: pill "follows the selection" (Q12). Threat: if pill re-positions on every scroll event without rAF throttling, layout thrashes.
  - likelihood: medium; impact: low (UX)
  - mitigation: Frontend uses `requestAnimationFrame` to position pill on scroll; only when pill is visible.

- **T-D-9: Right-click menu position computation overflow.**
  Spec §5 AC.5: "flip if overflow, clamp horizontally". Threat: menu positioned at `event.clientX/Y` could overflow viewport on right-click near edges; without flip+clamp, menu is cut off.
  - likelihood: low; impact: very low (UX)
  - mitigation: spec-mandated flip+clamp; verify implementation.

- **T-D-10: Branch API body size limit.**
  `selectedText` is capped at 2000 chars (spec §5). `clientHighlightContext` at 500. JSON body is small. Add `Content-Length` cap at edge (phase 0 T-D-5 hardening — 16KB) to be defensive.
  - likelihood: low; impact: low
  - mitigation: phase 0 `Content-Length` cap applies; verify middleware covers `/api/chats/:id/branch`.

### Elevation of Privilege

- **T-E-1: IDOR on `/api/chats/:id/branch` — foreign-owned `:id`.**
  Spec US-103 AC.7: cross-user attempt returns 404 NOT_FOUND. Threat: if Backend uses 403 instead of 404, enumeration possible (T-I-5 phase 0).
  - likelihood: low (spec clear); impact: critical (sub-chat creation on behalf of another user → access to their data via ancestor walk)
  - mitigation: ownership check `WHERE id = :id AND userId = session.user.id` BEFORE any branch logic; 404 on miss (not 403). Same `requireConversationOwnership` helper from phase 0. Code review + Vitest.

- **T-E-2: IDOR on ancestor walk — foreign-owned ancestor.**
  Spec US-107 AC.2: foreign-owned ancestor in chain → 503 ANCESTOR_UNAVAILABLE. Threat: if ancestor walk fails to check ownership on EACH step (e.g., only checks direct parent), a deep chain could include a foreign-owned link.
  - likelihood: low (spec explicit); impact: critical (data leak via ancestor context fed to LLM)
  - mitigation: ownership check inside the while-loop on every iteration; throw `HttpError(503, 'ANCESTOR_UNAVAILABLE')` on first miss. Verify in code review that the check is on every iteration, not only at the start.

- **T-E-3: Client-supplied `parentId` in branch body → arbitrary tree placement.**
  See T-S-1. If `parentId` from body is used to set `conversations.parentId`, attacker creates a sub-chat that points to a conversation they don't own, bypassing the ownership check on `:id`.
  - likelihood: very low (Zod .strict()); impact: critical
  - mitigation: Zod `.strict()` on branch body; `parentId` set server-side as `= :id`. Same as T-S-1.

- **T-E-4: Client-supplied `userId` in branch body → create-on-behalf-of.**
  See T-S-1. Same mitigation: Zod `.strict()`, `userId = session.user.id` always.

- **T-E-5: Branch from foreign-owned `messageId` (T-S-2 escalation).**
  Threat: messageId belongs to a conversation the user does NOT own. The ownership check on `:id` catches the source conversation, but if `:id` is user-owned and `messageId` is foreign-owned (impossible by construction unless `:id` and messageId reference different conversations, which messageId's own conversationId FK prevents), this would let attacker read another user's message via the slice-validation step.
  - likelihood: very low (DB FK prevents messageId from pointing outside `messages` table; but query should still filter `message.conversationId = :id`); impact: high
  - mitigation: query `WHERE id = :messageId AND conversationId = :id`; both filters; 422 on miss.

- **T-E-6: Mass assignment on branch body.**
  Zod `.strict()` rejects unknown fields. Spec §5 lists exactly 5 fields. Threat: if `.passthrough()` or untyped destructuring is used, attacker injects `parentId`, `userId`, `createdAt`, `id`.
  - likelihood: low; impact: critical
  - mitigation: Zod `.strict()` on branch schema; explicit destructuring `const {messageId, selectedText, charStart, charEnd, clientHighlightContext} = parsedBody`. Code review grep.

- **T-E-7: SSE ancestor stream leaks foreign-owned ancestor content.**
  Inverts T-E-2: if ancestor walk skips the ownership check on a foreign-owned link, the LLM context includes that user's content → data leak to attacker via streamed tokens.
  - likelihood: very low (covered by T-E-2 mitigation); impact: critical
  - mitigation: same as T-E-2; verify chain-walk aborts before any DB read of foreign-owned ancestor's messages.

- **T-E-8: Highlight context contains prompt-injection for LLM.**
  Same as T-I-7 — system note includes `highlightText`. Threat: prompt injection could manipulate model into refusing legitimate requests or producing harmful content. Acceptable: own conversation.
  - likelihood: medium; impact: low (own conversation)
  - mitigation: acceptable; phase 0 T-T-2 mitigation carries over.

- **T-E-9: Title auto-derivation grants XSS persistence.**
  US-104 AC.6: title derived from first 6 words of first user message. If rendered as HTML in chat list / header, XSS vector.
  - likelihood: low; impact: medium (own conversation only)
  - mitigation: server splits on whitespace, takes first 6 tokens, max 60 chars total — neutralizes HTML attribute injection; React text rendering neutralizes element injection.

- **T-E-10: `GET /api/chats/:id` parentTitle/rootTitle exposes foreign-owned titles via missing filter.**
  See T-I-5. Threat: response builder reads parent and root rows without `userId` filter, exposing foreign titles.
  - likelihood: low (by construction parent/root are always user-owned); impact: low
  - mitigation: explicit filter on parent/root lookup; null on miss. Defense-in-depth.

- **T-E-11: `POST /api/chats/:id/messages` ancestor walk trusts client-supplied `depth` field.**
  Threat: if request body includes `depth` (it shouldn't per spec — `depth` is a DB column), attacker sends `depth=0` to skip ancestor walk. The branch handler must NEVER read `depth` from body — it's a server-derived value.
  - likelihood: very low (Zod .strict()); impact: high (skip ancestor walk → no context → confused AI)
  - mitigation: Zod schema does NOT include `depth`; `depth` is set during branch creation as `parent.depth + 1`. Code review.

---

## assumptions

1. **TLS terminates at the edge** (Vercel or similar); all HTTP inside the runtime is trusted.
2. **Drizzle ORM is used as designed** — no raw `sql\`\`` outside migrations.
3. **`AUTH_SECRET` is generated with `openssl rand -base64 32`** and never committed.
4. **Single-instance deployment** — in-memory rate-limit (branch, phase 0 messages) is reliable only because there's one Node process. Phase 1 inherits phase 0's "single-instance" assumption; revisit in phase 2 (Upstash).
5. **`OPENAI_API_KEY` is a server-side secret** with billing limits set on the OpenAI dashboard.
6. **No PII or secrets in URL query strings** other than `?callbackUrl=` (phase 0 T-S-2).
7. **Browser cookie jar respects HttpOnly + Secure + SameSite=Lax**.
8. **Frontend never sends `userId`, `parentId`, `rootConversationId`, `depth`, `createdAt` in body** — these are all server-derived. This is a Backend invariant; Frontend must not construct such payloads.
9. **pglite supports FK constraints** — Q7 decision; verify Backend code review confirms FK compiles in Drizzle and applies cleanly in dev (pglite) and prod (Postgres).
10. **Phase 0 message rate limit (60/min/user) carries over** to sub-chat conversations — the same `conversationId` lock applies.

---

## out of scope (phase 1)

Per spec §10, NOT modeled:
- Tree-map sidebar (phase 2)
- Split view (phase 2)
- Per-user provider selection (phase 3)
- Custom baseURL UI (phase 3)
- Multi-provider fallback chain UI changes (phase 3)
- Sub-chat rename (phase 2 per Q4)
- Sub-chat delete (phase 2 per Q4)
- Markdown / code-block rendering (phase 2)
- File / image attachments (phase 4)
- Tool use / function calling (phase 4)
- Max-depth cap (Q3: uncapped)
- Ancestor summarization/truncation (Q6: full chain)
- Banner beyond direct parent (phase 2)
- Sibling list in breadcrumb (phase 2)
- Sharing / public links (never)
- Highlights from user messages (deferred)
- Cross-message highlights (deferred)
- Editing highlight post-creation
- Moving / merging sub-chats
- i18n
- Mobile-optimized pill positioning (basic only)
- Keyboard "go to parent" hotkey (deferred)
- Sentry wiring (acceptable to defer)

---

## residual risk

| risk | residual likelihood | residual impact | accept/transfer/avoid |
|---|---|---|---|
| Ancestor walk O(d) round-trips (T-D-2) | medium | medium | **mitigate** in implementation via batched fetch (spec hardening request #1) |
| Breadcrumb full-chain title fetch (T-D-5) | medium (post-depth-3) | medium | **mitigate** via spec change — `ancestorTitles: [{id, title}]` in GET /api/chats/:id (spec hardening request #2) |
| Foreign-owned ancestor existence leak via 503/404 (T-I-1, T-I-6) | very low | low | **accept** — spec is explicit; UX-distinguishing codes are intentional |
| Prompt injection via highlightText (T-I-7, T-E-8) | medium (by design) | low (own chain only) | **accept** — no exfil channel; multi-tenant never per spec §10 |
| Recursive depth attack (T-D-7) | medium | medium | **mitigate** via T-D-2 batched walk + phase 0 rate limit; phase 2 revisit |
| In-memory rate-limit bypass on multi-instance | n/a in phase 1 (single instance) | n/a | **transfer** to phase 2 (Upstash) |
| FK migration in prod (T-T-11) | very low | low | **avoid** — NULL allowed; no orphan rows possible; safe migration |
| Highlight context regex edge cases (T-T-9) | low | low | **mitigate** via Vitest cases |
| Grapheme cluster / emoji slicing (T-T-6) | low | low | **accept** in phase 1; defer to phase 2 with grapheme-aware slicing |
| Selection event listener churn (T-D-4) | low (post-debounce) | low | **mitigate** in implementation |

No residual risk rated **critical** for phase 1 if the spec hardening requests below are adopted.

---

## OWASP Top 10 (2025) mapping

| OWASP | threats | phase 1 coverage |
|---|---|---|
| A01 Broken Access Control | T-E-1, T-E-2, T-E-3, T-E-4, T-E-5, T-E-7, T-E-10, T-S-2 | covered by `requireConversationOwnership()` + 404 on cross-user + ancestor-walk ownership loop + Zod `.strict()`; verify in code review |
| A02 Cryptographic Failures | (inherit phase 0 T-I-1, T-I-2, T-I-12) | bcrypt cost 12 ✓; `AUTH_SECRET` rotation; TLS in prod; no new crypto in phase 1 |
| A03 Injection | T-T-1, T-T-2, T-T-3, T-T-4, T-T-5, T-T-6, T-T-7, T-T-8, T-T-9 | Drizzle parameterized ✓; React text rendering for highlightText/parentTitle/rootTitle (no `dangerouslySetInnerHTML`); charStart/charEnd validated as int by Zod; system note injection acceptable (own chain only) |
| A04 Insecure Design | T-D-1, T-D-2, T-D-3, T-D-5, T-D-7, T-E-2, T-E-7 | branch rate limit ✓; ancestor walk ownership loop ✓; **spec hardening needed**: batched ancestor fetch + breadcrumb full-chain titles |
| A05 Security Misconfiguration | (inherit phase 0 T-I-8, T-I-11) | secureHeaders middleware ✓; phase 1 inherits; ensure it covers `/api/chats/:id/branch` |
| A06 Vulnerable & Outdated Components | (deferred) | `npm audit` to be run by DevOps once code lands |
| A07 Identification and Authentication Failures | T-S-1, T-S-2, T-S-3 | Zod `.strict()` ✓; messageId belongs-to-conv filter ✓; slice validation ✓ |
| A08 Software & Data Integrity Failures | T-T-11, T-T-12, T-T-13 | FK constraint (Q7) ✓; title auto-derive truncation ✓; phase 0 stream lock ✓ |
| A09 Logging and Monitoring | T-R-1, T-R-2, T-R-3, T-R-4, T-I-8 | **spec hardening needed**: pino redact must include `selectedText`, `highlightText`, `highlightContext`, `clientHighlightContext`; branch events must be logged |
| A10 SSRF | (no SSRF in phase 1 — no user-controlled URLs) | n/a |

---

## spec hardening requests (to PM / Orchestrator)

These are items I want addressed **before or during implementation** — not blockers, but quality gates:

1. **Backend ancestor walk should batch the conversation fetch** (T-D-2). The spec §7 pseudocode shows O(d) sequential `db.conversations.get(parentId)` calls. Recommend either a recursive CTE (`WITH RECURSIVE ancestors AS (SELECT ... FROM conversations WHERE id = $target UNION ALL SELECT c.* FROM conversations c JOIN ancestors a ON c.id = a.parentId) SELECT * FROM ancestors`) or a batched fetch (`SELECT * FROM conversations WHERE id = ANY($ancestorIds)`) with client-side ordering. Phase 1 should ship the batched approach to avoid DB-read amplification in deep trees.

2. **API must return full ancestor title chain for breadcrumb** (T-D-5). Spec §5 GET /api/chats/:id lists `parentTitle` and `rootTitle` but US-108 AC.3 requires the FULL breadcrumb for depth ≥ 3. Recommend additive change: add `ancestorTitles: Array<{id: string; title: string; depth: number}>` to GET /api/chats/:id response. Single round-trip, backward-compatible.

3. **Pino redact list must include selection/highlight content** (T-I-8, T-R-1). Add to redact: `*.selectedText`, `*.highlightText`, `*.highlightContext`, `*.clientHighlightContext`. Same posture as phase 0 T-I-6 for message content.

4. **422 INVALID_SELECTION should not echo user-supplied content** (T-I-3). Recommend: `fields` contains only field name + static message — never the value. Example: `{ fields: { charEnd: 'must be ≤ message length' } }`.

5. **Add Vitest cases** for phase 1:
   - cross-user 404 (not 403) on `POST /api/chats/:id/branch` (T-E-1)
   - foreign-owned ancestor returns 503 ANCESTOR_UNAVAILABLE (T-E-2)
   - foreign-owned ancestor returns SAME 503 as missing ancestor (T-I-1)
   - `messageId` from different conversation returns 422 (T-S-2)
   - `selectedText` containing only whitespace returns 422 (T-T-7)
   - charStart/charEnd out-of-bounds returns 422 (T-T-5)
   - slice mismatch returns 422 (T-S-3)
   - highlightContext fallback when no sentence terminators (T-T-9)
   - title auto-derive: 6 words max, 60 chars max, no HTML

6. **Add Playwright e2e cases** for phase 1 (in addition to spec §12):
   - breadcrumb renders full chain at depth ≥ 3 (validates T-D-5 spec hardening)
   - foreign-owned ancestor shows "Private" crumb (no leak)
   - cross-user branch returns 404 page in UI

7. **Operator-facing: pin note in `.env.example`** that `SUBSCHAT_SYSTEM_PROMPT` must NOT contain secrets or BYOK data (Q11). The system note is logged at provider level by some SDKs.

8. **Document in spec**: Frontend MUST NOT use `dangerouslySetInnerHTML` for any phase-1 surface (highlightText, parentTitle, rootTitle, source message content, breadcrumb crumbs, banner text). Same prohibition as phase 0 T-T-3.

9. **Recommendation**: Zod schema for branch body should explicitly enumerate exactly 5 fields and use `.strict()` — code-review checklist item. Recommended import pattern:
   ```ts
   const BranchBodySchema = z.object({
     messageId: z.string().uuid(),
     selectedText: z.string().min(1).max(2000).refine(s => s.trim().length > 0),
     charStart: z.number().int().nonnegative(),
     charEnd: z.number().int().positive(),
     clientHighlightContext: z.string().max(500).optional(),
   }).strict();
   ```

10. **Migration note for FK (Q7)**: add to Backend handoff. pglite + drizzle-kit will reflect FK on next migration generation. Existing rows in dev (phase 0): `parentId` is always NULL (no sub-chats exist yet), so adding FK is safe (NULL allowed). In prod: verify no orphan rows before applying; if any exist, backfill or delete.

11. **Branch rate-limit headers** mirror phase 0 signin pattern. Suggested:
    - `X-RateLimit-Limit: 30`
    - `X-RateLimit-Remaining: <n>`
    - `X-RateLimit-Reset: <unix-ts>`
    - `Retry-After: <seconds>` (on 429)

12. **Spec clarification (low priority)**: US-103 AC.2 says "the source conversation is owned by the current user" — confirm this means the conversation at `:id` AND the message at `messageId` are both filtered by ownership (defense in depth).

---

## sign-off

- reviewed by: security (GLM 5.3 Flash tier)
- date: 2026-09-13
- status: **needs-mitigation** (audit pending code review)
- blocking findings: 0 (all criticals have proposed mitigations)
- non-blocking hardening requests: 12 (see above)
- spec hardening items #1, #2, #3, #5 are **recommended** for phase 1 sign-off; #4, #6, #7, #8, #9, #10, #11, #12 are recommended as spec/code-review additions.
