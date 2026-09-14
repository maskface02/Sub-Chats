# Phase 4 Spec — Polish + Carry-Overs (delete/undo, export, search, stop, highlighting, edit/regenerate, shortcuts)

**status:** frozen
**frozen_on:** 2026-09-13
**frozen_revision:** 2 (5 Reviewer fixes applied by Orchestrator: deletedAt-404 coverage extended to branch/edit/regenerate, verify-or-implement abort persistence, descendant-stream 409 + live-only cascade, md escaping + filename sanitization + nested-batch integrity, restore batchId source made explicit; 7 open questions resolved)
**owner:** PM
**orchestrator_decisions_on_open_questions:** see `.orchestrator/decisions/phase-4-open-questions.md` (pending Critic review → freeze)
**owner:** PM
**builds_on:** `.orchestrator/specs/phase-0.md` §6/§8, `.orchestrator/specs/phase-1.md` (branching + ancestor walk), `.orchestrator/specs/phase-2.md` (tree sidebar + split view), `.orchestrator/specs/phase-3.md` (markdown + providers)
**handoffs_required_from:** UX (`.orchestrator/specs/ux/phase-4.md` — delete/undo, export menu, edit mode, stop button, shortcut overlay contracts), Security (threat-model addendum: export data exposure + edit/regenerate abuse), Backend→Frontend API handoff
**locked_decisions:**
- syntax highlighting = `rehype-highlight@^7.0.2` (already in package.json — NO new deps), CSS-class based, **no worker**; theme = `highlight.js/styles/github.css` statically imported in `globals.css` + a `.dark`-scoped token override block replicating `github-dark.css` (documented in §7 — static import chosen over `<link>`: bundled, no FOUC, no extra network request)
- edit semantics = **edit-in-place truncates + re-streams**; branching-on-edit is a phase 5 idea (§8)
- delete semantics = **cascade soft-delete of the whole subtree** (§8 rationale)
- this phase contains the project's **first schema-evolution migration** (`deletedAt`) — `drizzle/0000_init.sql` was the bootstrap; `0001` is the first post-bootstrap migration (§7)

---

## 1. Phase overview

The core product is done after phases 0–3 (auth, root chat, branching sub-chats with ancestor context, tree-map sidebar, split view, BYOK providers with AES-256-GCM + SSRF guard, markdown). Phase 4 is the polish pass that makes it feel finished: users can finally **delete** conversations (with undo), **export** them, **search** the tree, **stop** a runaway stream, read **syntax-highlighted** code, **edit/regenerate** messages, and drive everything from the **keyboard**.

Scope decisions (PM arbitration, per brief):
- Lands now from the phase-0/phase-2 carry-over pile: message **edit + regenerate**, **syntax highlighting**, conversation **delete**. **Optimistic rendering stays deferred to phase 5** — it interacts with edit/regenerate state and must ship after those stabilize.
- Attachments, tool use, MFA, key rotation UI, provider test-connection, per-message model override: all stay out (§11).
- 9 stories, 5 new/implemented routes, 1 migration. No new dependencies.

---

## 2. User stories

### US-401: Delete conversation (soft-delete + subtree cascade, API)

**as a** signed-in user
**i want** to delete a conversation and its subtree with a soft-delete safety net
**so that** I can clean up my chat list without permanently losing work to a misclick.

#### acceptance criteria
- [ ] AC.1: `DELETE /api/chats/:id` requires a session (`401 { code: "UNAUTHENTICATED" }`); a missing id OR a conversation owned by another user returns `404 { code: "NOT_FOUND" }` — never 403 (phase-1 id-enumeration guard), byte-identical bodies.
- [ ] AC.2: delete is a **soft delete**: the server sets `deletedAt = now()` on the target conversation AND on every descendant in its subtree (single query on `rootConversationId`/subtree ids, one transaction); it never hard-deletes rows.
- [ ] AC.3: **subtree cascade is the chosen policy** (over blocking parents-with-children): rationale — the tree is a unit of thought; blocking would force users to delete leaves one by one, and orphaned children would reference a parent whose context no longer loads. Sub-chats are meaningless without their ancestor chain. Documented in §8.
- [ ] AC.4: success response is `200 { deletedIds: string[], deletedCount: number }` — `deletedIds` lists every soft-deleted conversation id (the undo client replays exactly these); `deletedCount === deletedIds.length`.
- [ ] AC.5: soft-deleted conversations are excluded from EVERY existing read AND write path: `GET /api/chats` (list), `GET /api/chats/:id`, `GET /api/chats/:id/tree`, `GET /api/chats/:id/export`, message-send, **`POST /api/chats/:id/branch` (branching a deleted conversation → 404; otherwise the new sub-chat points `parentId` at a deleted row and its next send walks into a deleted ancestor)**, and the NEW edit/regenerate routes (`POST /api/chats/:id/messages/:messageId/edit|regenerate` — a deleted conversation cannot be edited or regenerated). A deleted id behaves exactly like a missing id (`404 NOT_FOUND`) on all of them. Unit tests cover branch-on-deleted → 404 and edit-on-deleted → 404.
- [ ] AC.6: if an active stream exists for the target conversation **OR ANY descendant in the cascade set** (phase-0 in-flight map — the delete transaction already computes the id set, check every id against it), delete returns `409 { code: "STREAM_ACTIVE", message: "Stop the current response before deleting" }` and deletes nothing. Otherwise the in-flight stream would keep writing assistant tokens into a soft-deleted conversation.
- [ ] AC.7: `POST /api/chats/:id/restore` (undo) requires a session; on a conversation the user owns that has `deletedAt != null`, it clears `deletedAt` on the exact id set captured at delete time (the ids recorded in the delete response — stored server-side per delete batch, see §6) within one transaction and returns `200 { restoredCount: number }`. Missing/foreign → `404 NOT_FOUND`; a conversation that is not soft-deleted → `200 { restoredCount: 0 }` (idempotent).
- [ ] AC.8: mutation routes are rate-limited at 30 requests / 10 min / user (combined delete + restore, phase-1 pattern); exceeding returns `429 { code: "RATE_LIMITED" }` with `Retry-After` and `X-RateLimit-*` headers.
- [ ] AC.9: hard-purge of rows soft-deleted > 30 days ago is a cron concern — explicitly out of scope (§11); no hard DELETE statement exists anywhere in phase 4 code.

#### states
- success: 200 with `deletedIds` / `restoredCount`.
- error (401): no session.
- error (404): missing, foreign-owned, or already-purged id.
- error (409): active stream on the conversation.
- error (429): rate limit exceeded.
- error (500): `{ code: "INTERNAL" }` — transaction rolled back, no partial soft-delete.

#### out of scope
- hard-purge cron (30-day retention) — §11.
- bulk delete, "trash" folder UI, deleting individual messages.
- deleting a subtree member but keeping the parent (subtree is atomic).

#### dependencies
- depends on: §6 migration (`deletedAt` + partial index)
- blocks: US-402

#### a11y notes
- n/a (API); error bodies follow the phase-0 error shape so UI errors render consistently.

---

### US-402: Delete UI with confirm + undo toast

**as a** signed-in user
**i want** a delete button with a confirm step and a 5-second undo
**so that** I can remove a chat confidently and recover from a mistake.

#### acceptance criteria
- [ ] AC.1: the chat header shows a "Delete" menu item (inside the existing header overflow menu, alongside Export), AND the tree sidebar shows a per-node delete action (context menu or hover affordance per UX contract) — both are keyboard-operable.
- [ ] AC.2: activating delete opens a confirm dialog (`role="dialog"`, focus-trapped): for a node with children it reads "Delete "<title>" and its N sub-chat(s)? This can be undone for a few seconds."; for a leaf: "Delete "<title>"? This can be undone for a few seconds." Confirm activates; `Esc` and Cancel close with no request.
- [ ] AC.3: on confirmed success the conversation (and, if it was visible, its subtree) disappears from the list/tree within 300ms; the tree refetches or prunes locally; if the deleted conversation was open in a pane, the pane navigates to the parent (or `/` if the root was deleted); if it was open in split view, that pane closes.
- [ ] AC.4: on success a toast appears: "Chat deleted — Undo", with an Undo button active for **5 seconds**; activating Undo calls `POST /api/chats/:id/restore` and the conversation + subtree reappear in the tree and list without reload, restored to their previous position (list order is `updatedAt DESC`, so it re-sorts naturally).
- [ ] AC.5: after the 5s window the toast shows "Deleted" (disabled Undo) for ~1.5s, then dismisses; the rows remain recoverable only via the soft-delete window until purge (no UI path — accepted).
- [ ] AC.6: failure states: `409 STREAM_ACTIVE` → toast "Stop the current response before deleting"; 429 → toast "Too many actions — try again in a moment"; 5xx/network → toast "Could not delete — try again" and the conversation stays visible. The undo toast failure path: restore error → toast "Could not undo — try again" and the tree refetches to reflect true server state.
- [ ] AC.7: the delete control is never shown for conversations the user doesn't own (server enforces ownership regardless; UI is defense-in-depth).

#### states
- empty: n/a (delete is an action on existing rows).
- loading: confirm-dialog Confirm button shows spinner + "Deleting…"; controls disabled.
- error: toasts per AC.6; no silent failures.
- success: row(s) removed + undo toast per AC.3–4.

#### out of scope
- undo beyond 5s from the UI (§11 note: rows are soft-deleted but there is no trash UI).
- delete-all / clear-account.

#### dependencies
- depends on: US-401
- blocks: nothing

#### a11y notes
- keyboard: menu item focusable; dialog focus-trapped; `Esc` cancels; focus restores to the delete trigger after close (US-309 phase-3 pattern); Undo button reachable in toast while visible.
- screen reader: toast is `role="status"` with aria-label "Chat deleted"; countdown not announced per-second (only state changes); dialog announced per WAI-ARIA dialog pattern.
- contrast: toast, dialog, and all state text meet WCAG AA; delete action identified by icon AND text (not color alone).

---

### US-403: Export conversation (md/json)

**as a** signed-in user
**i want** to download a conversation as markdown or JSON
**so that** I can keep my data and share a readable copy outside the app.

#### acceptance criteria
- [ ] AC.1: `GET /api/chats/:id/export?format=md|json` requires a session; missing/foreign conversation → `404 NOT_FOUND`; an absent or non-`md|json` format → `400 { code: "INVALID_INPUT", message: "format must be md or json" }`.
- [ ] AC.2: success returns `200` with `Content-Type: text/markdown; charset=utf-8` (md) or `application/json` (json) and `Content-Disposition: attachment; filename="<title-slug>-<YYYYMMDD>.md|json"` (title slugified, ≤ 60 chars, non-ASCII preserved where filesystem-safe).
- [ ] AC.3: **markdown format** (normative structure): `# <title>`; then a context block — for a ROOT: nothing; for a SUB-CHAT: the ancestor breadcrumb as `> Path: Root Title › … › Parent Title` followed by `> Highlight: "<highlightText>"` (and `> Context: <highlightContext>` when non-null); then a `---` divider; then each message in `createdAt ASC` order as `## <Role>` (`Role` ∈ `You` / `Assistant`) followed by the raw content and a blank line. Assistant messages include no model metadata in md (readability first). **Escaping (normative):** message content that could break the structure is fence-wrapped — if a message's content contains a line starting with `#`, `---`, or a ` ``` ` fence, that message's body is emitted inside a ` ```text ` fence (with any inner fences lengthened to ` ```` `) so it cannot swallow subsequent sections; otherwise it is emitted raw. **Filename slug sanitization (normative):** strip `\r`, `\n`, `"`, `\`, and all C0/C1 control chars from the slug before Content-Disposition; the resulting header value is ASCII-safe or RFC 5987 `filename*` encoded. Unit test includes an adversarial fixture (content starting with `#` and containing nested fences).
- [ ] AC.2b: **nested-delete batch integrity**: the cascade `UPDATE ... SET deleted_at, deleted_batch_id` MUST filter `WHERE deleted_at IS NULL` — only LIVE descendants join the new batch. A descendant that was separately soft-deleted earlier keeps its ORIGINAL `deletedBatchId` (restoring the parent does NOT resurrect it; restoring the leaf's own batch does). Unit test: delete leaf → delete parent → restore parent batch → leaf stays deleted; restore leaf batch → leaf returns.
- [ ] AC.4: **json format**: `{ "conversation": { id, title, parentId, rootConversationId, depth, highlightText, highlightContext, createdAt, updatedAt }, "messages": [ { id, role, content, model, providerId, createdAt } ] }` — full row data of THIS conversation only; never another user's data; no provider key material (providerId is an id/sentinel only, per phase 3).
- [ ] AC.5: soft-deleted conversations export as 404 (consistent with US-401 AC.5).
- [ ] AC.6: UI: the chat header overflow menu gains "Export as Markdown" and "Export as JSON"; activating either downloads the file via the browser (blob download — no navigation away); a pending spinner shows on the menu item while in flight; failure → toast "Could not export — try again".
- [ ] AC.7: export of a WHOLE tree (multi-conversation) is out of scope (§11) — one conversation per export; a sub-chat's md export still carries the ancestor chain summary per AC.3 (that satisfies the brief's "breadcrumb context" requirement).

#### states
- empty: an exported conversation with 0 messages produces a valid file with title + context block and no message sections (edge case, still 200).
- loading: menu item spinner while the request is in flight.
- error: 404 → the pane's existing "Conversation not found" surface; 400/5xx → toast per AC.6.
- success: file downloads; no toast needed (the download IS the feedback).

#### out of scope
- whole-tree / multi-conversation export (§11).
- PDF/html/txt formats, format options (include-model-metadata toggle etc.).
- server-side export history / "your exports" list.

#### dependencies
- depends on: nothing new (reads existing tables; respects `deletedAt` from US-401)
- blocks: nothing

#### a11y notes
- keyboard: menu items focusable and activatable with Enter/Space.
- screen reader: menu items announce "Export as Markdown" / "Export as JSON"; pending state via `aria-busy`.
- contrast: AA.

---

### US-404: Full-tree search (client-side filter)

**as a** user with a large conversation tree
**i want** to filter the tree sidebar by title or highlight text
**so that** I can find the branch I'm looking for without scrolling.

#### acceptance criteria
- [ ] AC.1: the tree sidebar gains a search input at the top ("Search tree…"); typing filters tree nodes client-side against `title` AND `highlightText` (case-insensitive substring match) — NO new endpoint (tree payload is already client-side and ≤ 500 nodes per phase-2 US-201 AC.4).
- [ ] AC.2: matching semantics: a node matching the query is shown; its ANCESTOR chain is always shown (collapsed-subtree context so matches are reachable); non-matching leaf branches are hidden. Match substrings are visually highlighted (e.g. `<mark>`) in title and highlight text.
- [ ] AC.3: filtering is debounced at 150ms and updates the tree in < 100ms after debounce for a 500-node tree (measurable: no perceptible lag while typing).
- [ ] AC.4: keyboard: `/` (when focus is not in an input/textarea/contenteditable) focuses the tree search input; `Esc` while the input is focused clears the query and returns focus to the tree.
- [ ] AC.5: empty result state: "No conversations match "<query>"" with a "Clear search" button; clearing restores the full tree (respecting the phase-2 truncation notice when applicable).
- [ ] AC.6: the filter state is per-sidebar-instance (each split pane's sidebar if both render one) and resets when the tree refetches on navigation — no persistence across reloads.
- [ ] AC.7: the search input does not trigger any network request (verifiable: zero fetches while typing, asserted in unit test with a mocked fetch).

#### states
- empty (no query): full tree per phase 2.
- loading: n/a (synchronous client filter over already-fetched data; debounce per AC.3).
- error: n/a (no network); if the underlying tree failed to load, the phase-2 error state takes precedence and the search input is disabled with `aria-disabled`.
- success: filtered tree with highlighted matches per AC.2.

#### out of scope
- server-side / cross-root search across ALL conversations (phase 0 §9 deferred "search across conversations"; tree search is within one root only) — candidate for phase 5.
- fuzzy matching, regex, search-by-message-content.

#### dependencies
- depends on: phase-2 US-201/US-202 (tree data + sidebar)
- blocks: US-409 (the `/` shortcut targets this input)

#### a11y notes
- keyboard: `/` focus shortcut per AC.4; `Esc` clears per AC.4; full tree remains keyboard-navigable in filtered mode (WAI-ARIA tree pattern preserved).
- screen reader: input labeled "Search tree"; result-count change announced via `role="status"` ("N conversations match"); `<mark>` highlights are visual only — node text content unchanged for AT.
- contrast: `<mark>` highlight meets AA against both node states and both themes.

---

### US-405: Streaming cancel (stop button)

**as a** user watching an AI response stream
**i want** a Stop button that ends the stream immediately
**so that** I don't wait for (or pay for) a response I no longer want.

#### acceptance criteria
- [ ] AC.1: while a message is streaming in a pane, the composer's send button is replaced by a Stop button (stop-square icon + "Stop"); activating it aborts the in-flight fetch via the existing `AbortController` in the custom stream client — no new endpoint (client-side abort propagates as connection close).
- [ ] AC.2: server-side behavior on client disconnect: **verify-or-implement.** Phase-0 §8 specifies `onFinish` as the ONLY assistant-message writer, with partial persistence specified only for thrown errors — a graceful client-disconnect abort path may NOT exist yet. Backend MUST verify: if the disconnect path already persists partials, add a unit test asserting it (abort mid-stream → partial assistant row persisted, in-flight lock released, lock-map entry cleaned). If it does NOT exist, IMPLEMENT abort-time partial persistence in this story (abort listener on the request signal / stream, writing the accumulated text) — US-407/US-408 depend on this path for their stop-mid-truncate behavior. Either way the unit-test gate applies.
- [ ] AC.3: after abort, the partial assistant message renders as complete text with a **"Stopped" indicator** (small chip/badge at the message tail). Decision: the indicator is EPHEMERAL UI state (client marks the message id as stopped in memory) — NO schema change to persist it; after reload the partial content renders as a normal message. Documented in §8; revisit only if users report confusion.
- [ ] AC.4: the single-in-flight lock for the conversation is released within 300ms of abort (the composer returns to ready state and the next message can be sent immediately — phase-0 queue drains).
- [ ] AC.5: Stop is keyboard-operable (Enter/Space); while streaming, focus behavior is unchanged; after stop, focus moves to the composer textarea (ready to continue).
- [ ] AC.6: aborting during a REGENERATE or post-EDIT re-stream (US-407/408) behaves identically: partial content persists, "Stopped" chip shows, lock releases.
- [ ] AC.7: `Esc` does NOT stop the stream (reserved for closing panes/dialogs per US-409) — Stop is button-only; documented in the shortcut overlay to prevent confusion.

#### states
- empty: n/a (button exists only while streaming).
- loading/streaming: Stop button replaces send; assistant bubble shows accumulating text + caret (phase-1 behavior unchanged).
- error: abort itself never produces the phase-0 error banner (an intentional abort is not an error) — the partial message + "Stopped" chip is the terminal state; genuine stream errors keep the existing banner + Retry.
- success: partial content persisted + chip; composer ready.

#### out of scope
- persisting a "stopped" flag in the DB (§8 decision: ephemeral).
- stop-all (multi-pane), resume-from-partial.

#### dependencies
- depends on: phase-0 stream client (`AbortController` exists)
- blocks: US-407, US-408 (share the abort + partial-persist path)

#### a11y notes
- keyboard: Stop reachable via Tab from composer; Enter/Space activates; focus to composer on stop per AC.5.
- screen reader: button aria-label "Stop generating"; "Stopped" chip announced as part of the message region (`role="status"` once at stop, not repeated).
- contrast: chip meets AA in both themes; stop icon + text label (not icon-only).

---

### US-406: Syntax highlighting (rehype-highlight + github theme)

**as a** user reading code in replies
**i want** code blocks syntax-highlighted with a language-appropriate theme
**so that** code is scannable instead of a monochrome wall.

#### acceptance criteria
- [ ] AC.1: `Markdown.tsx` wires `rehype-highlight@^7.0.2` into the existing react-markdown pipeline (phase-3 US-307) — plugin added AFTER `remark-gfm`, before react-markdown's hast→React compile. Fence-language detection: fenced blocks with a language tag (` ```python `) are highlighted; blocks WITHOUT a language tag render plain (NO auto-detection — `detect` option stays `false`: auto-detect misfires on short snippets and costs CPU; revisit in open questions §12).
- [ ] AC.2: unknown/unregistered language tags degrade gracefully: the block renders plain (no highlight, no crash, no console error) with the language label still shown per phase-3 US-308 AC.1.
- [ ] AC.3: theming: `highlight.js/styles/github.css` is statically imported in `globals.css` (choice documented: static import over `<link>` — bundled with the app, zero extra request, no FOUC); a `.dark`-scoped override block replicating `github-dark.css` token colors is added in `globals.css` so both themes render correct token contrast. All highlight styling is CSS-CLASS based (`.hljs-*` classes on hast spans) — confirmed safe.
- [ ] AC.4: **NO `dangerouslySetInnerHTML` is introduced** (code-review gate): rehype-highlight operates on hast and produces React elements via react-markdown — the phase-3 XSS posture (no `rehype-raw`, default `urlTransform`) is unchanged. A grep gate for `dangerouslySetInnerHTML` in the message component passes.
- [ ] AC.5: performance: highlighting runs per completed message render (phase-3 AC.6 — markdown kicks in at completion); a 100-message conversation with highlighted code blocks does not block input (memoized per message, consistent with phase-3 US-307 AC.7).
- [ ] AC.6: all phase-3 US-308 behaviors are preserved: language label, copy button, horizontal scroll, keyboard-scrollable `pre` — highlighting is strictly additive to the existing code-block component.
- [ ] AC.7: unit/e2e test: a fixture with ` ```js `, ` ```python `, ` ```nonsense-lang `, and an untagged fence renders: js+python with `.hljs-*` token spans present; nonsense-lang and untagged plain; zero raw-HTML leakage from crafted code content (e.g. code containing `<script>` renders as text inside the code block).

#### states
- empty: n/a.
- loading: unchanged phase-3 streaming (plain-text accumulation; highlighting applies at completion, same snap point as markdown).
- error: parse/highlight failure degrades to plain text (message never dropped — phase-3 US-308 error state).
- success: highlighted blocks in light and dark themes per AC.3.

#### out of scope
- shiki / wasm highlighters, workers (locked: CSS-class rehype-highlight only).
- line numbers, diff highlighting, copy-with-language.
- user-message highlighting (user messages stay plain text — phase-3 US-307 AC.5).

#### dependencies
- depends on: phase-3 US-307/US-308 (markdown + code-block component)
- blocks: nothing

#### a11y notes
- contrast: `.hljs-*` token colors meet WCAG AA against the code-block background in BOTH themes (the `.dark` override block is validated, not copied blindly).
- screen reader: code semantics unchanged (phase-3 US-308: labeled region); token spans are inline styling only — no AT impact.
- motion: n/a.

---

### US-407: Edit user message (truncate + re-stream)

**as a** user who misspoke
**i want** to edit one of my sent messages and get a fresh answer
**so that** the conversation continues from what I actually meant.

#### acceptance criteria
- [ ] AC.1: `POST /api/chats/:id/messages/:messageId/edit` requires a session; conversation missing/foreign → `404 NOT_FOUND`; message not found in THIS conversation → `404 NOT_FOUND` (byte-identical, enumeration guard).
- [ ] AC.2: request body `{ content: string }` — zod `.strict()`; content must be 1..8000 chars (same bounds as send); violations → `422 INVALID_INPUT` with `fields.content`.
- [ ] AC.3: only `role === "user"` messages are editable; an assistant/system target → `422 { code: "NOT_EDITABLE", message: "Only your own messages can be edited" }`.
- [ ] AC.4: **edit-in-place truncation (locked decision)**: within one transaction the server (a) updates the target message's `content`, (b) DELETES all messages in the conversation with `createdAt > target.createdAt` (strictly after — tie-broken by id order for same-timestamp rows), then (c) re-streams a new assistant response from the truncated history via the SAME SSE protocol as `POST /api/chats/:id/messages`. Response 200 = SSE stream. Deleted messages are gone permanently (soft-delete of messages is NOT built — messages aren't conversation rows; accepted and documented in §8).
- [ ] AC.5: **branching-model interaction (documented, §8)**: descendant sub-conversations are structurally UNAFFECTED (their rows are separate; `highlightText`/`highlightContext` are copied strings, not message FKs). However, their FUTURE sends perform the phase-1 ancestor walk over live messages — an edit above them changes the context their next message sees. Accepted as correct behavior (sub-chats explore the living conversation); documented in the sub-chat banner is NOT changed in this phase.
- [ ] AC.6: conflicts: an active stream on the conversation → `409 { code: "STREAM_ACTIVE" }` (abort-then-proceed is NOT used for destructive ops); the client disables Edit while its own pane is streaming. Rate limit: edit shares the message-send LLM bucket (30/10min/user); exceeding → `429 RATE_LIMITED` with phase-1 headers.
- [ ] AC.7: provider failure mid-re-stream behaves per phase-0 US-005 AC.7: partial assistant content persisted + inline error banner + Retry (retry re-streams from the truncated history — the edit itself is NOT rolled back).
- [ ] AC.8: UI: hover (or keyboard focus) on one's own user message shows an Edit affordance; activating it turns the bubble into an inline textarea (prefilled, ≤8000 chars, Shift+Enter newline) with Save/Cancel; Save calls the endpoint and renders the streaming response in place of the truncated tail; Cancel restores the bubble unchanged. Other panes are unaffected; the pane's message list refetches/prunes to the truncated state immediately on save.
- [ ] AC.9: ancestor-walk interaction (phase-1): the walk reads live messages at send time, so the edited content (not the original) is what the model sees — verified by a unit test asserting the constructed history contains the edited string.

#### states
- empty: n/a.
- loading (save): textarea disabled + "Re-asking…"; then streaming state per phase 1.
- error: 404 → toast "Message not found"; 409 → toast "Stop the current response first"; 422 field error inline under the textarea; 429 → toast; 502/503 → existing provider banner (per AC.7). Cancel always available.
- success: edited message rendered; tail replaced by new streamed reply.

#### out of scope
- edit creating a new branch (phase 5 idea — §8).
- editing assistant messages; message-level soft-delete/undo.
- optimistic rendering of the edit (phase 5 — §11).
- mobile-optimized edit UX (§11).

#### dependencies
- depends on: US-405 (abort path), phase-1 ancestor walk, phase-0 stream persistence
- blocks: US-408 (reuses the truncate-and-stream mechanics)

#### a11y notes
- keyboard: Edit affordance reachable via Tab (visible on focus, not hover-only); textarea per composer keyboard rules; `Esc` = Cancel; Save on Enter.
- screen reader: edit mode announced ("Editing your message"); Save/Cancel labelled; the replaced tail is inside the existing `aria-live` region so the new stream announces per phase-1 behavior.
- contrast: AA for edit affordance, textarea, and errors.

---

### US-408: Regenerate assistant message

**as a** user unhappy with a reply
**i want** to regenerate the assistant's last response
**so that** I get an alternative answer without retyping my question.

#### acceptance criteria
- [ ] AC.1: `POST /api/chats/:id/messages/:messageId/regenerate` requires a session; conversation or message missing/foreign → `404 NOT_FOUND` (byte-identical).
- [ ] AC.2: only the LAST assistant message in the conversation is regenerable (by `createdAt ASC` order, id tie-break); any other assistant message → `422 { code: "NOT_REGENERABLE", message: "Only the latest response can be regenerated" }`; a `user`-role target → same `422 NOT_REGENERABLE`.
- [ ] AC.3: semantics: within one transaction the target assistant message is DELETED, then a new assistant response is streamed with the SAME preceding history (the previous user message is unchanged and NOT re-persisted) via the same SSE protocol. Response 200 = SSE stream.
- [ ] AC.4: the regenerated response resolves the provider per-request exactly like a normal send (phase-3 US-304) — a different provider/model than the original is possible and is persisted on the new row (`model`, `providerId`).
- [ ] AC.5: conflicts/rate limits identical to US-407 AC.6: `409 STREAM_ACTIVE`; shares the message-send LLM bucket (30/10min/user) → `429`.
- [ ] AC.6: provider failure mid-stream per phase-0 pattern: partial content persisted + error banner + Retry (retry = another regenerate call from the same history).
- [ ] AC.7: UI: a "Regenerate" affordance appears on the last assistant message (and only the last) — hover/focus affordance plus a regenerate icon button in the message tail area while NOT streaming; activating it streams the replacement in place.
- [ ] AC.8: Stop during regeneration behaves per US-405 AC.6 (partial persists + "Stopped" chip + lock release).

#### states
- empty: n/a.
- loading: previous content replaced by streaming caret state (phase-1 streaming visuals).
- error: 404 toast; 409 toast "Stop the current response first"; 422 NOT_REGENERABLE → affordance simply not shown (server still validates); 429 toast; 502/503 banner per AC.6.
- success: new response rendered with fresh model/provider provenance.

#### out of scope
- regenerating non-last responses (edit + regenerate-latest composes to the same effect).
- keeping/regeneration history ("view previous versions") — the old response is deleted (documented §8).
- per-message model override when regenerating (phase 5 — §11).

#### dependencies
- depends on: US-405, phase-3 US-304 (provider resolution)
- blocks: nothing

#### a11y notes
- keyboard: regenerate affordance focusable, Enter/Space activates; not hover-only (visible on focus).
- screen reader: affordance aria-label "Regenerate response"; the replacement stream announces via the existing `aria-live` region.
- contrast: AA.

---

### US-409: Keyboard shortcuts + `?` overlay

**as a** keyboard-first user
**i want** consistent shortcuts for the common actions and a place to discover them
**so that** I can navigate the app without reaching for the mouse.

#### acceptance criteria
- [ ] AC.1: the shortcut set (full map in §9) is implemented globally: `Cmd/Ctrl+K` → create new chat and navigate to it; `/` → focus tree search (US-404); `Cmd/Ctrl+\` → toggle split view (open second pane with parent, or close split when open); `?` (Shift+/) → open the shortcut overlay; `Esc` → context-sensitive close (focused pane/dialog/search-clear, precedence in §9).
- [ ] AC.2: shortcuts are suppressed while focus is in an input, textarea, contenteditable, or an open dialog — EXCEPT `Esc` (dialog close / search clear) which always applies in its own context. Verified by unit test: typing "K" or "?" in the composer does NOT trigger actions.
- [ ] AC.3: `Cmd/Ctrl+K` works on every authenticated page (list + chat views); on success navigates to `/chats/<new-id>` within 500ms (same path as the New chat button); while a create is in flight, repeat presses are ignored (no duplicate chats).
- [ ] AC.4: `Cmd/Ctrl+\` toggle: when split is closed, opens split with the parent conversation of the current chat (or disabled state + toast "This chat has no parent" for roots); when open, closes the split pane. Mirrors the existing split button behavior exactly (no second code path — the shortcut invokes the same handler).
- [ ] AC.5: the `?` overlay is a simple dialog (`role="dialog"`, focus-trapped, `Esc` closes) listing ALL shortcuts with their keys rendered as `<kbd>`-styled chips and one-line descriptions; it matches the phase-3 dialog a11y pattern (focus restore on close).
- [ ] AC.6: a "?" shortcut hint is discoverable: the header help affordance (or footer hint per UX contract) opens the same overlay — mouse users can find it too.
- [ ] AC.7: shortcut keys honor platform: `Cmd` on macOS, `Ctrl` elsewhere (detected via `navigator.platform`/UA; the overlay displays the correct modifier for the current platform).

#### states
- empty: n/a.
- loading: `Cmd/Ctrl+K` shows the existing new-chat pending state (button spinner equivalent — navigation placeholder per phase-0 US-004 states).
- error: new-chat failure toast per phase-0 US-004; split-open on a root → toast per AC.4; overlay has no error states.
- success: action executes; overlay closes on `Esc` or backdrop.

#### out of scope
- user-configurable/rebindable shortcuts (§11).
- additional navigation shortcuts (go-to-parent hotkey remains deferred from phase-1 §10 — phase 5 candidate).
- shortcut cheatsheet as a route/page (dialog only).

#### dependencies
- depends on: US-404 (`/` target), phase-2 split view (toggle target), phase-0 US-004 (new chat)
- blocks: nothing

#### a11y notes
- keyboard: this story IS keyboard functionality; overlay is fully keyboard-operable with focus trap + restore (phase-3 dialog pattern).
- screen reader: overlay is a labelled dialog ("Keyboard shortcuts"); `<kbd>` chips are presentational — descriptions carry the meaning; shortcut actions announce their result via existing mechanisms (navigation, `role="status"` toasts).
- contrast: `<kbd>` chips and overlay text meet AA in both themes.

---

## 3. Acceptance criteria (consolidated, phase-level)

Phase 4 is done when ALL of these pass:

- [ ] **AC-P4-1:** delete end-to-end: soft-delete cascades the subtree in one transaction, `deletedIds` returned, every read path (list/chat/tree/export/send) 404s on soft-deleted ids, ownership 404 parity byte-identical (US-401).
- [ ] **AC-P4-2:** restore reverses an exact delete batch (idempotent second call → `restoredCount: 0`); delete+restore rate-limited 30/10min/user with phase-1 headers (US-401).
- [ ] **AC-P4-3:** delete UI: confirm dialog (subtree-aware copy), row removal ≤ 300ms, 5s undo toast restores subtree without reload, all failure toasts per US-402 AC.6 (US-402).
- [ ] **AC-P4-4:** export: `?format=md|json` per §5 shapes, correct Content-Type + Content-Disposition, md carries breadcrumb + highlight context for sub-chats, json carries full own-row data with no key material, invalid format → 400 (US-403).
- [ ] **AC-P4-5:** tree search: client-only filter (zero network requests while typing, test-asserted), title+highlightText match, ancestors preserved, `/` focus + `Esc` clear, empty state with clear button, 150ms debounce + <100ms filter (US-404).
- [ ] **AC-P4-6:** stop: abort mid-stream persists partial assistant content (unit-tested), lock releases ≤ 300ms, "Stopped" chip shows, no error banner on intentional abort (US-405).
- [ ] **AC-P4-7:** highlighting: rehype-highlight wired with `detect:false`, known-language fences highlight, unknown/untagged degrade plain, github.css + `.dark` override in both themes, zero `dangerouslySetInnerHTML` (grep gate), phase-3 code-block behaviors intact (US-406).
- [ ] **AC-P4-8:** edit: user-only targets, strict zod content bounds, transactional truncate+re-stream over SSE, edited content is what the ancestor walk sees (unit-tested), 409 STREAM_ACTIVE, provider-failure partial+Retry per phase-0 (US-407).
- [ ] **AC-P4-9:** regenerate: last-assistant-only (422 otherwise), target deleted + re-stream with same history, fresh provider resolution persisted, share send rate bucket (US-408).
- [ ] **AC-P4-10:** shortcuts: full §9 map works with suppression-while-typing (unit-tested), `Cmd/Ctrl+K` dedupe, `Cmd/Ctrl+\` reuses split handler, `?` overlay with platform-correct modifiers and phase-3 dialog a11y (US-409).
- [ ] **AC-P4-11:** every phase-4 surface implements the §4 states matrix (empty/loading/error/success); US-402/409 dialogs are focus-trapped with focus restore; all toasts are `role="status"`/`role="alert"` as appropriate.
- [ ] **AC-P4-12:** `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` pass with zero errors; unit tests cover: soft-delete cascade + restore idempotence + read-path 404s, export md structure (fixture), search filter semantics (match/ancestor/no-network), abort partial-persist, edit truncation + ancestor-walk content, regenerate last-only guard, shortcut suppression; NO new dependencies.
- [ ] **AC-P4-13:** Playwright e2e covers: delete → undo → restored in tree; export md download (content assertion); `/` search filter + Esc clear; stop mid-stream → partial persisted on reload; edit user message → tail replaced with new stream; regenerate last reply; `?` overlay opens/closes; `Cmd/Ctrl+K` new chat.
- [ ] **AC-P4-14:** migration `0001` applies cleanly to a fresh DB AND to a DB with phase-0..3 data (additive column + index swap, no data loss); rollback path documented (§7).

## 4. States (consolidated matrix)

| Surface | Empty | Loading | Error | Success |
|---|---|---|---|---|
| Delete confirm dialog (US-402) | n/a | Confirm spinner "Deleting…" | 409/429/5xx toasts; dialog stays open | row(s) removed + undo toast |
| Undo toast (US-402) | n/a | n/a (restore is fast; button disabled while in flight) | "Could not undo — try again" + tree refetch | subtree restored, toast dismissed |
| Export menu (US-403) | n/a | menu-item spinner | toast "Could not export — try again"; 404 → pane not-found surface | file downloads |
| Tree search (US-404) | no query → full tree | n/a (client-side; input disabled if tree load failed) | n/a (no network); empty result → "No conversations match" + Clear | filtered tree + `<mark>` highlights + result count |
| Stop button (US-405) | hidden when not streaming | n/a (IS the streaming state) | intentional abort → NO error banner | partial content + "Stopped" chip, composer ready |
| Code blocks (US-406) | n/a | unchanged phase-3 streaming | highlight failure → plain-text degrade | highlighted block, both themes |
| Edit mode (US-407) | n/a | "Re-asking…" + streaming | inline field error / toasts / provider banner; Cancel always available | edited msg + fresh reply |
| Regenerate (US-408) | affordance hidden while streaming | streaming caret | 409/429 toasts; provider banner; partial+Retry | new reply, fresh provenance |
| Shortcut overlay (US-409) | n/a | n/a | n/a | open/close per dialog pattern |

## 5. API surface

All routes under `src/app/api/`; error shape per phase 0 (`{ error: { code, message?, fields? } }`); `auth()` required; ownership → 404 byte-identical (never 403).

### `DELETE /api/chats/:id` (NEW — reserved in phase 0 §5, now implemented)
Soft-deletes the conversation + subtree.
**Response 200:**
```json
{ "deletedIds": ["uuid-root", "uuid-child-1", "uuid-child-2"], "deletedCount": 3 }
```
**Errors:** `401 UNAUTHENTICATED` · `404 NOT_FOUND` · `409 STREAM_ACTIVE` · `429 RATE_LIMITED` (+`Retry-After`, `X-RateLimit-*`) · `500 INTERNAL`.

### `POST /api/chats/:id/restore` (NEW)
Reverses one delete batch (server remembers the affected id set per conversation — §6).
**Request:** `{}` (empty body OK).
**Response 200:** `{ "restoredCount": 3 }` — `0` when nothing to restore (idempotent).
**Errors:** `401` · `404 NOT_FOUND` · `429 RATE_LIMITED` · `500`.

### `GET /api/chats/:id/export?format=md|json` (NEW)
**Response 200 (md):** `Content-Type: text/markdown; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>-<YYYYMMDD>.md"`, body:
```markdown
# Deploying with Docker

> Path: Deploying with Docker › Why did my container exit?
> Highlight: "the restart policy only applies to exit code 1"
> Context: Docker docs say restart policies trigger on failure exits, but …

---

## You
Why did my container exit?

## Assistant
Containers exit when the main process terminates. …
```
**Response 200 (json):**
```json
{
  "conversation": { "id": "uuid", "title": "Deploying with Docker", "parentId": null,
    "rootConversationId": "uuid", "depth": 0, "highlightText": null, "highlightContext": null,
    "createdAt": "2026-09-13T10:00:00Z", "updatedAt": "2026-09-13T10:05:00Z" },
  "messages": [ { "id": "uuid", "role": "user", "content": "Why did my container exit?",
    "model": null, "providerId": null, "createdAt": "2026-09-13T10:01:00Z" } ]
}
```
**Errors:** `400 INVALID_INPUT` (bad/missing format) · `401` · `404 NOT_FOUND` · `500`. (GET — not rate-limited.)

### `POST /api/chats/:id/messages/:messageId/edit` (NEW)
Truncate-at-message + re-stream. Response 200 is an **SSE stream** (phase-0 AI SDK protocol), sent after the transaction commits.
**Request:** `{ "content": "Why did my container exit — and how do I debug it?" }` — zod `.strict()`, 1..8000 chars.
**Errors (pre-stream):** `401` · `404 NOT_FOUND` · `422 INVALID_INPUT` (fields) · `422 NOT_EDITABLE` (non-user target) · `409 STREAM_ACTIVE` · `429 RATE_LIMITED` · `503 NO_PROVIDER` / `502 PROVIDER_FAILED` (per phase 0) · `500`.
**Post-stream failure:** partial assistant persisted + error SSE event (phase-0 US-005 AC.7 contract).

### `POST /api/chats/:id/messages/:messageId/regenerate` (NEW)
Delete last assistant message + re-stream. Response 200 is an **SSE stream**.
**Request:** `{}` (empty body OK).
**Errors:** `401` · `404 NOT_FOUND` · `422 NOT_REGENERABLE` (not last assistant / wrong role) · `409 STREAM_ACTIVE` · `429 RATE_LIMITED` · `503`/`502` · `500`.

### Existing routes (MODIFIED behavior, unchanged contracts)
- `GET /api/chats`, `GET /api/chats/:id`, `GET /api/chats/:id/tree`, `POST /api/chats/:id/messages`: all now exclude soft-deleted conversations (`deletedAt IS NULL` filter / 404). No shape changes.
- Note: the tree endpoint's `rootConversationId` lookup resolves the root row first — a soft-deleted ROOT makes all its descendants 404 too (they are soft-deleted as a batch, so this is consistent; a descendant whose root was deleted-but-restored works again after restore).

## 6. DB changes (Drizzle — first post-bootstrap migration)

**Migration `0001_add_conversation_soft_delete`** (generated via `pnpm db:generate`, applied via `pnpm db:migrate`):

1. **Schema edit** (`src/lib/db/schema.ts`): add to `conversations`:
   `deletedAt: tsNullable("deleted_at")` — nullable timestamptz, no default (null = live).
2. **Index change:** replace `conversations_user_updated_idx` with a **partial index** so the hot list query stays index-only over live rows:
   - DROP `conversations_user_updated_idx`
   - CREATE `conversations_user_updated_live_idx ON conversations (user_id, updated_at DESC) WHERE deleted_at IS NULL`
   (Drizzle: `.where(sql\`deleted_at is null\`)` on the index builder; existing `parentIdx`/`rootIdx` unchanged — subtree queries are by id-set, delete filters `deletedAt IS NULL` cheaply.)
3. **Generated SQL (expected shape, review before apply):**
   ```sql
   ALTER TABLE "conversations" ADD COLUMN "deleted_at" timestamp with time zone;
   DROP INDEX IF EXISTS "conversations_user_updated_idx";
   CREATE INDEX "conversations_user_updated_live_idx"
     ON "conversations" ("user_id", "updated_at" DESC) WHERE "deleted_at" IS NULL;
   ```
4. **Restore-batch bookkeeping:** the delete endpoint records the affected id set so restore replays it exactly. Simplest owner: a `deletedIds` array persisted where? Decision: NO new table — recompute the batch at restore time as "all conversations (any `deletedAt` state) whose root chain leads to `:id` and whose `deletedAt` is non-null AND was set by the same logical delete". To avoid heuristic drift, store the batch **on the rows themselves**: add a second nullable column `deletedBatchId text` (uuid generated per delete call). Restore = `UPDATE conversations SET deleted_at = NULL, deleted_batch_id = NULL WHERE deleted_batch_id = :batchId AND user_id = :userId`. This makes restore exact and idempotent with zero new tables — **so the migration is TWO columns + the index swap**:
   ```sql
   ALTER TABLE "conversations" ADD COLUMN "deleted_at" timestamp with time zone;
   ALTER TABLE "conversations" ADD COLUMN "deleted_batch_id" text;
   CREATE INDEX "conversations_deleted_batch_idx" ON "conversations" ("deleted_batch_id");
   DROP INDEX IF EXISTS "conversations_user_updated_idx";
   CREATE INDEX "conversations_user_updated_live_idx"
     ON "conversations" ("user_id", "updated_at" DESC) WHERE "deleted_at" IS NULL;
   ```
5. **Rollback path:** fully additive — `ALTER TABLE conversations DROP COLUMN deleted_at; DROP COLUMN deleted_batch_id; DROP INDEX conversations_user_updated_live_idx; CREATE INDEX conversations_user_updated_idx ON conversations (user_id, updated_at);` documented in the migration file comment.
6. **Verification:** `0001` applies cleanly to (a) fresh DB, (b) DB seeded with phase-0..3 data (AC-P4-14); all existing rows get `deleted_at = NULL` implicitly (additive).

`messages` and `providers` tables: **no changes** (message truncation uses hard DELETE of message rows — no soft-delete at message level, per US-407 AC.4 decision).

## 7. Syntax highlighting — theme choice (documented)

- **Plugin:** `rehype-highlight@^7.0.2` (already in package.json; CSS-class based — emits `.hljs-*` spans on hast; NO worker, NO wasm). Options: `{ detect: false }` (default) — fence-language only.
- **Theme:** `github.css` (highlight.js built-in style) for light; a `.dark`-scoped token-override block in `globals.css` replicating `github-dark.css` token colors for dark.
- **Import method: static import in `globals.css`** (`@import "highlight.js/styles/github.css";` — resolved by the bundler). Rationale over `<link>`: bundled + hashed with the app (cache-busting for free), zero render-blocking extra request, no FOUC on first paint, works identically in dev and prod builds. The `<link>` alternative is rejected (extra network dependency, manual cache management, flash risk).
- **Safety:** rehype-highlight transforms hast → react-markdown renders it as React elements; no HTML-string path exists, so `dangerouslySetInnerHTML` stays absent (grep gate, US-406 AC.4). Malicious "code" content is inert — it is text inside `<code>`.

## 8. Semantic decisions (locked, with rationale)

1. **Delete policy — cascade subtree (not block):** a sub-chat's meaning depends on its ancestor chain (phase-1 context banner, ancestor walk). Blocking parents-with-children would force leaf-first teardown and strand children with broken context; cascade matches the product's mental model (a branch is cut whole). Undo (5s toast + restore) covers the misclick risk; soft-delete covers the "wait I needed that" risk until purge.
2. **Edit — in-place truncate + re-stream (not branch-on-edit):** per brief recommendation. Branch-on-edit is a genuinely interesting phase-5 idea (consistent with the highlight-to-branch philosophy) but doubles the edit state surface (which branch am I on? which history is live?) — it must not ship half-built alongside delete/undo/export in the polish phase. Truncation deletes subsequent message rows permanently (no message-level soft-delete — accepted; conversation-level undo is the safety net users have).
3. **Edit/regenerate vs the ancestor walk:** the walk reads live messages at send time (phase 1), so edited/truncated ancestors are what sub-chats see on their NEXT send. Existing sub-chat rows are never structurally broken (`highlightText`/`highlightContext` are copied strings, not FKs). This is correct behavior — sub-chats explore the living conversation — and is documented here as intended, not incidental.
4. **"Stopped" indicator — ephemeral:** the stop chip lives in client memory only; a reloaded page shows the partial content as a plain message. No schema change. Revisit if QA reports confusion (could later persist a `stoppedAt` column — cheap additive migration).
5. **Regenerate keeps no history:** the previous response is deleted, not versioned. Version pickers are a phase-5+ feature; shipping a hidden copy with no UI creates data users can't see or purge.
6. **Edit/regenerate conflict policy — 409, not abort-and-proceed:** phase 0's abort-then-proceed fits benign sends; destructive truncation must never race an in-flight stream. Explicit 409 + UI suppression is deterministic.
7. **Rate-limit buckets:** edit/regenerate invoke LLM spend, so they share the message-send bucket (30/10min/user). Delete/restore get their own 30/10min/user bucket (no LLM cost, but abuse-bounded).

## 9. Keyboard shortcut map (normative)

| Keys | Action | Context / notes |
|---|---|---|
| `Cmd/Ctrl + K` | New chat → navigate to it | global, authenticated pages; deduped while in flight |
| `/` | Focus tree search input | global; suppressed in inputs/textarea/contenteditable/dialogs |
| `Cmd/Ctrl + \` | Toggle split view | chat view; root chat → toast "This chat has no parent"; invokes the same handler as the split button |
| `Esc` | Context-sensitive close: focused dialog → close dialog; tree-search focused → clear + blur; split pane focused → close that pane | precedence: dialog > search > pane; never aborts a stream (US-405 AC.7) |
| `?` (Shift + `/`) | Open shortcut overlay | global; suppressed in inputs (typing a literal `?` in the composer must NOT open it) |

Suppression rule (US-409 AC.2): all shortcuts except context-`Esc` are no-ops while focus is in an input/textarea/contenteditable or an open dialog.

## 10. A11y notes (phase-consolidated)

- **Dialogs** (delete-confirm, shortcut overlay): `role="dialog"` + `aria-modal`, focus trap, `Esc` closes, focus restores to the trigger (phase-3 US-309 AC.4 pattern).
- **Toasts**: `role="status"` (undo/delete/export feedback); errors that require attention use `role="alert"`; the 5s undo window is never announced as a ticking countdown — only state changes ("Chat deleted", then silence).
- **Delete affordances**: icon + text (never color/icon alone); confirm copy states the subtree consequence explicitly ("and its N sub-chat(s)").
- **Tree search**: labelled input; result-count changes announced via `role="status"`; `<mark>` is visual-only (node text content unchanged for AT); filtered tree keeps the WAI-ARIA tree pattern fully navigable.
- **Stop / Edit / Regenerate affordances**: visible on keyboard focus (not hover-only), labelled, Enter/Space activate; after stop, focus moves to the composer.
- **Edit mode**: announced ("Editing your message"); `Esc` = Cancel; Save/Cancel are real buttons with labels.
- **Highlighting**: token colors meet WCAG AA against the code-block background in BOTH themes (`.dark` override validated, not copied blindly); code semantics per phase-3 US-308 unchanged.
- **Motion**: `prefers-reduced-motion` honored on toasts, dialogs, and the undo countdown visual (instant appear/disappear).
- **Keyboard map**: §9 is the contract; the `?` overlay documents exactly what ships — no hidden shortcuts.

## 11. Out of scope (explicit)

The following are NOT in phase 4 and MUST NOT be built:

- **Optimistic message rendering** — re-deferred to phase 5 (interacts with edit/regenerate; ships after those stabilize).
- **Branch-on-edit** (edit creates a sub-chat branch) — phase 5 idea (§8.2).
- **Message-level soft-delete/undo** (conversation-level only).
- **Regeneration history / version picker** (§8.5).
- **File/image attachments, tool use / function calling** — phase 5+.
- **MFA, password reset, email verification** — phase 5+.
- **Key rotation UI, provider test-connection** — phase 5+.
- **Per-message (or per-conversation) model override** — phase 5+.
- **Soft-delete hard-purge cron** (30-day retention) — ops concern, separate task; no hard DELETE in phase-4 code (US-401 AC.9).
- **"Trash" folder / deleted-items UI** (undo toast is the only recovery path).
- **Export of whole trees / multi-conversation; PDF/html/txt formats** (per-conversation md/json only).
- **Cross-root / server-side conversation search; search by message content** (tree search is within one root, title+highlight only).
- **User-configurable shortcuts; go-to-parent hotkey** (phase-1 carry-over, stays deferred).
- **Mobile-optimized edit UX** (basic responsive behavior only).
- **Shiki / worker / wasm highlighters; line numbers; diff highlighting.**
- **Auto-language detection** for untagged code fences (`detect: false` — OQ-3).
- **Persistent "stopped" flag in the DB** (ephemeral chip — §8.4).

## 12. Open questions (for Orchestrator / user)

1. **Delete cascade vs block (OQ-1).** Spec locks **cascade subtree** with soft-delete undo (§8.1). Alternative: block parents with children. **PM default: cascade** — confirm, since it changes what "delete" means for the whole tree.
2. **Restore-batch column (OQ-2).** Spec adds `deletedBatchId` (§6.4) to make undo exact and idempotent without a new table. Alternative: recompute the batch at restore time (no column, but heuristic drift if a descendant was deleted separately earlier). **PM default: the column** — one extra nullable text column is cheap; exactness is worth it.
3. **Auto-detection for untagged fences (OQ-3).** Spec: `detect: false` (plain rendering) — predictable, cheap. Alternative: `detect: true` for prettier untagged blocks. **PM default: off**; revisit only if users complain.
4. **Edit truncation is destructive (OQ-4).** Deleted tail messages are unrecoverable (no message soft-delete). Alternative: message-level soft-delete + "restore tail" — deferred as complexity. **PM default: accept**; the 5s undo covers conversations, not message tails — confirm acceptable.
5. **Stop indicator persistence (OQ-5).** Ephemeral chip (§8.4). Alternative: persist `stoppedAt` now. **PM default: ephemeral** (zero migration); upgrade path noted.
6. **Undo window — server-enforced? (OQ-6).** UI enforces 5s; the restore API itself accepts calls any time before purge. Alternative: server rejects restore > 5s after delete. **PM default: UI-only window** (API generosity is harmless pre-purge and helps support).
7. **Sub-chat context mutation visibility (OQ-7).** When an edit changes ancestor history, descendant sub-chats silently see different context on next send. Add a dismissible notice in the sub-chat banner ("Parent conversation was edited") — or ship silent per §8.3? **PM default: silent in phase 4** (banner plumbing is phase-5 candidate); flagged for UX.

## 13. Definition of done

Phase 4 is signed off when ALL boxes are checked:

### Spec hygiene
- [ ] every user story uses as-a / i-want / so-that template
- [ ] every AC is testable (verb-led, actor-named, measurable)
- [ ] every UI surface has empty / loading / error / success states (§4 matrix)
- [ ] out-of-scope explicit (§11, 16 items)
- [ ] open questions listed for Orchestrator resolution before build starts (§12, 7 items, each with a PM default)
- [ ] spec reviewed by Critic; issues resolved; frozen by Orchestrator
- [ ] UX contract file (`.orchestrator/specs/ux/phase-4.md`) delivered or explicitly scheduled

### Stack, schema & migration
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test` pass with zero errors
- [ ] NO new dependencies (rehype-highlight already in package.json)
- [ ] migration `0001` (deleted_at + deleted_batch_id + partial index swap) generated, reviewed, applies cleanly to fresh AND data-carrying DBs, rollback documented (§6)
- [ ] no hard DELETE of conversation rows anywhere; purge cron absent (§11)

### Delete + undo
- [ ] cascade soft-delete in one transaction; `deletedIds`/`deletedCount` exact
- [ ] all read paths 404 on soft-deleted ids (list, chat, tree, export, send)
- [ ] restore replays the exact batch; second call → `restoredCount: 0`
- [ ] `409 STREAM_ACTIVE` on delete-while-streaming; 404 parity byte-identical; rate limits with headers
- [ ] UI: confirm dialog with subtree copy, ≤300ms removal, 5s undo toast, all §4 failure toasts

### Export
- [ ] md + json per §5 shapes; Content-Type + Content-Disposition correct; sub-chat md carries path + highlight context; no cross-user or key material leakage (unit-asserted)

### Search
- [ ] client-only filter (zero fetch while typing, test-asserted); title+highlight match; ancestors preserved; `/` focus, `Esc` clear; empty state

### Stop
- [ ] abort persists partial content (unit test); lock release ≤ 300ms; "Stopped" chip; no error banner on intentional abort

### Highlighting
- [ ] rehype-highlight wired, `detect:false`; known/unknown/untagged behavior per US-406; github.css static import + `.dark` override in both themes
- [ ] `dangerouslySetInnerHTML` grep gate passes; phase-3 code-block behaviors intact (label, copy, scroll, keyboard)

### Edit + regenerate
- [ ] edit: user-only, strict bounds, transactional truncate + SSE re-stream, ancestor walk sees edited content (unit test), 409 + 422 + 429 paths
- [ ] regenerate: last-assistant-only guard, delete + re-stream, per-request provider resolution persisted
- [ ] both share the send rate bucket; provider-failure partial+Retry per phase 0

### Shortcuts
- [ ] §9 map implemented; suppression-while-typing unit-tested; `Cmd/Ctrl+K` dedupe; split toggle reuses the button handler; `?` overlay with platform-correct modifiers and dialog a11y

### A11y
- [ ] §10 checklist passes as QA: dialogs trapped+restored, toasts announced, focus-visible affordances, AA contrast both themes, reduced-motion honored

### Tests & docs
- [ ] Vitest: delete/restore batch semantics, read-path 404s, export fixtures, search semantics, abort persistence, edit truncation + walk content, regenerate guard, shortcut suppression, highlight degrade paths
- [ ] Playwright: AC-P4-13 flows
- [ ] README + endpoints doc updated (delete/restore/export/edit/regenerate; shortcut map); `.orchestrator/STATE.md` updated: phase 4 status = `ready_to_build`

---

**PM self-review (pre-Critic):**

| DoD item | Status | Note |
|---|---|---|
| Stories cover happy + edge | ✅ | US-401..409: delete API+UI, export, search, stop, highlight, edit, regenerate, shortcuts |
| AC testable | ✅ | every AC names actor + verb + measurable outcome; grep-gates and unit-test assertions called out |
| States per surface | ✅ | §4: 9 surfaces × 4 states |
| Out-of-scope explicit | ✅ | §11: 16 items; optimistic rendering explicitly re-deferred |
| Open questions | ✅ | §12: 7 items, each with PM default |
| Schema verified | ✅ | schema.ts:71-102 read; deletedAt + deletedBatchId additive; partial index swap specified (§6) |
| Locked libs honored | ✅ | rehype-highlight@^7.0.2 per brief; zero new deps |
| Brief deviations | 1 | `deletedBatchId` column added beyond brief's single-column mention — required for exact undo (OQ-2); flagged |
| Carry-over accounting | ✅ | edit/regenerate land (phase-0/2/3 carry); optimistic rendering re-deferred with reason; syntax highlighting lands per lock |

**Critic verdict:** pending independent review.
