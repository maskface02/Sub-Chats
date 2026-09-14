# UX Handoff — Phase 2

**from:** UX (Muse Spark 1.3) · first activation
**to:** Frontend (implement), QA (test)
**contract:** `.orchestrator/specs/ux/phase-2.md` (authoritative for visuals/interaction)
**behavior spec:** `.orchestrator/specs/phase-2.md` (frozen rev 2, authoritative for behavior/data)

## What Frontend builds (4 components)

| Component | File (suggested) | Key contracts |
|---|---|---|
| `TreeMapSidebar` | `src/components/tree/TreeMapSidebar.tsx` | desktop panel (resizable 200–400, default 260) / mobile drawer <768px; states: loading skeleton, error+Retry, empty hint, truncated notice; refetch via `refetchSignal` bump on branch creation only (OQ-6) |
| `TreeNode` | `src/components/tree/TreeNode.tsx` | 4 variants (current > sub-chat > root > default); tooltip 150ms (title + date); chevron toggles without navigating; `interactive={false}` mode reused by picker |
| `SplitView` | `src/components/split/SplitView.tsx` | `react-resizable-panels` PanelGroup; 50/50 default; min 25% + 320px floor; active-pane tracking (OQ-2: tree click navigates active pane); per-pane close; orientation toggle |
| `SplitPicker` | `src/components/split/SplitPicker.tsx` | dialog over cached tree data (no fetch); excludes current conversation; preselects parent; focus trap; Esc → focus back to trigger |

Locked libs: `@visx/hierarchy@^4`, `react-resizable-panels@^4.12.4` — no new deps.

## Non-negotiable a11y implementation notes

1. Roving tabindex: exactly one treeitem `tabindex="0"` (init = current node); others `-1`.
2. Focus ≠ current — arrows move focus only; Enter/Space/click navigate.
3. Roles: `tree/treeitem/group`, `aria-level/setsize/posinset/expanded/current`; drawer = `role="dialog" aria-modal`; panes = `role="region" aria-label="Chat pane N: <title>"`; divider = `role="separator"` + `aria-valuenow`.
4. Focus management: tree nav → `<h1>`; drawer Esc → "Tree" button; picker Esc → "Split" button; pane close → surviving `<h1>`.
5. `prefers-reduced-motion` kills drawer slide, expand/collapse, pane transitions.
6. Non-color cues: current node fill+border, 📌 icon with aria-label, active pane border+label.

## Testable UX requirements for QA (each = one test)

- Drawer: open via "Tree" → focus trapped → Esc/×/backdrop closes → focus back on "Tree" button.
- Tree keys: ArrowDown/Up (visible DFS order), ArrowRight (expand→first child), ArrowLeft (collapse→parent), Home/End, Enter/Space navigate — test each key separately.
- Tree click navigates to `/c/<id>`; new node gains current state; focus lands on `<h1>`.
- Tooltip appears ≤150ms with full title + locale date; gone on mouse leave.
- Branch creation in any pane → tree refetches → new node visible without reload.
- Truncated tree (>500 nodes) shows "Showing 500 of N conversations".
- Split button hidden <768px; visible ≥768px.
- Picker: parent preselected; current conversation excluded; Esc restores focus to trigger.
- Both panes stream simultaneously with zero crosstalk; per-pane error isolation.
- Divider: mouse drag clamps at 25%; arrows resize 5%; Home/End snap 25%/75%; ratio announced.
- Orientation toggle horizontal↔vertical.
- Close pane mid-stream aborts its stream; single view restored ≤200ms; URL updates if current pane closed; surviving draft preserved, closed draft discarded.
- Reduced-motion: drawer/expand/pane transitions instant.

## Open deltas (Orchestrator to confirm)

1. Sidebar resizable 200–400px (brief) vs frozen US-202 AC.7 fixed width — implemented per brief.
2. Empty-state hint added under lone root (brief) vs US-202 "no message needed".
3. Truncation ~24 chars + tooltip 150ms follow frozen spec (brief said 18 / 300ms).
