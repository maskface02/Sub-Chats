# Handoff — Tech Writer, phase 2 (tree-map + split view docs)

## Status
Complete. Docs updated against the phase 2 spec (`.orchestrator/specs/phase-2.md`, frozen rev 2) as-built surface. No code touched.

## Files updated
- `README.md` — Features list gains tree-map sidebar + split view; new short "Navigation" section (breadcrumb / tree-map / split); tech-stack bullets corrected from `react-d3-tree` to the locked `@visx/hierarchy` + `react-resizable-panels`; roadmap phase 2 entry marked shipped with regenerate deferred to phase 3.
- `docs/getting-started.md` — new "Navigate your conversation tree" section after the branching walkthrough: sidebar/drawer usage, node click navigation, auto-refetch on new sub-chat, split open (picker, parent preselected) / resize / orientation toggle / pane close.
- `docs/architecture.md` — new "Tree data model (phase 2)" section: `parentId` tree + single-query subtree fetch via `rootConversationId`, `GET /api/chats/:id/tree` semantics (single indexed query, 500-node DFS pre-order cap, `truncated` + pre-truncation `totalNodes`, cross-user 404 parity), split view = client-state only (Zustand, no URL persistence, same-root guarantee), ASCII depth-2 tree diagram.
- `docs/api/endpoints.md` — new `GET /api/chats/:id/tree` entry: auth/ownership table, recursive `TreeNodeDto` (with `createdAt`, present-field `highlightText`), `TreeResponse`, 500-node truncation behaviour, error codes 401/404/500 (404 identical for missing and foreign ids), curl + full JSON example. "See also" now links the phase 2 spec and this handoff.

## Not in scope this round
- Screenshots (README under 15-line cap and hands-off-the-UI stance kept additions in prose).
- Markdown rendering docs — re-deferred from phase 2 to phase 3 by spec §10; not documented now.

## Open issues
1. Screenshots TBD — README "Screenshots" section and the walkthroughs all say prose-only; UX to supply captures of: desktop sidebar with current-node highlight, mobile drawer, split view both orientations, truncated-tree notice.
2. `docs/architecture.md` header still says "at the end of phase 0" — wording kept to limit blast radius; next sweep should re-cut it per phase.
3. Sidebar side (left, per OQ-1 PM default) assumed in prose; if UX ships a different side, one line in getting-started needs a tweak.

## Phase 3 doc plan
- Markdown / code-block rendering in chat (finally lands in phase 3 after two slips): getting-started note + README feature bullet.
- Message edit / regenerate / delete endpoints + user-facing copy (deferred from phase 2 §10).
- Multi-provider picker UI + BYOK (phase 3 per phase 0 roadmap): getting-started provider section rework + new endpoints doc entries.
- Optional: split-with-parent shortcut button (OQ-5 phase 3 add) — one paragraph in the split walkthrough if it ships.
- Carry-over: refresh architecture.md phase framing (open issue 2), integrate screenshots (open issue 1).
