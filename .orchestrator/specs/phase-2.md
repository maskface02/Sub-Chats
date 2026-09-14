# Phase 2 Spec — Tree-Map Visualization + Split View

**status:** frozen
**frozen_on:** 2026-09-13
**frozen_revision:** 2 (3 Reviewer fixes applied by Orchestrator + 6 open questions resolved)
**owner:** PM
**orchestrator_decisions_on_open_questions:** see `.orchestrator/decisions/phase-2-open-questions.md` (pending Critic review → freeze)
**owner:** PM
**builds_on:** `.orchestrator/specs/phase-1.md` (frozen rev 2)
**handoffs_required_from:** UX (`.orchestrator/specs/ux/phase-2.md` — component contracts for TreeMapSidebar, TreeNode, SplitView, SplitPane), Security (threat-model addendum: tree endpoint enumeration surface)
**locked_decisions:** tree-map lib = `@visx/hierarchy@^4.0.0`; split lib = `react-resizable-panels@^4.12.4` (both already in package.json — NO new deps)

---

## 1. Phase overview

Phase 2 ships the two navigation/visualization features deferred from phase 1 (phase 1 §10): a **tree-map sidebar** showing the full conversation tree of the current root (descendants included — phase 1's `ancestorTitles` only covers ancestors), and a **split view** letting the user open a second conversation side-by-side (primary use case: parent + sub-chat). Both are read-only navigation aids: no drag/rearrange, no rename/delete (still deferred, phase 1 Q4).

A new endpoint `GET /api/chats/:id/tree` returns the full subtree rooted at the current conversation's ROOT in one query (the `rootConversationId` index already exists — no DB change). The tree-map renders with `@visx/hierarchy` (d3-hierarchy layout) as a top-down tree with keyboard navigation per the WAI-ARIA tree pattern. Split view uses `react-resizable-panels` with independent chat panes — each pane runs its own messages, composer, and SSE stream. Markdown rendering — targeted at phase 1 by phase 0 (§9), moved to phase 2 by phase 1 (§10) — is explicitly re-deferred to phase 3 (it has slipped twice; it is NOT smuggled into this phase).

---

## 2. User stories

### US-201: Tree data endpoint

**as a** frontend developer building the tree-map sidebar
**i want** a single endpoint returning the full conversation subtree of the current root
**so that** the sidebar can render descendants, not just ancestors.

#### acceptance criteria
- [ ] AC.1: `GET /api/chats/:id/tree` requires a session (`401 { code: "UNAUTHENTICATED" }` otherwise) and returns the full subtree rooted at the ROOT of conversation `:id` (found via `rootConversationId` on the `:id` row — no ancestor walk needed).
- [ ] AC.2: success response is `200 { root, currentId, totalNodes, truncated }` where `root` is a node `{ id, title, depth, highlightText, createdAt, children: [...] }`, `children` ordered by `createdAt ASC`, `currentId` equals `:id`, `totalNodes` is the node count of the FULL subtree BEFORE truncation (pre-truncation total, so the UI can render "Showing 500 of <totalNodes>"), and `truncated` is a boolean.
- [ ] AC.3: the subtree is fetched with a SINGLE query on `(rootConversationId, userId)` — the existing `rootConversationId` index covers it — and assembled in memory; no per-node N+1 queries.
- [ ] AC.4: node cap: if the subtree contains more than 500 nodes, the server keeps the first 500 in DFS pre-order (parent before children, children in `createdAt ASC` order) and sets `truncated: true`; nodes beyond the cap are omitted entirely (no partial subtrees without their parent link).
- [ ] AC.5: if conversation `:id` does not exist OR is owned by another user, the endpoint returns `404 { code: "NOT_FOUND" }` — never `403` (id-enumeration guard, same as phase 1 US-107).
- [ ] AC.6: `highlightText` is `null` for nodes without a highlight (roots and sub-chats created without one); the field is always present in the JSON (no key omission).
- [ ] AC.7: `depth` on every node matches its stored `conversations.depth` relative to the root (root = 0).

#### states
- success: 200 with tree payload.
- error (401): no session.
- error (404): missing or foreign-owned conversation.
- error (500): `{ code: "INTERNAL" }`.

#### out of scope
- caching / ETag on the tree response.
- pagination within the tree (cap-and-truncate instead).
- returning multiple roots (forest view).

#### dependencies
- depends on: phase 1 schema (`rootConversationId`, `depth`, indexes — no migration)
- blocks: US-202, US-203, US-207

#### a11y notes
- n/a (API); error bodies follow the phase 0 error shape so screen-reader-visible UI errors render consistently.

---

### US-202: Tree-map sidebar (desktop + mobile drawer)

**as a** user with sub-chats
**i want** a sidebar showing the whole conversation tree of my current root chat
**so that** I can see all branches at a glance and jump between them.

#### acceptance criteria
- [ ] AC.1: the chat view renders a tree-map sidebar (side per OQ-1) showing the tree returned by `GET /api/chats/:id/tree`, laid out top-down with `@visx/hierarchy`: nodes = conversations, edges = parent-child links.
- [ ] AC.2: each node displays: title truncated to ~24 chars with ellipsis, a depth indicator (indentation + level badge for depth ≥ 2), a 📌 marker when `highlightText` is non-null, and a distinct "current" visual state when `node.id === currentId`.
- [ ] AC.3: the sidebar fetches the tree on mount and REFETCHES after any successful branch creation from any visible pane (a new sub-chat must appear without a manual reload).
- [ ] AC.4: on viewports ≥ 768px the sidebar is a persistent panel; on viewports < 768px it is a slide-over drawer opened from a header button ("Tree") and closed via backdrop click, `Esc`, or the close button.
- [ ] AC.5: the tree-map is read-only navigation — clicking a node navigates to `/c/<id>` (interaction detail in US-203); no node editing, dragging, or context menu exists.
- [ ] AC.6: if the response has `truncated: true`, the sidebar shows a static notice "Showing 500 of <totalNodes> conversations" at the bottom; navigation to truncated (omitted) nodes is not possible from the map.
- [ ] AC.7: sidebar width on desktop is resizable is NOT required — fixed width per UX contract (see §8); it must not push the chat content into horizontal scroll.
- [ ] AC.8: while in split view (US-205), the sidebar remains functional and reflects the tree of the root shared by both panes (both panes are always in the same tree — split is within one root's conversations, see US-205 AC.6).

#### states
- empty: root with no sub-chats → tree renders the single root node; no empty-state message needed (one node IS the content).
- loading: skeleton tree placeholder (root node + 2 stub children outlines) while the tree request is in flight; chat view remains interactive.
- error (network/5xx): sidebar shows "Could not load tree — Retry" with a retry button; chat view is unaffected.
- error (404): sidebar shows "Conversation not found" (defense-in-depth; primary 404 handling is the page-level one from phase 1).
- truncated: notice per AC.6.
- success: full tree rendered with current node highlighted.

#### out of scope
- drag/rearrange of nodes.
- search within the tree (phase 4 polish).
- multi-root forest view.
- pinch-zoom / mobile tree gestures.
- sidebar open/closed state persistence across reloads.

#### dependencies
- depends on: US-201
- blocks: US-203

#### a11y notes
- keyboard: drawer focus trap when open on mobile; `Esc` returns focus to the "Tree" header button.
- screen reader: drawer announced via `role="dialog" aria-label="Conversation tree"`; desktop sidebar is a landmark `aria-label="Conversation tree"`.
- contrast: node text, current-state highlight, and 📌 marker meet WCAG AA; the current state uses color + weight/border (not color alone).

---

### US-203: Tree-map interactions (click, hover, collapse/expand, keyboard nav)

**as a** user navigating a branching conversation
**i want** to click, hover, collapse, and keyboard-navigate tree nodes
**so that** I can move around the tree efficiently with mouse or keyboard.

#### acceptance criteria
- [ ] AC.1: clicking a node navigates to `/c/<node.id>` (client-side navigation, no full reload); the newly current node gains the "current" visual state.
- [ ] AC.2: hovering a node shows a tooltip with the FULL title and the created date (formatted per locale, e.g. "Sep 13, 2026") within 150ms; the tooltip disappears on mouse leave.
- [ ] AC.3: nodes with children show a collapse/expand toggle (chevron); clicking it toggles the subtree visibility with client-side state only (not persisted across reloads); the current conversation's ancestor path is always expanded on initial render.
- [ ] AC.4: keyboard — the tree implements the WAI-ARIA tree pattern: container has `role="tree"`; each node `role="treeitem"` with `aria-level`, `aria-setsize`, `aria-posinset`, and `aria-expanded` (only when children exist); exactly one node is in the tab order at a time (roving tabindex).
- [ ] AC.5: keyboard — `ArrowDown`/`ArrowUp` move focus to the next/previous VISIBLE node in flattened DFS order; `ArrowRight` expands a collapsed node (or moves to its first child if already expanded); `ArrowLeft` collapses an expanded node (or moves focus to its parent if collapsed/leaf); `Home`/`End` move to first/last visible node.
- [ ] AC.6: keyboard — `Enter` (and `Space`) on a focused node navigates to that conversation, identical to a mouse click.
- [ ] AC.7: the node for the current conversation has `aria-current="true"`; focus and "current" are independent (a user can focus node X while current is node Y).
- [ ] AC.8: after navigating via tree click or `Enter`, focus moves to the target view's `<h1>` (same pattern as phase 1 §9 focus management).

#### states
- empty: n/a (US-202 covers the single-node case).
- loading: covered by US-202.
- error: covered by US-202; interactions are inert until the tree loads.
- success: all interactions functional.

#### out of scope
- multi-select of nodes.
- drag to re-parent.
- keyboard shortcuts beyond the tree pattern (e.g. global "go to parent" hotkey — still deferred from phase 1 §10).
- typeahead search within the tree.

#### dependencies
- depends on: US-202
- blocks: nothing

#### a11y notes
- keyboard: fully specified in AC.4–AC.6 — this is the phase's hardest a11y item; QA tests each key individually.
- screen reader: node announcement is "<title>, level <n>, <position> of <setsize>, <collapsed/expanded>, <current conversation>" via the ARIA attributes in AC.4/AC.7; the 📌 marker has `aria-label="branched from a highlight"` (not read as an emoji).
- contrast: focus ring meets WCAG AA (3:1 non-text) on both themes.

---

### US-204: Open split view

**as a** user comparing a parent chat with its sub-chat
**i want** to open a second conversation side-by-side with the current one
**so that** I can read the source context while working in the branch.

#### acceptance criteria
- [ ] AC.1: the chat header shows a "Split" button on viewports ≥ 768px; the button is hidden on mobile (split view is desktop-only).
- [ ] AC.2: clicking "Split" opens a picker listing the conversations of the current tree (data from the already-fetched tree, no extra request); if the current conversation has a parent, the picker PRESELECTS the parent.
- [ ] AC.3: selecting a conversation from the picker opens the split view: two panes side-by-side (left = current conversation, right = picked conversation) rendered with `react-resizable-panels`, default 50/50, horizontal orientation.
- [ ] AC.4: each pane renders an independent chat view: own message list, own parent-context banner (if a sub-chat), own breadcrumb, own composer, own SSE stream — no shared mutable state between panes (the phase 1 SSE client must be instance-scoped, no module-level stream state).
- [ ] AC.5: the split is client-state only: the URL stays `/c/<currentId>`; the right pane's id is NOT in the URL; reloading the page returns to single view (persistence explicitly out of scope).
- [ ] AC.6: the picker only lists conversations within the current root's tree (both panes always share one root, keeping US-202 AC.8 coherent); picking a conversation from a different root is impossible by construction.
- [ ] AC.7: both panes load independently — a 404/error in one pane does NOT unmount or break the other pane.

#### states
- idle: "Split" button visible.
- loading (picker): picker opens instantly from cached tree data; if tree data is still loading, picker shows a spinner.
- loading (pane): each pane shows its own phase 1 loading skeleton.
- error: per-pane (phase 1 states apply inside each pane); picker error = tree error state from US-202.
- success: two panes rendering, both composers usable.

#### out of scope
- more than 2 panes.
- persisting split layout across reloads.
- splitting with a conversation from another root.
- split view on mobile (< 768px).
- **Message edit / regenerate / delete** — deferred to phase 2 by phase 0 (§9); re-deferred here to phase 3 (kept out of this phase to protect the tree-map/split scope).
- **Optimistic message rendering** — deferred to phase 2 by phase 0 (§9); re-deferred here to phase 3.

#### dependencies
- depends on: US-201 (tree data for picker), phase 1 ChatView
- blocks: US-205, US-206

#### a11y notes
- keyboard: "Split" button and picker items are keyboard-operable (`Tab` + `Enter`); picker has `role="dialog"` with focus trap and `Esc` to cancel.
- screen reader: picker announced as "Choose conversation for second pane"; panes announced per US-205.
- contrast: picker and button meet WCAG AA.

---

### US-205: Interact in split view

**as a** user working in split view
**i want** each pane to behave as a fully independent chat and to resize/reorient the split
**so that** I can read and write in both conversations without interference.

#### acceptance criteria
- [ ] AC.1: sending a message in either pane streams that pane's response only; the other pane's message list is untouched during and after the stream.
- [ ] AC.2: both panes can stream SIMULTANEOUSLY (two concurrent SSE streams) without token interleaving, dropped chunks, or state crosstalk.
- [ ] AC.3: dragging the divider resizes the panes (min pane width 25% of the split area, enforced by `react-resizable-panels`); the divider is keyboard-operable: focus it with `Tab`, adjust with `ArrowLeft`/`ArrowRight` (or `ArrowUp`/`ArrowDown` in vertical mode) in ≤ 5% steps.
- [ ] AC.4: a "Toggle orientation" control switches the split between horizontal (side-by-side) and vertical (stacked); the toggle is client-state only.
- [ ] AC.5: SelectionMenu, parent-context banner, and breadcrumb work independently inside EACH pane (creating a sub-chat from pane B works and triggers the US-202 AC.3 tree refetch).
- [ ] AC.6: navigating via the tree-map while in split view updates the pane that currently holds keyboard/mouse focus ("active pane" — visually indicated), instead of collapsing the split; if the picked node is already open in one pane, that pane becomes active (no duplicate of the same conversation in both panes).
- [ ] AC.7: scroll position of each pane is independent (scrolling pane A does not move pane B).

#### states
- per-pane: identical to the phase 1 chat-view states (empty / loading / streaming / error), evaluated independently.
- error (stream in pane A): phase 1 inline stream error renders in pane A only; pane B unaffected.
- success: both panes fully interactive.

#### out of scope
- synchronized scrolling between panes.
- swapping pane positions (left↔right) — close and reopen instead.
- broadcasting the same message to both panes.

#### dependencies
- depends on: US-204
- blocks: US-206

#### a11y notes
- keyboard: `Tab` order flows pane 1 content → divider → pane 2 content; the divider is `role="separator"` with `aria-orientation` and an `aria-label` ("Resize panes") announcing the current split ratio on focus.
- screen reader: each pane is `role="region"` with `aria-label="Chat: <title>"`; entering a pane is perceivable via the region label.
- contrast: divider and active-pane indicator meet WCAG AA; active-pane indication uses border + label, not color alone.

---

### US-206: Close split view

**as a** user finished comparing two conversations
**i want** to close one pane and return to single view
**so that** I get my full screen back.

#### acceptance criteria
- [ ] AC.1: each pane has a close ("×") button in its header; clicking it removes that pane and the remaining pane expands to full width within 200ms.
- [ ] AC.2: closing a pane that is mid-stream aborts that pane's SSE stream client-side (no orphaned stream continues writing to a removed pane).
- [ ] AC.3: closing the pane holding the CURRENT conversation (`/c/<currentId>` matches the closed pane's id) leaves the remaining pane's conversation as the viewed one — the URL updates to `/c/<remaining-id>` via client navigation.
- [ ] AC.4: closing either pane returns to the exact single-view state (sidebar, banner, breadcrumb behave as in phase 1 / US-202).
- [ ] AC.5: drafts typed in a closed pane's composer are discarded without a confirmation prompt (draft persistence is out of scope); a draft in the SURVIVING pane is preserved.

#### states
- idle: close buttons visible on both pane headers.
- loading: n/a (instant client-side transition).
- error: n/a (abort is best-effort; a failed abort must not crash the surviving pane).
- success: single view restored.

#### out of scope
- "close all" / restore-closed-pane history.
- confirmation dialog before discarding a draft.

#### dependencies
- depends on: US-204
- blocks: nothing

#### a11y notes
- keyboard: close button focusable, `Enter`/`Space` activates; after closing, focus moves to the surviving pane's `<h1>`.
- screen reader: close button `aria-label="Close pane: <conversation title>"`.
- contrast: close button meets WCAG AA in both pane header themes.

---

### US-207: Cross-user tree access is denied (404)

**as a** security-minded user
**i want** no other user to enumerate or read my conversation tree
**so that** the tree map does not become a metadata leak.

#### acceptance criteria
- [ ] AC.1: `GET /api/chats/:id/tree` checks `session.user.id === conversation.userId` on the `:id` row and returns `404 { code: "NOT_FOUND" }` on mismatch — identical handling for missing and foreign-owned ids.
- [ ] AC.2: the subtree query filters `WHERE rootConversationId = <root> AND userId = <session>` — even if ownership data were inconsistent, foreign-owned nodes cannot enter the response.
- [ ] AC.3: a foreign-owned `:id` and a nonexistent `:id` produce byte-identical 404 responses and response times within 50ms of each other (no existence oracle).
- [ ] AC.4: the tree response contains no user ids, emails, or any fields beyond those specified in US-201 AC.2 (minimal payload).

#### states
- error (404): page-level "Conversation not found" (phase 1 pattern); the sidebar never renders foreign data.

#### out of scope
- sharing trees between users (never).
- public tree links (never).

#### dependencies
- depends on: US-201
- blocks: nothing

#### a11y notes
- 404 UI text meets WCAG AA (phase 1 pattern reused).

---

### US-208: Keyboard & screen-reader parity for phase 2 surfaces

**as a** keyboard-only or screen-reader user
**i want** the tree-map and split view to be fully operable without a mouse
**so that** the new navigation features don't exclude me.

#### acceptance criteria
- [ ] AC.1: every phase 2 interaction is completable with keyboard only: open/close the drawer (US-202), navigate + activate tree nodes (US-203), open split via picker (US-204), resize + reorient (US-205), close a pane (US-206).
- [ ] AC.2: no keyboard trap exists outside the mobile drawer's intentional focus trap (which `Esc` releases); `Tab` order is: header → sidebar/drawer → pane 1 → divider → pane 2 (in split mode).
- [ ] AC.3: all phase 2 loading/error states are announced: tree loading via `aria-busy="true"` on the sidebar container; tree error and truncated notices via `role="status"`.
- [ ] AC.4: `prefers-reduced-motion: reduce` disables the drawer slide, node expand/collapse animation, and pane transition animations (elements appear/disappear instantly).
- [ ] AC.5: the 📌 highlight marker, current-node state, and active-pane state are each conveyed by a non-color cue (icon/text/weight) so they are distinguishable without color perception.

#### states
- all states per underlying surface; this story is a cross-cutting guarantee, verified by QA as a checklist.

#### out of scope
- voice-control / switch-access testing beyond standard ARIA semantics.

#### dependencies
- depends on: US-202, US-203, US-204, US-205, US-206
- blocks: nothing

#### a11y notes
- this story IS the a11y consolidation; per-story a11y notes remain authoritative for implementation detail.

---

## 3. Acceptance criteria (consolidated, phase-level)

Phase 2 is done when ALL of these pass:

- [ ] **AC-P2-1:** `GET /api/chats/:id/tree` returns the full subtree of the current root in one query, with the exact shape in US-201 AC.2 (US-201).
- [ ] **AC-P2-2:** trees > 500 nodes are truncated DFS pre-order with `truncated: true` and a visible sidebar notice (US-201 AC.4, US-202 AC.6).
- [ ] **AC-P2-3:** the tree-map sidebar renders the tree top-down with title/depth/📌/current visuals and refetches after branch creation (US-202).
- [ ] **AC-P2-4:** on mobile the sidebar is a slide-over drawer with backdrop + `Esc` close (US-202 AC.4).
- [ ] **AC-P2-5:** tree click navigates; hover shows title + created date; collapse/expand works with the current ancestor path initially expanded (US-203 AC.1–3).
- [ ] **AC-P2-6:** the tree implements the WAI-ARIA tree pattern with roving tabindex and the full arrow-key semantics of US-203 AC.4–6 (US-203, US-208).
- [ ] **AC-P2-7:** split view opens via header button + picker (parent preselected), two independent panes, client-state only, desktop-only (US-204).
- [ ] AC-P2-8: both panes stream simultaneously without crosstalk; per-pane errors are isolated (US-205 AC.1–2, AC.7 / US-204 AC.7).
- [ ] AC-P2-9: the divider is mouse- AND keyboard-resizable; orientation toggle works (US-205 AC.3–4).
- [ ] AC-P2-10: closing a pane aborts its stream, restores single view, and updates the URL if the current conversation's pane was closed (US-206).
- [ ] AC-P2-11: cross-user tree access returns 404 indistinguishable from missing; the subtree query filters on userId (US-207).
- [ ] AC-P2-12: every phase 2 surface (sidebar, drawer, node, tooltip, picker, divider, panes) has empty / loading / error / success states implemented per §4.
- [ ] AC-P2-13: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` pass with zero errors; new unit tests cover tree assembly (ordering, cap, truncation flag) and ownership filtering.
- [ ] AC-P2-14: Playwright e2e covers: branch → tree refetch shows new node → click node navigates; open split → send in both panes → close pane.
- [ ] AC-P2-15: Playwright e2e covers: cross-user 404 on `GET /api/chats/:id/tree`.
- [ ] AC-P2-16: no DB migration is required (phase 1 indexes sufficient).

## 4. States (consolidated matrix)

| Surface | Empty | Loading | Error | Success |
|---|---|---|---|---|
| Tree endpoint (US-201) | n/a (root always exists if 200) | n/a | 401 / 404 / 500 bodies | 200 payload |
| TreeMapSidebar (US-202) | single root node renders | skeleton tree placeholder | "Could not load tree — Retry" / "Conversation not found" | tree + current highlight (+ truncated notice if applicable) |
| TreeNode + tooltip (US-203) | n/a | n/a | n/a | hover tooltip ≤ 150ms; click navigates |
| Mobile drawer (US-202) | same as sidebar | same as sidebar | same as sidebar | slide-over with backdrop |
| Split button + picker (US-204) | picker lists ≥ 1 item (current tree always has the current conv) | spinner if tree not yet loaded | inherits tree error state | split opens 50/50 |
| SplitPane (US-204/205) | pane's own empty state (phase 1) | pane's own skeleton | per-pane isolated errors | independent streaming |
| Divider (US-205) | n/a | n/a | n/a | resize 25%–75% clamp |
| Pane close (US-206) | n/a | n/a | n/a | single view restored ≤ 200ms |

## 5. API surface

All routes under `src/app/api/`, error shape per phase 0, `auth()` required unless stated.

### `GET /api/chats/:id/tree` (NEW)

**Auth:** required → `401 { code: "UNAUTHENTICATED" }`.

**Logic:**
1. Load conversation `:id`; missing or `userId !== session.user.id` → `404 { code: "NOT_FOUND" }` (identical body/timing for both — US-207 AC.3).
2. Resolve `rootId = conversation.rootConversationId ?? conversation.id`.
3. Single query: `SELECT id, title, depth, parentId, highlightText, createdAt FROM conversations WHERE rootConversationId = <rootId> AND userId = <session.user.id> ORDER BY createdAt ASC` (existing index on `rootConversationId`).
4. Assemble tree in memory (map parentId → children). Root node = the row with `id === rootId`.
5. If node count > 500: keep first 500 in DFS pre-order (children in `createdAt ASC`), set `truncated: true`. `totalNodes` = count of the FULL subtree BEFORE truncation (pre-truncation total).

**Response 200:**
```json
{
  "root": {
    "id": "uuid",
    "title": "How to build a RAG system",
    "depth": 0,
    "highlightText": null,
    "createdAt": "2026-09-13T10:00:00Z",
    "children": [
      {
        "id": "uuid",
        "title": "Ask about vector database",
        "depth": 1,
        "highlightText": "vector database",
        "createdAt": "2026-09-13T10:05:00Z",
        "children": []
      }
    ]
  },
  "currentId": "uuid-of-requested-conversation",
  "totalNodes": 2,
  "truncated": false
}
```

**Error responses:** `401 UNAUTHENTICATED` · `404 NOT_FOUND` · `500 INTERNAL`. No other status codes (no 422 — path param validated as UUID → 404 on parse failure per phase 0 convention).

**Note:** `createdAt` is included per node beyond the brief's minimal shape — the hover tooltip (US-203 AC.2) requires it; flagged as OQ-3 for confirmation.

### Existing routes

No contract changes. `GET /api/chats/:id` (with phase 1's `ancestorTitles`) is unchanged; the tree endpoint is additive and does not replace it.

## 6. DB changes

**None.** `conversations` already has `parentId`, `rootConversationId`, `depth`, `highlightText`, and indexes on `parentId` and `rootConversationId` (phase 0/1). The subtree query is fully covered by the `rootConversationId` index. No migration, no new table, no new column.

## 7. UI flows

### 7.1 Tree-map sidebar (desktop)

```
┌──────────────┬──────────────────────────────────────────────┐
│ TREE         │  Home / RAG system / Ask about vector DB     │
│              │──────────────────────────────────────────────│
│  [RAG system]│  ┌────────────────────────────────────────┐  │
│      │       │  │ About: "vector database"  [▾]          │  │
│   📌[Ask about│  │ ...source message with highlight...    │  │
│      │    vDB]│  └────────────────────────────────────────┘  │
│      │       │                                              │
│  📌[Chroma vs │  User: what's the best one for small teams? │
│      FAISS]  │                                              │
│              │  Assistant: For small teams I'd recommend…   │
│ (current =   │                                              │
│  bold border)│  [ composer.......................... ][Send]│
└──────────────┴──────────────────────────────────────────────┘
     ↑ click 📌[Chroma vs FAISS] → navigate /c/<id>
```

### 7.2 Split view

```
┌─────────────────────────┬─────────────────────────┐
│ Home / RAG / Ask about… │ Home / RAG / Chroma vs… │   ← breadcrumb per pane
│─────────────────────────│─────────────────────────│
│ [pane A: parent chat]   │ [pane B: sub-chat]      │
│                         │                         │
│ User: How do I store…   │ About: "vector database"│
│ Assistant: A vector DB… │ User: chroma or faiss?  │
│                         │ Assistant: For small…   │
│                         │                    [×]  │   ← close per pane
│ [composer A......][Send]│ [composer B.....][Send] │
├─────────────────────────┴─────────────────────────┤
│              ◄──────────►  [⇅ toggle orientation] │   ← draggable/keyboard divider
└───────────────────────────────────────────────────┘
```

### 7.3 Mobile drawer (< 768px)

```
        ┌───────────────────────────┐
        │ Chat view (full width)    │
        │                  [Tree]   │  ← header button
        │                           │
        │  messages…                │
        │                           │
        └───────────────────────────┘
                     ↓ tap [Tree]
┌─────────┬─────────────────────────┐
│ TREE    │ ░░ backdrop (dimmed) ░░ │
│ (slide- │                         │
│  over)  │   chat content behind   │
│  tree…  │                         │
│  [×]    │                         │
└─────────┴─────────────────────────┘
  ↑ Esc / backdrop tap / [×] closes
```

## 8. Component contracts summary (detail owned by UX)

UX produces `.orchestrator/specs/ux/phase-2.md` with full visual + behavioral contracts for:

| Component | Owns (PM-level contract) | UX details |
|---|---|---|
| `TreeMapSidebar` | data fetch + refetch triggers, states, drawer-vs-panel breakpoint, truncated notice | layout, width, spacing, side (per OQ-1), animations |
| `TreeNode` | title truncation, depth indicator, 📌 marker, current state, tooltip trigger content | node visual design, tooltip styling, chevron affordance |
| `SplitView` | pane composition, orientation toggle, picker entry point, active-pane tracking | divider visual, toggle placement, picker design |
| `SplitPane` | independent ChatView embedding, close button, per-pane state isolation | pane header chrome, close affordance |

**Coordination rule:** UX owns visuals/spacing/motion; this spec owns behavior, states, a11y semantics, and data flow. Conflicts resolve via open questions to Orchestrator. The `@visx/hierarchy` and `react-resizable-panels` library choices are LOCKED and not UX's to change.

## 9. A11y notes (keyboard tree navigation — the hard part)

The tree-map is the phase's principal a11y risk. Requirements, normative:

- **Semantics:** `role="tree"` container; `role="treeitem"` per node; nested `role="group"` per subtree; `aria-level`, `aria-setsize`, `aria-posinset` on every item; `aria-expanded` only on nodes WITH children; `aria-current="true"` on the current conversation's node.
- **Roving tabindex:** exactly one treeitem has `tabindex="0"` (the focused node, initialized to the current conversation's node); all others `tabindex="-1"`. `Tab` into the tree lands on the roving node; `Tab` out exits to the next page element.
- **Key map (WAI-ARIA tree pattern, verified against APG):**
  - `ArrowDown` / `ArrowUp`: focus next / previous VISIBLE node (flattened DFS, skipping collapsed subtrees)
  - `ArrowRight`: collapsed node with children → expand, keep focus; expanded node → move to first child; leaf → no-op
  - `ArrowLeft`: expanded node → collapse, keep focus; collapsed node or leaf with parent → move to parent
  - `Home` / `End`: first / last visible node
  - `Enter` / `Space`: activate = navigate to `/c/<id>`
  - `Esc` (drawer only): close drawer, restore focus to the "Tree" button
- **Focus ≠ current:** focusing a node never navigates; navigation happens ONLY on `Enter`/`Space`/click. Screen-reader users can browse the tree without triggering navigation.
- **Announcements:** node = "<title>, level <n>, <i> of <n>, collapsed|expanded|leaf" (from ARIA attrs); 📌 = `aria-label="branched from a highlight"`; current node additionally announced via `aria-current`.
- **Split view:** divider = `role="separator"` + `aria-orientation` + `aria-label="Resize panes"`, arrow keys step ≤ 5%, ratio announced on focus; panes = `role="region"` `aria-label="Chat: <title>"`; `Tab` order pane1 → divider → pane2; no focus trap outside the mobile drawer.
- **Motion:** `prefers-reduced-motion` kills drawer slide, expand/collapse animation, pane transitions (US-208 AC.4).
- **Color independence:** current node, 📌, active pane all have non-color cues (US-208 AC.5).

## 10. Out of scope (explicit)

The following are NOT in phase 2 and MUST NOT be built:

- **Tree-map drag/rearrange** — read-only navigation only.
- **Multi-root forest view** — only the current root's tree.
- **Search within the tree-map** — phase 4 polish.
- **Persisting split layout across reloads** — client-state only.
- **More than 2 panes.**
- **Sibling dropdown in breadcrumb** — the tree-map covers this need.
- **Ancestor banner beyond direct parent** — remains deferred from phase 1 §10.
- **Markdown / code-block rendering** — explicitly re-deferred to **phase 3** (slipped from phase 0 → 1 → 2; it is NOT absorbed into this phase).
- **Mobile-optimized tree-map gestures** (pinch zoom etc.).
- **Split view on mobile (< 768px).**
- **Sub-chat rename / delete** — still deferred (phase 1 Q4).
- **Tree response caching / ETag.**
- **Sidebar state persistence** (open/closed, expanded nodes) across reloads.
- **Per-user provider selection / custom baseURL UI** — phase 3 (unchanged from phase 1 §10).
- **File/image attachments, tool use** — phase 4 (unchanged).
- **Sharing sub-chats / public links** — never.

## 11. Open questions (for Orchestrator / user)

1. **Sidebar side (OQ-1).** Tree-map sidebar on the left or right? User-selectable toggle, or fixed? **PM default: fixed LEFT** (matches typical file-explorer mental model); a toggle is cheap to add later if UX reports demand.
2. **Tree-map navigation during split view (OQ-2).** US-205 AC.6 specs "tree click updates the active pane". Alternative: tree click always updates the LEFT pane regardless of focus. **PM default: active-pane** (matches user intent); QA must test focus tracking.
3. **`createdAt` in tree node shape (OQ-3).** The brief's node shape omitted it but US-203 AC.2's tooltip needs the created date. **PM default: add `createdAt`** to the node shape (documented in §5). Confirm or drop the tooltip date.
4. **Node cap value + behavior (OQ-4).** 500 nodes, DFS pre-order truncate + `truncated: true` flag (US-201 AC.4). Alternatives: (a) reject with 413, (b) lazy-load subtrees on expand. **PM default: 500 + truncate** — simplest, no incremental fetch machinery; revisit only if a real user hits the cap.
5. **Split picker scope (OQ-5).** US-204 AC.2 specs a picker over the current tree with parent preselected. Alternative: zero-click "split with parent" shortcut button when a parent exists, picker as fallback. **PM default: picker only** in phase 2 (one entry point to test); the shortcut is a cheap phase 3 add.
6. **Tree refetch trigger breadth (OQ-6).** US-202 AC.3 specs refetch after branch creation. Should it ALSO refetch on window focus / after pane-close (title may have auto-derived)? **PM default: branch-creation only** in phase 2; stale titles in the map are acceptable until the next refetch.

## 12. Definition of done

Phase 2 is signed off when ALL boxes are checked:

### Spec hygiene
- [ ] every user story uses as-a / i-want / so-that template
- [ ] every AC is testable (verb-led, actor-named, measurable)
- [ ] every UI surface has empty / loading / error / success states (§4 matrix)
- [ ] out-of-scope list explicit (§10, 16 items)
- [ ] open questions listed for Orchestrator resolution before build starts (§11, 6 items)
- [ ] spec reviewed by Critic; issues resolved
- [ ] spec frozen by Orchestrator; UX contract file (`.orchestrator/specs/ux/phase-2.md`) delivered or explicitly scheduled

### Stack & schema
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test` pass with zero errors
- [ ] NO new dependencies added (`@visx/hierarchy` + `react-resizable-panels` already present)
- [ ] no DB migration required

### Tree endpoint
- [ ] `GET /api/chats/:id/tree` returns the §5 shape with `children` in `createdAt ASC` order
- [ ] single indexed query (no N+1) — verified by test or query log
- [ ] 500-node cap truncates DFS pre-order with `truncated: true` + `totalNodes`
- [ ] cross-user → 404 byte-identical to missing-id 404 (US-207 AC.3)

### Tree-map sidebar
- [ ] top-down `@visx/hierarchy` tree with title/depth/📌/current visuals
- [ ] refetch after branch creation (US-202 AC.3)
- [ ] truncated notice when applicable (US-202 AC.6)
- [ ] desktop panel / mobile drawer at the 768px breakpoint
- [ ] hover tooltip: full title + created date ≤ 150ms
- [ ] collapse/expand with current ancestor path initially expanded
- [ ] full WAI-ARIA tree pattern: roles, aria-level/setsize/posinset/expanded/current, roving tabindex
- [ ] arrow-key semantics per §9 key map (each key individually QA-tested)

### Split view
- [ ] "Split" button (≥ 768px) → picker (parent preselected) → two independent panes
- [ ] concurrent SSE streams without crosstalk (US-205 AC.2 — dedicated test)
- [ ] divider mouse + keyboard resize, 25% min clamp, orientation toggle
- [ ] per-pane isolation: banner, breadcrumb, SelectionMenu, errors, scroll (US-205)
- [ ] close pane aborts its stream; URL updates when current pane closed (US-206)
- [ ] split is client-state only; reload returns to single view

### A11y
- [ ] all US-208 ACs pass as a QA checklist
- [ ] `prefers-reduced-motion` honored on drawer, tree animations, pane transitions
- [ ] focus management: post-navigation focus on `<h1>`; drawer `Esc` restore; pane-close focus restore

### Tests
- [ ] Vitest unit: tree assembly (ordering, cap, truncation flag, ownership filter)
- [ ] Vitest unit: cross-user 404 parity on tree endpoint
- [ ] Playwright e2e: branch → tree refetch shows new node → node click navigates
- [ ] Playwright e2e: keyboard tree nav (arrows + Enter) reaches and opens a sub-chat
- [ ] Playwright e2e: open split → send in both panes concurrently → close pane
- [ ] Playwright e2e: cross-user 404 on `GET /api/chats/:id/tree`

### Docs & handoffs
- [ ] README updated (tree-map + split view sections)
- [ ] endpoints doc updated with `GET /api/chats/:id/tree`
- [ ] `.orchestrator/STATE.md` updated: phase 2 status = `ready_to_build`
- [ ] handoffs: UX (`.orchestrator/specs/ux/phase-2.md`), Security (tree-endpoint threat addendum), Backend → Frontend (tree API handoff), Tech Writer

---

**PM self-review (Critic pass — pre-freeze):**

| DoD item | Status | Note |
|---|---|---|
| Stories cover happy + edge | ✅ | US-201..208: endpoint, sidebar, interactions, split open/interact/close, 404, a11y |
| AC testable | ✅ | every AC names actor + verb + measurable outcome |
| States per surface | ✅ | §4 matrix: 8 surfaces × 4 states |
| Out-of-scope explicit | ✅ | §10: 16 items; markdown re-deferred to phase 3 explicitly |
| Open questions | ✅ | §11: 6 items, each with PM default |
| Phase-1 contradiction check | ✅ | builds on frozen phase 1; no contract changes to existing routes; breadcrumb sibling dropdown moved to tree-map as planned |
| Locked libs honored | ✅ | @visx/hierarchy + react-resizable-panels; zero new deps |
| A11y risk flagged | ✅ | §9 is normative; US-203 AC.4–8 + US-208 are the QA surface |
| Schema changes | ✅ | none (§6) |

**Critic verdict:** pending independent review.
