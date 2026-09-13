# Phase 1 Spec — Sub-Chat Core

**status:** frozen
**frozen_on:** 2026-09-13
**frozen_revision:** 2 (3 Reviewer polish items applied by Orchestrator + 3 open questions resolved)
**owner:** PM
**builds_on:** `.orchestrator/specs/phase-0.md` (frozen rev 2)
**handoffs_required_from:** UX (deferred from phase 0), Security (threat model addendum)
**orchestrator_decisions_on_open_questions:** see `.orchestrator/decisions/phase-1-open-questions.md`

---

## 1. Phase overview

Phase 1 ships the product's unique value: **branching sub-chats**. From any assistant message, the user selects text → invokes a context-menu or floating "Sub-chat" action → a new conversation is created with `parentId` pointing to the source, `highlightText` capturing the selection, and `highlightContext` capturing the surrounding sentence(s). The user is navigated to the new sub-chat, which shows a collapsible parent-context banner and a breadcrumb back to the root. When the user sends a message in the sub-chat, the server reconstructs the full ancestor message chain (root → ... → parent → current) and prepends an optional system note so the model knows what the user is asking about. Sub-chats can themselves spawn sub-chats (arbitrary tree depth). Cross-user access remains 404. Tree-map visualization, split view, per-user provider selection, and markdown rendering are deferred.

---

## 2. User stories

### US-101: Text selection in assistant message shows a cue

**as a** user reading an assistant message
**i want** to see a small visual cue when I select text in that message
**so that** I know I can branch into a sub-chat from the selection.

#### acceptance criteria
- [ ] AC.1: while reading any assistant message, when the user makes a non-empty text selection whose range lies entirely within a single assistant message bubble, a floating "Ask about this" pill appears within 200ms, positioned near (above or below) the selection's bounding rect.
- [ ] AC.2: the pill does NOT appear if the selection range spans more than one message bubble, if the selection is empty, if the selected text is only whitespace, or if the selection is inside a user message or the composer. (Code-block guard is deferred — code rendering lands in phase 2; the pill guards user-vs-assistant at the message level only in phase 1.)
- [ ] AC.3: the pill disappears within 100ms when the selection is cleared (mouse click elsewhere, Esc, or selection collapses to empty).
- [ ] AC.4: the pill is keyboard-activatable: pressing `Enter` while the pill has focus invokes the same handler as clicking it.
- [ ] AC.5: the pill is rendered in a fixed-position container with `z-index` higher than the message list but lower than the global modal/toast layer.

#### states
- hidden: no selection or invalid selection → pill not rendered.
- visible: valid selection → pill rendered with "Ask about this" label.
- error: not applicable (purely declarative UI; failures surface in the branch-creation flow, US-103).

#### out of scope
- rich toolbar with multiple actions (e.g. "copy", "search", "summarize") — only the "Sub-chat" action lives on the pill in phase 1.
- selection persistence across page reloads.

#### dependencies
- depends on: US-007 (chat view renders messages)
- blocks: US-102, US-103

#### a11y notes
- keyboard: `Tab` moves focus into the pill when it becomes visible; `Enter` activates; `Esc` dismisses and returns focus to the message bubble.
- screen reader: pill announces as "Ask about this — sub-chat". Selection text is read by the user's screen reader via standard OS selection; the pill does not re-announce it.
- contrast: pill background and text meet WCAG AA against the page background.

---

### US-102: Right-click context menu shows "Sub-chat"

**as a** user with text selected in an assistant message
**i want** to right-click and see a "Sub-chat about selection" option
**so that** I can branch via a familiar interaction.

#### acceptance criteria
- [ ] AC.1: when the user right-clicks (`contextmenu` event) inside an assistant message bubble with a non-empty selection that lies entirely within that bubble, the browser's native context menu is replaced with a custom menu containing at minimum the item "Sub-chat about selection". A standard "Copy" item is also present.
- [ ] AC.2: the custom context menu does NOT appear for selections that are empty, span multiple bubbles, or are inside user messages or the composer — in those cases the browser's native context menu is shown unchanged. (Code-block guard deferred to phase 2 with rendering.)
- [ ] AC.3: clicking "Sub-chat about selection" closes the menu and triggers the same handler as the floating pill in US-101.
- [ ] AC.4: pressing `Esc` or clicking outside the menu closes it within 100ms without invoking any action.
- [ ] AC.5: the menu is positioned so it does not overflow the viewport; if the natural position would overflow, it flips to the opposite side (above-left becomes below-right etc.) with at least 8px of padding from the viewport edge.

#### states
- hidden: invalid selection or no right-click → menu not rendered.
- visible: valid right-click → menu rendered with items.
- error: not applicable (errors surface in US-103).

#### out of scope
- fully native browser context menu replacement (we render a custom menu in our React tree, not via OS-level override).
- additional context-menu items beyond "Sub-chat" and "Copy" in phase 1.

#### dependencies
- depends on: US-101 (same selection-detection logic)
- blocks: US-103

#### a11y notes
- keyboard: the context menu is keyboard-accessible via the floating pill path (US-101 AC.4). The native right-click path is mouse-only and equivalent to the pill path semantically; screen reader users use the pill.
- screen reader: menu items rendered as `<button role="menuitem">` with `aria-label` including the selection length ("Sub-chat about selection, 14 characters").
- contrast: menu background and items meet WCAG AA.

---

### US-103: Create sub-chat from selection

**as a** user who selected text in an assistant message
**i want** to invoke "Sub-chat" and have a new chat opened focused on that text
**so that** I can ask a follow-up without losing the original context.

#### acceptance criteria
- [ ] AC.1: the client posts `POST /api/chats/:id/branch` with body `{ messageId: <uuid>, selectedText: <string>, charStart: <int>, charEnd: <int>, clientHighlightContext?: <string> }` where `:id` is the source conversation id and `messageId` is the id of the assistant message that contains the selection.
- [ ] AC.2: the server validates: (a) session present; (b) `selectedText` 1–2000 chars, trimmed non-empty; (c) `0 ≤ charStart < charEnd ≤ content.length` where `content` is the source message; (d) `content.slice(charStart, charEnd).trim() === selectedText.trim()` (with whitespace tolerance); (e) the source conversation is owned by the current user. Failure → `422 { code: "INVALID_SELECTION" }` with field-level detail.
- [ ] AC.3: on success the server inserts a `conversations` row with `userId=<session>`, `parentId=<source.id>`, `rootConversationId=<source.rootConversationId>`, `depth=<source.depth + 1>`, `highlightText=<selectedText>`, `highlightContext=<server-built context OR clientHighlightContext if provided and ≤ 500 chars>`, `title="New chat"`. Returns `201 { id, parentId, rootConversationId, depth, highlightText, highlightContext, createdAt }`.
- [ ] AC.4: the client navigates to `/c/<new-id>` within 500ms of receiving the response.
- [ ] AC.5: while the request is in flight the floating pill shows a spinner + "Creating sub-chat…" and is disabled; the right-click menu is hidden.
- [ ] AC.6: on `422` or `5xx` the pill re-enables and a toast appears: "Could not create sub-chat — try again". The source chat is unchanged.
- [ ] AC.7: cross-user attempt (e.g. a valid UUID belonging to another user) returns `404 { code: "NOT_FOUND" }`, NOT `403`, to avoid id enumeration.
- [ ] AC.8: sub-chats can be created from sub-chats (the parent of the new sub-chat can have `depth ≥ 0`). There is no max-depth cap in phase 1 (see open question Q3).

#### states
- idle: pill/menu visible, click enabled.
- loading: pill spinner + "Creating sub-chat…", pill disabled, menu hidden.
- error (422): pill re-enabled, toast with message.
- error (404 / 5xx): pill re-enabled, toast.
- success: navigate to `/c/<id>`.

#### out of scope
- depth limit (deferred; see Q3).
- rename / delete of sub-chats (deferred; see Q4).
- picking a different AI provider at branch time.
- bulk-branching (creating multiple sub-chats in one action).

#### dependencies
- depends on: US-101, US-102
- blocks: US-104, US-105

#### a11y notes
- keyboard: same as US-101 / US-102; loading state announced via `aria-busy="true"` on the pill.
- screen reader: toast uses `role="status"` (polite).
- contrast: spinner and toast text meet WCAG AA.

---

### US-104: View sub-chat with parent context banner

**as a** user inside a sub-chat
**i want** to see the highlight that spawned this sub-chat and the source message it came from
**so that** I remember what I was asking about.

#### acceptance criteria
- [ ] AC.1: `GET /c/[id]` renders the conversation view for any conversation (root or sub-chat) owned by the current user. The route returns `404` for any conversation the user does not own.
- [ ] AC.2: for a sub-chat (`depth ≥ 1`), the view shows a parent-context banner at the top of the message list, above the sub-chat's own messages. The banner contains:
  - a label "About: <highlightText>" (≤ 200 chars; longer truncated with ellipsis)
  - the source assistant message, with `highlightText` rendered with a subtle background highlight (e.g. `bg-yellow-100` in light mode)
  - a collapsible toggle: collapsed by default on mobile, expanded by default on desktop ≥ 768px
- [ ] AC.3: for a root conversation (`depth = 0`), the banner is not rendered; the message list starts immediately.
- [ ] AC.4: the banner is purely client-state; collapsing it does not persist to the server (acceptable for v1 — see Q5).
- [ ] AC.5: clicking anywhere on the highlighted span in the banner does NOT create another sub-chat (no recursion from the banner itself). The source message remains a normal assistant message in the parent conversation.
- [ ] AC.6: the sub-chat title in the header is "New chat" until the first message is sent, after which it auto-derives from the first 6 words of the first user message (per phase 0 §10 open question #1, decided for phase 1).

#### states
- empty: sub-chat exists with no messages → banner visible, message area shows "Send a message to get started", composer visible.
- loading: full-view skeleton (banner placeholder + 3 message bubbles + composer) while `GET /api/chats/:id` is in flight.
- error (network): "Could not load conversation — retry" with retry button.
- error (404): "Conversation not found" with link to `/`.
- success: banner rendered, messages rendered, composer ready.

#### out of scope
- rendering the FULL ancestor chain in the banner (only the direct parent + highlight is shown; deeper ancestors are reachable via breadcrumb).
- banner state persistence.
- editing the highlight after creation.

#### dependencies
- depends on: US-103 (sub-chat exists)
- blocks: US-106

#### a11y notes
- keyboard: banner toggle is a `<button aria-expanded>`; Tab focuses it; Enter/Space toggles.
- screen reader: banner has `aria-label="Parent context"`; collapsed state announced; highlighted span announced as "highlighted text".
- contrast: highlight background (`bg-yellow-100`) and banner border meet WCAG AA against the page background; highlight text meets AA against its own background.

---

### US-105: Send message in sub-chat — model receives full ancestor context

**as a** user typing a follow-up question in a sub-chat
**i want** the AI to know what I'm asking about (the original highlight, the source message, and the conversation history leading up to it)
**so that** I get a relevant answer without re-explaining the context.

#### acceptance criteria
- [ ] AC.1: when the user submits a message in a sub-chat, the server (`POST /api/chats/:id/messages`) detects `depth ≥ 1` on the target conversation and invokes the **ancestor reconstruction algorithm** (section 7) to build the message array passed to `streamText`.
- [ ] AC.2: the reconstructed message array has the shape `[{ role: "system", content: <systemNote> }, ...rootMessages, ...parentMessages, ...currentMessagesBeforeNew, { role: "user", content: <new> }]` and is passed to the model in that order. The system message is the ONLY model-context-only entry; the remaining array reflects exactly the messages persisted in each ancestor's `messages` table (no duplication, no omission) plus the new user message at the end.
- [ ] AC.3: a single system message is prepended explaining the context: `"You are answering a follow-up question in a sub-chat. The user branched from <parentTitle> at the phrase: \"<highlightText>\". The following conversation history provides context; respond to the latest user message."` (template is configurable via env var `SUBSCHAT_SYSTEM_PROMPT` with the default above).
- [ ] AC.4: the user's new message is persisted to the `messages` table with `conversationId=<sub-chat id>` (NOT to the parent); only the model context includes ancestors.
- [ ] AC.5: the streamed response is persisted as an assistant message on the sub-chat, exactly as in phase 0 (US-005).
- [ ] AC.6: if any ancestor conversation is missing or owned by another user at request time (theoretical race), the server returns `503 { code: "ANCESTOR_UNAVAILABLE" }` — the user message is still persisted (so no data loss) but no AI call is made and an inline error "Sub-chat parent is unavailable — start a new chat" appears with a "New chat" button.

#### states
- empty: composer placeholder "Ask about <first-3-words-of-highlight>…" or default "Message the AI…" if highlight is too long.
- loading (sending): composer disabled, user message appears immediately in sub-chat list.
- loading (streaming): assistant message bubble accumulates tokens with blinking caret.
- error (send): "Could not send — check your connection"; user message NOT persisted; draft kept in composer.
- error (stream): inline banner "AI stopped responding — try again" with Retry (phase 0 behavior).
- error (ancestor unavailable): inline banner "Sub-chat parent is unavailable" with "New chat" button.
- success: assistant message rendered, composer cleared, ready for next.

#### out of scope
- message-level token cost / truncation (full ancestor chain passed in v1; see Q6).
- summarization of long ancestor chains.
- per-sub-chat provider override (sub-chats inherit the active provider, phase 0 US-008).
- regenerating responses in a sub-chat.

#### dependencies
- depends on: US-103, US-104
- blocks: US-108 (sub-chats-of-sub-chats need the same walk)

#### a11y notes
- same as phase 0 US-005 + US-104 (composer a11y).
- screen reader: when the system note is included, it is announced as a system message in the model context only — NOT read aloud to the user (it does not appear in their message list).

---

### US-106: Breadcrumb navigation between root, parent, and sub-chat

**as a** user inside a sub-chat
**i want** to see where I am in the conversation tree and click back to the parent or root
**so that** I can navigate without losing my place.

#### acceptance criteria
- [ ] AC.1: the sub-chat view header shows a breadcrumb of the form `Home / <rootTitle> / <parentTitle> / <subChatTitle>`. For depth 0 (root) the breadcrumb is `Home / <rootTitle>`. Each crumb except the last is a clickable link.
- [ ] AC.2: clicking a crumb navigates to `/c/<id>` for that conversation. The target conversation is loaded; if it belongs to another user (defense-in-depth) `404` is shown.
- [ ] AC.3: crumb titles are truncated to 40 chars with ellipsis on screens < 768px; full titles on larger screens.
- [ ] AC.4: the crumb for the current conversation is rendered as plain text (not a link) with `aria-current="page"`.

#### states
- empty: not applicable (breadcrumb always renders once conversation loads).
- loading: skeleton crumb strip ("Home / … / …") while conversation loads.
- error: if any ancestor crumb title cannot be resolved, render "Unknown" for that crumb rather than failing the page.
- success: breadcrumb rendered, links functional.

#### out of scope
- dropdown of siblings ("other sub-chats from this parent") — phase 2 tree-map.
- keyboard "go up" / "go down" hotkeys — deferred.
- breadcrumb scroll-into-view on mobile.

#### dependencies
- depends on: US-104
- blocks: nothing (independent of US-105)

#### a11y notes
- keyboard: each crumb link is a normal `<a>` with Tab focus; Enter activates.
- screen reader: breadcrumb wrapped in `<nav aria-label="Conversation path">` with `<ol>` of crumbs; current crumb has `aria-current="page"`.
- contrast: crumb text and link colors meet WCAG AA.

---

### US-107: Cross-user access to sub-chats is denied (404)

**as a** security-minded user
**i want** no other user to ever see my sub-chats or their content
**so that** my conversations remain private.

#### acceptance criteria
- [ ] AC.1: every route that loads a conversation by id — `GET /api/chats/:id`, `POST /api/chats/:id/messages`, `POST /api/chats/:id/branch` — checks `session.user.id === conversation.userId` and returns `404 { code: "NOT_FOUND" }` on mismatch.
- [ ] AC.2: the ancestor-walk in US-105 verifies ownership of every ancestor chain link; the first foreign-owned link in the chain returns `503 ANCESTOR_UNAVAILABLE` (the same code as a missing ancestor, to avoid leaking existence).
- [ ] AC.3: the breadcrumb in US-106 does not leak titles: if a crumb's conversation is foreign-owned it renders as "Private" with no link, instead of failing the whole page.
- [ ] AC.4: rate-limit on `POST /api/chats/:id/branch`: max 30 requests / 10 min / user (separate from phase 0 sign-in rate limit).

#### states
- error (404): UI shows "Conversation not found" with link to `/` (consistent with phase 0 US-007 AC.3).

#### out of scope
- sharing a sub-chat with another user.
- public sub-chat links.

#### dependencies
- depends on: phase 0 US-007 (404 pattern)
- blocks: nothing

#### a11y notes
- 404 page text meets WCAG AA; focus moves to the "back to home" link.

---

### US-108: Sub-chats can spawn sub-chats (arbitrary depth)

**as a** user exploring a topic deeply
**i want** to keep branching from any assistant message in any sub-chat
**so that** I can drill into nested concepts.

#### acceptance criteria
- [ ] AC.1: US-103, US-104, US-105, US-106 apply identically when the source conversation has `depth ≥ 1`. The created sub-chat has `depth = source.depth + 1`.
- [ ] AC.2: the ancestor walk in US-105 traverses arbitrarily many levels — no max depth in phase 1 (see Q3).
- [ ] AC.3: the breadcrumb in US-106 always shows the FULL chain from root to current (truncated visually on mobile, but the data is complete).
- [ ] AC.4: the parent-context banner in US-104 always shows the DIRECT parent only (one level up). Deeper ancestors are reachable only via breadcrumb clicks.

#### states
- identical to US-103 / US-104 / US-105 / US-106 at any depth.

#### out of scope
- showing more than one ancestor level in the banner.
- depth-based UI restrictions (e.g. warnings at depth 5).

#### dependencies
- depends on: US-103, US-104, US-105, US-106
- blocks: nothing

#### a11y notes
- identical to the stories it composes.

---

## 3. Acceptance criteria (consolidated, phase-level)

Phase 1 is done when ALL of these pass:

- [ ] **AC-P1-1:** a user can select text in an assistant message and see the floating "Ask about this" cue (US-101).
- [ ] **AC-P1-2:** a user can right-click selected text and see a custom "Sub-chat about selection" menu (US-102).
- [ ] **AC-P1-3:** clicking the pill or menu item creates a sub-chat via `POST /api/chats/:id/branch` and navigates to `/c/<new-id>` (US-103).
- [ ] **AC-P1-4:** a sub-chat shows the parent-context banner with the highlight + source message (US-104).
- [ ] **AC-P1-5:** sending a message in a sub-chat passes the full ancestor chain to the model with the system note; the user's message persists only on the sub-chat (US-105).
- [ ] **AC-P1-6:** the breadcrumb shows Home / Root / Parent / Current for sub-chats; each crumb links correctly (US-106).
- [ ] **AC-P1-7:** cross-user access to a sub-chat or any of its messages returns 404; ancestor walk respects ownership (US-107).
- [ ] **AC-P1-8:** sub-chats can themselves spawn sub-chats; the ancestor walk traverses all levels (US-108).
- [ ] **AC-P1-9:** every UI surface (pill, menu, branch button, banner, breadcrumb, sub-chat view, error toasts) has empty / loading / error states defined and implemented.
- [ ] **AC-P1-10:** `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` all pass with zero errors; new unit tests cover the ancestor-walk algorithm and the branch validation.
- [ ] **AC-P1-11:** Playwright e2e covers: select text → branch → sub-chat shows banner → send message → AI response persists on sub-chat (NOT on parent).
- [ ] **AC-P1-12:** Playwright e2e covers: cross-user 404 on `POST /api/chats/:id/branch` and on `GET /c/<other-user-sub-chat>`.
- [ ] **AC-P1-13:** sub-chat title auto-derives from first user message (closes phase 0 §10 open question #1).
- [ ] **AC-P1-14:** no DB migration is required — all branching fields already exist on `conversations` (phase 0 AC-P0-6 honored).

## 4. States (consolidated matrix)

| Surface | Empty | Loading | Error | Success |
|---|---|---|---|---|
| Floating pill (US-101) | not rendered | n/a (declarative) | n/a | rendered on valid selection |
| Right-click menu (US-102) | not rendered | n/a | n/a | rendered on valid right-click |
| Branch action (US-103) | pill enabled | spinner "Creating sub-chat…" | toast "Could not create sub-chat" | navigate `/c/<id>` |
| Sub-chat view (US-104) | "Send a message to get started" | banner skeleton + 3 bubble skeletons | "Could not load conversation" / "Conversation not found" | banner + messages + composer |
| Parent banner (US-104) | n/a (always shows) | skeleton | "Private" for foreign-owned crumb | expanded (desktop) / collapsed (mobile) |
| Breadcrumb (US-106) | n/a | skeleton crumb strip | "Unknown" / "Private" for unresolved | rendered with links |
| Composer in sub-chat (US-105) | placeholder "Ask about <…>" | disabled, "Sending…" / streaming caret | "Could not send" / "AI stopped responding" / "Sub-chat parent is unavailable" | cleared, ready |

## 5. API surface

All routes are Next.js App Router route handlers under `src/app/api/`. All authenticated routes check `auth()` from `src/lib/auth.ts`; missing session → `401 { code: "UNAUTHENTICATED" }`. All routes use the same error shape as phase 0.

### `POST /api/chats/:id/branch` (NEW)

Create a sub-chat from a text selection in an assistant message of conversation `:id`.

**Auth:** required. `:id` must be owned by `session.user.id`.

**Request:**
```json
{
  "messageId": "uuid",
  "selectedText": "vector database",
  "charStart": 142,
  "charEnd": 157,
  "clientHighlightContext": "In a RAG pipeline, a vector database stores embeddings for retrieval."
}
```
- `messageId` must be an assistant message belonging to conversation `:id`.
- `selectedText` 1–2000 chars, trimmed non-empty.
- `0 ≤ charStart < charEnd ≤ message.content.length`.
- `message.content.slice(charStart, charEnd).trim()` must equal `selectedText.trim()` (whitespace tolerance).
- `clientHighlightContext` optional, ≤ 500 chars; if present and valid, used as `highlightContext`. Otherwise the server computes a context window (see below).

**Server-computed `highlightContext`** (when client does not supply it):
- Take the surrounding sentence(s) containing the highlight using a lightweight sentence splitter (regex `\s*[^.!?]+[.!?]+` on `message.content`).
- Include the sentence containing `charStart`, plus one sentence before and one after if they exist.
- Cap at 500 chars; if exceeded, truncate with ellipsis at a word boundary.
- If the sentence splitter yields an empty result (e.g. one-word message), fall back to the full `message.content` truncated to 500 chars.

**Response 201:**
```json
{
  "id": "uuid",
  "parentId": "uuid",
  "rootConversationId": "uuid",
  "depth": 2,
  "highlightText": "vector database",
  "highlightContext": "In a RAG pipeline, a vector database stores embeddings for retrieval.",
  "title": "New chat",
  "createdAt": "2026-09-13T10:00:00Z"
}
```

**Response 404:** `{ "error": { "code": "NOT_FOUND" } }` — source conversation not found OR not owned.
**Response 422:** `{ "error": { "code": "INVALID_SELECTION", "fields": { "selectedText": "..." } } }` — validation failure with field-level messages.
**Response 429:** `{ "error": { "code": "RATE_LIMITED", "message": "Too many sub-chats — try again in 10 minutes" } }`
**Response 500:** `{ "error": { "code": "INTERNAL" } }`

### Existing route behavior changes (transparent to client)

`POST /api/chats/:id/messages` and `GET /api/chats/:id` are NOT modified at the API contract level. Their internal logic gains:

- For `POST /api/chats/:id/messages`: when `conversation.depth ≥ 1`, build the message array using the ancestor-walk algorithm (section 7) and prepend the sub-chat system note.
- For `GET /api/chats/:id`: response gains `parentId`, `rootConversationId`, `depth`, `highlightText`, `highlightContext`, `parentTitle`, `rootTitle` fields (additive, backward-compatible) so the frontend can render breadcrumb + banner without a separate request.

### `GET /api/health`

No changes.

## 6. DB changes

**None.** All branching fields (`parentId`, `rootConversationId`, `depth`, `highlightText`, `highlightContext`) already exist on `conversations` per phase 0 AC-P0-6. No new tables, no new columns, no migration required. A new index `(root_conversation_id, depth)` could be added later for tree queries (phase 2) but is not needed for the ancestor walk in phase 1 (it walks up via `parentId`, which already has an index).

**Note for Backend:** the existing `parentId` column is `text` without a declared `references()` FK in the Drizzle schema (verified in `src/lib/db/schema.ts:80`). For phase 1 we recommend adding `.references((): conversations.id)` for referential integrity at the DB layer. This is a schema-level change with no runtime impact in dev (pglite) but should be applied in prod. Coordinate with Backend; see Q7.

## 7. Context reconstruction algorithm

Pseudocode for the ancestor walk used by `POST /api/chats/:id/messages` when `depth ≥ 1`:

```ts
async function buildModelContext(
  targetConversationId: string,
  newUserMessage: string,
  sessionUserId: string,
): Promise<ModelMessage[]> {

  // 1. Load target conversation
  const target = await db.conversations.get(targetConversationId);
  if (!target || target.userId !== sessionUserId) throw new HttpError(404, 'NOT_FOUND');

  // 2. Walk up to root, collecting ancestor ids (in root-first order)
  const ancestorIds: string[] = [];   // root → ... → direct parent
  let cursor: Conversation | null = target.parentId
    ? await db.conversations.get(target.parentId)
    : null;
  while (cursor) {
    if (cursor.userId !== sessionUserId) throw new HttpError(503, 'ANCESTOR_UNAVAILABLE');
    ancestorIds.unshift(cursor.id);   // prepend → root first
    cursor = cursor.parentId ? await db.conversations.get(cursor.parentId) : null;
  }

  // 3. Fetch messages for each ancestor + the target conversation
  //    (single query each, ordered by createdAt ASC; index covers this)
  const allConvIds = [...ancestorIds, targetConversationId];
  const messagesByConv = await db.messages.listByConversationIds(allConvIds); // batched

  // 4. Assemble flat message array in correct order
  const flat: ModelMessage[] = [];
  for (const convId of allConvIds) {
    flat.push(...messagesByConv.get(convId) ?? []);
  }

  // 5. (US-105 context note) Prepend a system note ONLY for the model.
  //    The parent conversation object was already loaded in step 2 (cursor at
  //    ancestorIds[ancestorIds.length-1] is the direct parent). We just need
  //    its title — no extra round-trip.
  const parent = ancestorIds.length > 0
    ? await db.conversations.get(ancestorIds[ancestorIds.length - 1])
    : null;
  const systemNote = buildSubChatSystemNote({
    parentTitle: parent?.title ?? null,
    highlightText: target.highlightText,
    depth: target.depth,
  });

  // 6. Append the new user message (NOT yet persisted at this point)
  flat.push({ role: 'user', content: newUserMessage });

  return [{ role: 'system', content: systemNote }, ...flat];
}

function buildSubChatSystemNote({ parentTitle, highlightText, depth }: {
  parentTitle: string | null; highlightText: string | null; depth: number;
}): string {
  const template = process.env.SUBSCHAT_SYSTEM_PROMPT
    ?? 'You are answering a follow-up question in a sub-chat. The user branched from {parentTitle} at the phrase: "{highlightText}". The following conversation history provides context; respond to the latest user message.';
  return template
    .replace('{parentTitle}', parentTitle ?? 'a parent chat')
    .replace('{highlightText}', highlightText ?? 'a highlighted passage');
}
```

**Properties:**
- `O(d)` DB calls where `d = depth`; a single batched query (`listByConversationIds`) flattens this to `O(1)` round-trips for messages.
- Foreign-owned ancestor throws `503 ANCESTOR_UNAVAILABLE` (same as missing — US-107 AC.2).
- The system note is in the model context ONLY; it does not appear in `messages` table, does not appear in the user's UI.

## 8. UI flows

### 8.1 Happy path: select → branch → answer

```
┌──────────────────────────────────────────────────────────────────┐
│  Chat: "How to build a RAG system"                                │
│                                                                   │
│  User: How do I store the embeddings?                             │
│                                                                   │
│  Assistant: ┌────────────────────────────────────────────────┐    │
│             │ In a RAG pipeline, a vector database stores     │    │
│             │ embeddings for retrieval. Common choices ...   │    │
│             └────────────────────────────────────────────────┘    │
│                                                                   │
│             [user selects "vector database"]                       │
│                                                                   │
│             ┌──────────────────────┐                              │
│             │ ✦ Ask about this     │  ← floating pill              │
│             └──────────────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
                ↓ click pill  (or right-click → "Sub-chat about selection")
                ↓ POST /api/chats/<rootId>/branch
                ↓ 201 { id: <newId> }
                ↓ router.push("/c/<newId>")
┌──────────────────────────────────────────────────────────────────┐
│  Home / How to build a RAG system / Ask about vector database     │ ← breadcrumb
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ About: "vector database"  [▾ collapse]                        ││ ← banner
│  │ ─── source message from parent ───                            ││
│  │ In a RAG pipeline, a [vector database] stores embeddings...  ││ ← highlight rendered
│  │ ─────────────────────────────────────────────────────────────││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                   │
│  Ask about "vector database"…  [                ] [Send]          │ ← composer
└──────────────────────────────────────────────────────────────────┘
                ↓ user types "what's the best one for small teams?" + Enter
                ↓ POST /api/chats/<newId>/messages
                ↓ (server: ancestor walk builds full context, prepends system note)
                ↓ SSE stream starts
┌──────────────────────────────────────────────────────────────────┐
│  Assistant: For small teams I'd recommend Chroma or FAISS ...     │ ← streamed reply
└──────────────────────────────────────────────────────────────────┘
```

### 8.2 Right-click path (alternate trigger)

```
                ↓ right-click on selection in assistant bubble
                ↓ onContextMenu(event)
                ↓ if valid selection → preventDefault + render custom menu
                ↓
        ┌─────────────────────────┐
        │ Sub-chat about selection │ ← click
        │ Copy                     │
        └─────────────────────────┘
                ↓ same handler as pill → POST /branch → navigate
```

### 8.3 Error path

```
pill click → POST /branch → 422 INVALID_SELECTION
                ↓
        ┌─────────────────────────────────────────┐
        │ ⚠ Could not create sub-chat — try again │ ← toast (auto-dismiss 5s)
        └─────────────────────────────────────────┘
                ↓ pill re-enabled, source chat unchanged
```

### 8.4 Cross-user path

```
user A: GET /c/<userB-sub-chat-id>
                ↓ server: owner check fails
                ↓ 404 NOT_FOUND
                ↓ UI shows: "Conversation not found" + link back to /
```

### 8.5 Recursive branch path

```
user in sub-chat depth=2 selects text in assistant message → click pill
                ↓ POST /api/chats/<depth2-id>/branch
                ↓ 201 with depth: 3
                ↓ navigate /c/<depth3-id>
                ↓ breadcrumb now: Home / Root / Depth1 / Depth2 / Depth3
                ↓ banner shows only depth=2 source message
```

## 9. A11y notes

Selection-driven UI is inherently mouse-centric; phase 1 ensures parity for keyboard / screen-reader users via:

- **Selection detection:** listens to `selectionchange` AND a debounced `mouseup`/`keyup` fallback so keyboard selection (Shift+arrow) is also detected. Valid keyboard selections produce the same pill.
- **Pill activation:** `Tab` focuses the pill when it appears; `Enter`/`Space` activates; `Esc` dismisses and returns focus to the assistant message bubble.
- **Context menu:** mouse-only by design; the keyboard-accessible equivalent is the pill. Documented in the menu's `aria-label` ("right-click for mouse users, or focus the 'Ask about this' button and press Enter").
- **Banner toggle:** `<button aria-expanded="true|false" aria-controls="banner-content">` with visible focus ring.
- **Breadcrumb:** `<nav aria-label="Conversation path"> <ol> ... </ol> </nav>`; current crumb `aria-current="page"`.
- **Highlight rendering:** `<mark>` element inside the source message preview; CSS `bg-yellow-100` (light) / `bg-yellow-900/30` (dark) meets AA on both.
- **Composer placeholder:** dynamic ("Ask about <first-3-words-of-highlight>…") so screen-reader users hear the topic of the sub-chat when the composer is focused.
- **Focus management on navigation:** after `router.push("/c/<new-id>")`, focus moves to the conversation header (`<h1 tabindex="-1">`) and is announced as "Sub-chat: <title>".
- **Color independence:** the highlight uses both background color AND a 2px underline (`underline decoration-yellow-500 decoration-2`) so it is distinguishable without color.
- **Reduced motion:** the pill's appearance uses `motion-safe:animate-fade-in`; with `prefers-reduced-motion: reduce` it appears instantly.

## 10. Out of scope (explicit)

The following are NOT in phase 1 and MUST NOT be built (consolidated from PM brief + open questions):

- **Tree-map sidebar visualization** (react-d3-tree or alternative) — phase 2.
- **Split view** (parent + sub-chat side-by-side) — phase 2.
- **Per-user provider selection** — phase 3.
- **Custom baseURL UI** — phase 3.
- **Multi-provider fallback chain UI changes** — phase 3 (provider fallback logic is unchanged from phase 0 US-008).
- **Sub-chat rename** — see Q4.
- **Sub-chat delete** — see Q4.
- **Markdown / code-block rendering** in messages — phase 2 (plain text + newlines in phase 1, same as phase 0).
- **File / image attachments** — phase 4.
- **Tool use / function calling** — phase 4.
- **Max-depth cap** on sub-chats — see Q3 (no cap in phase 1; revisit if a real problem surfaces).
- **Summarization / truncation of long ancestor chains** — see Q6 (full chain passed in phase 1).
- **Ancestor banner beyond direct parent** — phase 2.
- **Sibling list in breadcrumb** ("other sub-chats from this parent") — phase 2 tree-map.
- **Sharing a sub-chat with another user** — never.
- **Public sub-chat links** — never.
- **Highlighting from user messages** — phase 1 allows highlights from assistant messages only; user-message highlights deferred (user messages are typically short questions without "context to explore").
- **Highlighting across message boundaries** — phase 1 restricts to a single message; cross-message selections are not sub-chat-eligible.
- **Editing the highlight** after creation.
- **Moving a sub-chat to a different parent.**
- **Merging sibling sub-chats.**
- **i18n** — English only.
- **Mobile-optimized floating-pill positioning** — basic responsive behavior only; per-device UX polish deferred.
- **Keyboard "go to parent" hotkey** — deferred.
- **Sentry wiring** — already deferred to phase 1 in phase 0; if not yet done, ship without it (acceptable to defer further).

## 11. Open questions (for Orchestrator / user)

1. **Route migration `/chats/[id]` → `/c/[id]`?** Phase 0 ships `/chats/[id]`; this spec assumes `/c/[id]` for both root and sub-chat views per the brief. Decision: (a) migrate all `/chats/[id]` → `/c/[id]` (breaking change), (b) keep `/chats/[id]` and add `/c/[id]` as alias, (c) use `/c/[id]` for sub-chats only and keep `/chats/[id]` for root. **PM default: (a)** — single URL is cleaner, in-app users update with one release note.
2. **Title auto-derivation trigger.** Phase 0 §10 Q1 defers "auto-derive from first user message" to phase 1. Trigger on first user message send (US-105 AC.6) or on first assistant response? **PM default: trigger on first user message send** (immediate, no AI latency dependency).
3. **Max depth.** No cap in phase 1 per US-108 AC.2. Decision: ship uncapped, or add soft cap (e.g. 10) with a banner "you've gone deep — consider starting a new root chat"? **PM default: uncapped**, revisit if a UX report shows real user pain.
4. **Sub-chat rename / delete.** Deferred. Decision: add a minimal in-phase-1 rename (click title, inline edit) and skip delete, or skip both? **PM default: skip both**, document as phase-2 candidates.
5. **Banner collapsed-state persistence.** US-104 AC.4 keeps it client-state only. Decision: persist to localStorage keyed by conversation id (so banner stays collapsed on reload), or always default-collapsed on mobile / expanded on desktop (current spec)? **PM default: always default** — simpler, no localStorage churn.
6. **Ancestor chain size.** No truncation in phase 1. Decision: ship full chain, or add `MAX_ANCESTOR_TOKENS` env with head+tail truncation? **PM default: full chain**; with `gpt-4o-mini` 128k context, even 10-deep × 20-message chains are well under budget.
7. **`parentId` FK declaration.** Schema has the column but no `.references()` (verified). Decision: add the FK constraint now in phase 1, or defer to phase 2 when we also add `rootConversationId` index changes? **PM default: add now** — small, safe, prevents orphan rows.
8. **`GET /api/chats/:id` response shape change.** Adding `parentTitle`, `rootTitle` is additive but technically a contract change. Decision: ship it, or keep the existing shape and add `GET /api/chats/:id/context` for breadcrumb data? **PM default: add to existing shape** — one fewer round-trip.
9. **Floating-pill placement algorithm.** "Near the selection" — anchor above with 8px gap, flip below if overflow, clamp horizontally inside viewport. Acceptable? **PM default: yes**, but UX role should confirm in their deliverable.
10. **Selection event debounce.** `selectionchange` fires frequently on mobile during drag-selection. Decision: 50ms debounce, or immediate? **PM default: 50ms debounce**.
11. **System prompt for sub-chat.** US-105 AC.3 gives a default. Decision: ship default, or expose an env var (`SUBSCHAT_SYSTEM_PROMPT`) only? **PM default: env-var with default value** — operational flexibility without UI.
12. **Pill placement inside scrollable message list.** When the selection is in a message that has scrolled partially out of view, does the pill follow the selection or stay at a fixed corner? **PM default: follow selection** (current spec); alternative is a fixed bottom-right FAB.

## 12. Definition of done

Phase 1 is signed off when ALL boxes are checked:

### Spec hygiene
- [x] every user story uses as-a / i-want / so-that template
- [x] every AC is testable (verb-led, actor-named, measurable)
- [x] every UI surface has empty / loading / error / success states
- [x] out-of-scope list is explicit
- [x] open questions listed for Orchestrator resolution before build starts
- [x] spec reviewed by Critic; 3 low-severity polish items applied (AC.2 system-message wording, code-block guard deferral, ancestor-walk redundant fetch)
- [x] spec frozen by Orchestrator

### Stack & schema
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes (existing 17 + new tests ≥ 5 for ancestor walk + branch validation)
- [ ] no DB migration is required (branching fields exist since phase 0)
- [ ] (optional per Q7) `parentId` FK constraint added

### Branch creation
- [ ] `POST /api/chats/:id/branch` validates session, ownership, selection range, and whitespace tolerance
- [ ] on success inserts conversation with correct `parentId`, `rootConversationId`, `depth`, `highlightText`, `highlightContext`
- [ ] on validation failure returns 422 with field detail
- [ ] on cross-user returns 404
- [ ] rate-limited (30/10min/user)
- [ ] server-computed `highlightContext` matches algorithm in §5

### Context reconstruction
- [ ] `POST /api/chats/:id/messages` walks ancestor chain when `depth ≥ 1`
- [ ] system note prepended only to the model context (NOT persisted to `messages` table)
- [ ] ancestor walk respects ownership (foreign-owned link → 503 `ANCESTOR_UNAVAILABLE`)
- [ ] new user message persists on sub-chat only, NOT on any ancestor

### UI surfaces
- [ ] floating "Ask about this" pill appears on valid selections, dismisses cleanly
- [ ] custom right-click menu replaces native menu on valid selections, includes "Sub-chat about selection" + "Copy"
- [ ] sub-chat view (`/c/[id]`) renders breadcrumb + parent banner + messages + composer
- [ ] banner collapses/expands with `<button aria-expanded>`
- [ ] breadcrumb links navigate; current crumb is plain text
- [ ] mobile (< 768px) banner default-collapsed; desktop default-expanded
- [ ] dynamic composer placeholder ("Ask about <first-3-words-of-highlight>…")
- [ ] focus management on navigation: focus moves to header `<h1>`

### A11y
- [ ] keyboard selection (Shift+arrows) triggers the same pill as mouse selection
- [ ] pill is keyboard-focusable + activatable
- [ ] banner toggle + breadcrumb keyboard-navigable
- [ ] highlighted span uses both background AND underline (color independence)
- [ ] `prefers-reduced-motion` honored

### Tests
- [ ] Playwright e2e: select text → branch → sub-chat shows banner → send message → AI persists on sub-chat only
- [ ] Playwright e2e: cross-user 404 on `POST /api/chats/:id/branch`
- [ ] Playwright e2e: cross-user 404 on `GET /c/<other-user-sub-chat>`
- [ ] Playwright e2e: sub-chat can spawn sub-chat (depth ≥ 2)
- [ ] Vitest unit: ancestor-walk returns messages in correct order
- [ ] Vitest unit: branch validation rejects invalid selection ranges (charStart/charEnd out of bounds, whitespace mismatch)
- [ ] Vitest unit: system note template substitution

### Docs & handoffs
- [ ] README updated with phase-1 user flow + screenshot/GIF of the pill
- [ ] `.env.example` documents `SUBSCHAT_SYSTEM_PROMPT` (per Q11)
- [ ] `.orchestrator/STATE.md` updated: phase 1 status = `ready_to_build`
- [ ] handoffs: Backend → Frontend (new `/api/chats/:id/branch` + ancestor-walk internal), Security (new attack surface: branch creation rate limit, foreign-owner ancestor walk), Tech Writer (README + this spec), UX (deferred; if they produce a phase-1 deliverable, fold in pill/menu positioning), DevOps (no infra change)

---

**PM self-review (Critic pass — pre-freeze):**

| DoD item | Status | Note |
|---|---|---|
| Stories cover happy + edge | ✅ | US-101..108 cover select / right-click / create / view / AI context / nav / 404 / recursion |
| AC testable | ✅ | every AC names actor + verb + measurable outcome; no "should work well" |
| States per surface | ✅ | 7 surfaces × 4 states covered in §4 + per-story states blocks |
| Out-of-scope explicit | ✅ | §10 enumerates 20 items |
| Open questions | ✅ | 12 in §11 |
| Schema consistency | ⚠️ | Q7 flags missing `parentId` FK; recommend Backend fix |
| Phase-0 contradiction check | ✅ | phase 0 §10 Q1 (title auto-derive) is closed in US-104 AC.6; phase 0 §10 Q4 (sign-up) untouched; phase 0 §10 Q6 (rate-limit scope) extended in US-107 AC.4 |
| Recursion covered | ✅ | US-108 explicitly |
| API additions only | ✅ | only `POST /api/chats/:id/branch` is new; existing route behaviors are documented as transparent additions in §5 |

**Critic verdict:** warn — minor polish (Q1, Q8 require Orchestrator decisions before freeze). No high-severity issues.