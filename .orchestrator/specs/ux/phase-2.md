# UX Spec — Phase 2: Tree-Map Sidebar + Split View

**status:** ready_for_build
**owner:** UX (Muse Spark 1.3)
**contract source:** `.orchestrator/specs/phase-2.md` (frozen rev 2) + `.orchestrator/decisions/phase-2-open-questions.md`
**audience:** Frontend (implement), QA (test), Critic (review DoD)

**Deltas vs frozen spec (flagged to Orchestrator, resolve before build):**
1. Sidebar width **resizable 200–400px, default 260px** per orchestrator brief — supersedes US-202 AC.7 ("fixed width").
2. Empty-state hint under a lone root node ("No sub-chats yet — select text in a reply to branch") per orchestrator brief — extends US-202 states.
3. Node title truncation = **~24 chars** per US-202 AC.2 (brief said ~18; frozen spec wins).
4. Tooltip delay = **150ms** per US-203 AC.2 (brief said 300ms; frozen spec wins).
5. Pane min width = **25% of split area** (US-205 AC.3) with a 320px hard floor — both constraints honored.

Locked libs (not UX's to change): `@visx/hierarchy@^4` (tree), `react-resizable-panels@^4.12.4` (split).

---

## 1. `TreeMapSidebar`

Fixed-left, full-height panel (desktop) or slide-over drawer (mobile). Renders the tree from `GET /api/chats/:id/tree`. Read-only navigation.

### props
| name | type | required | default |
|---|---|---|---|
| `tree` | `TreeNodeData \| null` (§5 shape) | yes | — |
| `currentId` | `string` | yes | — |
| `truncated` | `boolean` | no | `false` |
| `totalNodes` | `number` | no | `0` |
| `mode` | `"panel" \| "drawer"` | yes | — (set by breakpoint) |
| `open` | `boolean` | no | `false` (drawer only) |
| `onClose` | `() => void` | no | — (drawer only) |
| `onNavigate` | `(id: string) => void` | yes | — |
| `onRetry` | `() => void` | yes | — |
| `refetchSignal` | `number` | no | `0` — bump after any branch creation → refetch (OQ-6: branch-creation only) |

### states
- **default:** tree rendered; current node highlighted; ancestor path of current expanded (US-203 AC.3).
- **hover:** N/A at container level (TreeNode owns hover).
- **focus:** N/A (roving tabindex lives on treeitems).
- **active:** N/A.
- **disabled:** N/A.
- **loading:** skeleton tree — root outline + 2 stub child outlines; `aria-busy="true"` on container; chat view stays interactive.
- **error:** 5xx/network → "Could not load tree — [Retry]" button; 404 → "Conversation not found". Both `role="status"`.
- **empty:** root with no sub-chats → single root node + hint line "No sub-chats yet — select text in a reply to branch" (`text-xs text-muted-foreground`).
- **truncated (extra):** static notice "Showing 500 of \<totalNodes\> conversations" pinned at bottom; `role="status"`; navigation to omitted nodes impossible.

### keyboard interactions
| key | action |
|---|---|
| `Tab` | enters tree on the roving node; `Tab` again exits to next page element |
| `ArrowDown` / `ArrowUp` | focus next / previous VISIBLE node (flattened DFS, skip collapsed subtrees) |
| `ArrowRight` | collapsed w/ children → expand, keep focus; expanded → first child; leaf → no-op |
| `ArrowLeft` | expanded → collapse, keep focus; collapsed/leaf → move to parent |
| `Home` / `End` | first / last visible node |
| `Enter` / `Space` | activate = navigate to `/c/<id>` (identical to click) |
| `Esc` | drawer only: close drawer, restore focus to "Tree" header button |

Focusing a node NEVER navigates (focus ≠ current, US-203 AC.7).

### screen reader behavior
- Desktop: `<aside aria-label="Conversation tree">` landmark.
- Drawer: `role="dialog" aria-modal="true" aria-label="Conversation tree"` + focus trap.
- Tree semantics: `role="tree"` → `role="treeitem"` → nested `role="group"`; `aria-level` / `aria-setsize` / `aria-posinset` on every item; `aria-expanded` only on nodes with children; `aria-current="true"` on current node.
- Loading: `aria-busy="true"`; error + truncated notices: `role="status"`.

### responsive breakpoints
- **< 768px:** hidden. Header "Tree" button opens left slide-over drawer (`w-[280px] max-w-[85vw]`) over dimmed backdrop (`bg-black/40`). Close: backdrop tap, `Esc`, or × button. Focus trapped inside; slide 200ms, instant under `prefers-reduced-motion`.
- **≥ 768px:** persistent left panel; width resizable 200–400px, default 260px (mouse-drag right edge only; keyboard resize budget goes to split divider); never pushes chat into horizontal scroll.

### visual spec
```
┌────────────────┐
│ CONVERSATION   │  h-10 px-3 text-xs font-medium uppercase
│ TREE           │  tracking-wide text-muted-foreground
├────────────────┤
│ [RAG system]   │  SVG tree, top-down (@visx/hierarchy)
│   └ 📌[Ask…]   │  node h-8, row gap y-2, indent 16px/level
│      └ [Chroma]│
├────────────────┤
│ Showing 500 of │  optional truncated notice, text-xs
│ 812 conversa…  │  text-muted-foreground
└────────────────┘
```
- container: `bg-muted/20 border-r border-border`; inner scroll `overflow-y-auto p-2`.
- resize edge (desktop): invisible 4px hit area on right border; hover → `bg-ring/40`.

---

## 2. `TreeNode`

Rendered inside the SVG tree. Rounded rect; title truncated ~24 chars + ellipsis; depth via indentation (layout owns position); level badge for depth ≥ 2 (US-202 AC.2).

### props
| name | type | required | default |
|---|---|---|---|
| `node` | `TreeNodeData` | yes | — |
| `isCurrent` | `boolean` | yes | — |
| `hasChildren` | `boolean` | yes | — |
| `expanded` | `boolean` | no | `true` (only meaningful when `hasChildren`) |
| `focused` | `boolean` | no | `false` (roving tabindex holder) |
| `interactive` | `boolean` | no | `true` (false inside SplitPicker) |
| `onActivate` | `(id: string) => void` | yes | — |
| `onToggle` | `(id: string) => void` | no | — (chevron) |

### variants
- **current:** filled `bg-primary` + `text-primary-foreground` + **2px `border-primary`** (fill AND border — not color alone).
- **sub-chat:** 📌 marker (`aria-label="branched from a highlight"`) + `border-muted-foreground/40`.
- **root:** `font-semibold`.
- **default:** `border-border bg-background`.
- Precedence: current > sub-chat > root > default (current root shows current styling + bold).

### states
- **default:** per variant above.
- **hover:** `bg-accent` (non-current) / `bg-primary/90` (current); tooltip appears after 150ms: FULL title + created date (locale format, e.g. "Sep 13, 2026"); disappears on mouse leave.
- **focus:** 2px primary ring (`ring-2 ring-ring ring-offset-1`); focused ≠ current.
- **active:** pressed flash — `bg-accent` scale-[0.98] for the click duration.
- **disabled:** N/A.
- **loading:** N/A (sidebar owns loading skeleton).
- **error:** N/A.
- **empty:** N/A.

### keyboard interactions
- Arrow keys / Home / End are owned by the tree container (see §1) — TreeNode does not capture them.
- `Enter` / `Space` on focused node → `onActivate(node.id)`.
- Chevron is part of the treeitem (single tab stop per APG tree pattern): when the node is focused and has children, `ArrowRight`/`ArrowLeft` toggle; mouse users click the chevron directly (chevron click does NOT navigate).

### screen reader behavior
- Announcement via ARIA attrs: "\<title\>, level \<n\>, \<i\> of \<n\>, collapsed|expanded|leaf" + "current conversation" when `aria-current="true"`.
- 📌 marker: `aria-label="branched from a highlight"` — never read as an emoji.
- Tooltip content is the node's full title (already its accessible name); date is decorative (`aria-hidden`).

### responsive breakpoints
- Identical visual at both breakpoints (drawer is narrower → tree scrolls horizontally if depth overflows; no mobile gestures, per §10).
- Touch: no hover/tooltip; first tap = navigate.

### visual spec
```
      ╭──────────────────╮        current:  bg-primary text-primary-foreground
      │ 📌 Ask about vDB…│        sub-chat: border-muted-foreground/40 + 📌
      ╰──────────────────╯        root:     font-semibold
                                  default:  border-border
```
- node rect: `rounded-md border px-2 h-8 text-sm max-w-[180px] truncate`.
- chevron: 16px, `text-muted-foreground`, left of title, only when `hasChildren`.
- level badge (depth ≥ 2): `text-[10px] text-muted-foreground` right-aligned.
- tooltip: `rounded-md border bg-popover px-2 py-1 text-xs shadow-md`.

---

## 3. `SplitView` (container)

`react-resizable-panels`: `PanelGroup` (direction per orientation) + two `Panel`s + `PanelResizeHandle`. Each pane embeds an independent phase-1 ChatView.

### props
| name | type | required | default |
|---|---|---|---|
| `leftChatId` | `string` | yes | — |
| `rightChatId` | `string` | yes | — |
| `orientation` | `"horizontal" \| "vertical"` | no | `"horizontal"` |
| `activePaneId` | `"left" \| "right"` | yes | — |
| `onActivePaneChange` | `(pane: "left" \| "right") => void` | yes | — |
| `onClosePane` | `(pane: "left" \| "right") => void` | yes | — |
| `onOrientationToggle` | `() => void` | yes | — |

### states
- **default:** two panes 50/50, divider centered; active pane indicated by `border-2 border-primary` on its header + "Active" label (border + label — not color alone).
- **hover (divider):** handle widens `w-1.5 → w-2`, `bg-ring/40`.
- **focus (divider):** `ring-2 ring-ring ring-offset-1`; ratio announced ("50% / 50%").
- **active:** divider dragged — `bg-ring`; min pane clamp 25% (320px floor) enforced live.
- **disabled:** N/A.
- **loading:** N/A at container level (per-pane skeletons are phase-1 states inside each ChatView).
- **error:** N/A at container level (per-pane isolation — US-204 AC.7).
- **empty:** N/A (component only mounts with two ids).

### keyboard interactions
| key | action |
|---|---|
| `Tab` | order: pane 1 content → divider → pane 2 content (no traps) |
| `ArrowLeft`/`ArrowRight` (horizontal) | resize ±5% |
| `ArrowUp`/`ArrowDown` (vertical) | resize ±5% |
| `Home` / `End` | snap divider to min (25%) / max (75%) |
| `Enter`/`Space` on close button | close that pane; if it was active, focus → surviving pane's `<h1>`; if it held the current conversation, URL → `/c/<remaining-id>` |
| `Enter`/`Space` on orientation toggle | horizontal ↔ vertical |

### screen reader behavior
- Divider: `role="separator" aria-orientation="horizontal|vertical" aria-label="Resize panes"` + `aria-valuenow/min/max` (percent) — ratio announced on focus and after resize.
- Each pane: `role="region" aria-label="Chat pane 1: <title>"` / `"Chat pane 2: <title>"`.
- Close button: `aria-label="Close pane: <conversation title>"`.
- Orientation toggle: `aria-label="Toggle split orientation"` + `aria-pressed`.

### responsive breakpoints
- **< 768px:** never rendered (Split button hidden; split is desktop-only, US-204 AC.1).
- **≥ 768px:** rendered; orientation toggle + per-pane close in pane headers.

### visual spec
```
┌───────────────────────┬───────────────────────┐
│ pane header [×]       │ pane header [×]       │  h-10 border-b
├───────────────────────┼───────────────────────┤
│ ChatView A            │ ChatView B            │
│                       │                       │
├───────────────────────┴───────────────────────┤
│            ◄══►   [⇅ toggle orientation]      │  divider + toggle
└───────────────────────────────────────────────┘
```
- divider: `w-1.5 bg-border hover:bg-ring/40 cursor-col-resize` (vertical: `h-1.5 cursor-row-resize`).
- pane min: 25% of split area, 320px floor; default 50/50.
- close ×: `size-7 rounded-md hover:bg-accent`, top-right of pane header.

---

## 4. `SplitPicker`

Dialog choosing what to open in the second pane. Data from the already-fetched tree — no extra request (US-204 AC.2).

### props
| name | type | required | default |
|---|---|---|---|
| `open` | `boolean` | yes | — |
| `onOpenChange` | `(open: boolean) => void` | yes | — |
| `tree` | `TreeNodeData \| null` | yes | — |
| `currentId` | `string` | yes | — |
| `onSelect` | `(id: string) => void` | yes | — |

Behavior: lists flattened visible nodes of the current root EXCLUDING the currently-open conversation; preselects the current conversation's parent when it exists; select → `onSelect(id)` + close.

### states
- **default:** mini tree list (TreeNode visuals, `interactive={false}`); preselected item highlighted.
- **hover:** item `bg-accent`.
- **focus:** item `ring-2 ring-ring` (initial focus = preselected parent item).
- **active:** item pressed flash; select opens split.
- **disabled:** N/A.
- **loading:** tree still loading → centered spinner (`aria-busy="true"`).
- **error:** inherits tree error state → error text + Retry inside dialog.
- **empty:** no other conversations in tree → "No other conversations in this tree" (`text-sm text-muted-foreground`), dialog stays open.

### keyboard interactions
| key | action |
|---|---|
| `Tab` / `Shift+Tab` | cycles INSIDE dialog only (focus trap) |
| `ArrowDown` / `ArrowUp` | move between list items |
| `Enter` / `Space` | select item → open split, close dialog |
| `Esc` | cancel, close dialog, focus returns to "Split" trigger |

### screen reader behavior
- `role="dialog" aria-modal="true" aria-label="Choose conversation for second pane"`.
- List: `role="listbox"`; items `role="option"` + `aria-selected` for the preselection.
- Open announcement: dialog label; close: focus restore to trigger (implicit).

### responsive breakpoints
- **< 768px:** never rendered (trigger hidden).
- **≥ 768px:** centered modal (`max-w-md w-full`), backdrop `bg-black/40`.

### visual spec
```
┌────────────────────────────────┐
│ Choose conversation for        │  text-sm font-semibold
│ second pane                    │
├────────────────────────────────┤
│ ▸ [RAG system]        (root)   │  TreeNode visuals, non-interactive
│   📌 [Ask about vDB…] ← presel │  parent preselected when exists
│   📌 [Chroma vs FAISS]         │
└────────────────────────────────┘
```
- item row: `px-3 py-2 rounded-md text-sm`, indent mirrors tree depth; 📌 + truncation as TreeNode.

---

## 5. State diagrams

### 5.1 Tree sidebar
```
                    ┌────────────────────────────────────────────┐
                    │            TREE SIDEBAR                    │
                    └────────────────────────────────────────────┘
  DESKTOP (≥768)                    MOBILE (<768)
  ─────────────                     ─────────────
  [hidden] ──render──> [panel open] [drawer closed] ──tap [Tree]──> [drawer open]
                           │              ▲                             │
                           │        Esc/×/backdrop                       │
                           │        (focus → Tree btn)                   │
  [panel open] ──click/Enter node──> navigate /c/<id> ──> focus <h1>
                           │
  [panel open] ──branch created in ANY pane──> refetchSignal++ ──> refetch
                           │                                     │
                           └──────────── new node visible <──────┘
  [any] ──fetch fails──> [error: Retry] ──retry──> [loading] ──> [success|error]
```

### 5.2 Split view
```
 [single view]
      │ click "Split" (≥768px only)
      ▼
 [picker open] ──Esc──> [single view] (focus → Split trigger)
      │ select item (Enter/click)          ▲
      ▼                                    │
 [two panes 50/50] ──× pane────────────────┘
      │              (focus → surviving <h1>;
      │               URL → /c/<remaining> if current pane closed)
      │
      ├── drag divider / arrows (±5%) ──> [resized, 25% clamp]
      ├── Home/End on divider ──> [25% | 75% snap]
      ├── toggle orientation ──> [vertical stack]
      └── tree click ──> navigates ACTIVE pane
                          (picked id already open? → that pane becomes active)
```

---

## 6. A11y checklist (aggregate for phase 2)

- [ ] Tree = WAI-ARIA tree pattern: `role="tree"/"treeitem"/"group"`, `aria-level`/`aria-setsize`/`aria-posinset`/`aria-expanded`/`aria-current`, roving tabindex (exactly one `tabindex="0"`), initialized to the current conversation's node.
- [ ] Arrow-key semantics per §1 key map — QA tests each key individually (US-203 AC.4–6).
- [ ] Focus ≠ current: focusing never navigates; navigate only on Enter/Space/click.
- [ ] Drawer focus trap; `Esc` restores focus to "Tree" button; picker focus trap; `Esc` restores focus to "Split" button.
- [ ] Split panes are landmark regions: `role="region" aria-label="Chat pane N: <title>"`; `Tab` order pane1 → divider → pane2; no trap outside dialogs.
- [ ] Divider: `role="separator"`, `aria-orientation`, `aria-label="Resize panes"`, ratio announced on focus + after resize; arrows ≤5% steps; Home/End snap.
- [ ] Post-navigation focus → target view's `<h1>` (tree click, pane close).
- [ ] All loading/error/truncated states announced: `aria-busy`, `role="status"`.
- [ ] `prefers-reduced-motion: reduce` → drawer slide, node expand/collapse animation, pane transitions all instant (US-208 AC.4).
- [ ] Color independence: current node = fill + 2px border; 📌 = icon + aria-label; active pane = border + label (US-208 AC.5).
- [ ] Focus rings ≥ 3:1 non-text contrast, both themes (US-203 a11y).
- [ ] Close button labels: "Close pane: \<title\>"; 📌 not read as emoji.

---

## 7. Handoff

See `.orchestrator/handoffs/ux-phase-2.md` (Frontend + QA summary, testable UX requirements).
