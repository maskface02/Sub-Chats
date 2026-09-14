# UX Spec — Phase 4: Delete/Undo, Export, Search, Stop, Edit/Regenerate, Shortcuts

**status:** ready_for_build
**owner:** UX (Muse Spark 1.3) · activation 2
**contract source:** `.orchestrator/specs/phase-4.md` (frozen rev 2)
**audience:** Frontend (implement), QA (test), Critic (review DoD)
**consistency:** reuses phase-2/3 dialog pattern (focus trap + Esc + focus restore to trigger), toast pattern (`role="status"`), reduced-motion rule, AA-contrast rule. No deltas vs frozen spec.

Shared primitives (all 7 components): `prefers-reduced-motion: reduce` → all transitions instant; all focus rings `ring-2 ring-ring ring-offset-1`; all destructive actions icon + text (never color alone); toasts bottom-center stack, auto-dismiss unless stated.

---

## 1. `HeaderOverflowMenu`

"…" button in the chat pane header. Menu items: Delete conversation, Export as Markdown, Export as JSON. Built on the phase-3 US-309 dialog/menu pattern.

### props
| name | type | required | default |
|---|---|---|---|
| `chatId` | `string` | yes | — |
| `chatTitle` | `string` | yes | — |
| `isOwner` | `boolean` | no | `true` — `false` hides Delete (defense-in-depth, US-402 AC.7) |
| `isStreaming` | `boolean` | no | `false` — delete still allowed (server 409s); no client suppression needed |
| `onDelete` | `(id: string) => void` | yes | — |
| `onExport` | `(id: string, format: "md" \| "json") => void` | yes | — |
| `exportPending` | `"md" \| "json" \| null` | no | `null` |

### states (per item)
- **default:** icon + label, `px-3 py-2 text-sm`; Delete uses destructive color tokens + trash icon.
- **hover:** `bg-accent` (Delete: `bg-destructive/10`). **focus:** `bg-accent` + ring (arrow-key roving). **active:** pressed flash.
- **disabled/loading:** Delete hidden (not disabled) when `isOwner=false`; export item shows trailing 14px spinner + `aria-busy="true"` while its format is in `exportPending`.
- **error/empty:** n/a at menu level (toasts owned by callers, US-403 AC.6).

### keyboard
| key | action |
|---|---|
| `Enter` / `Space` on "…" | open menu, focus first item |
| `ArrowDown` / `ArrowUp` | next / previous item (wraps) |
| `Home` / `End` | first / last item |
| `Enter` / `Space` | activate item → close menu |
| `Tab` | closes menu, focus leaves (menu pattern) |
| `Esc` | close, focus returns to "…" trigger |

### screen reader
- Trigger: `aria-haspopup="menu" aria-expanded`, label "Conversation options".
- Menu: `role="menu"`; items `role="menuitem"`; Delete item text "Delete conversation" (destructive semantics carried by text, not color).
- Export pending: `aria-busy` on the item; label unchanged.

### responsive
- Identical ≥ and < 768px (header affordance both breakpoints); menu `min-w-[200px]`, right-aligned to trigger, flips above if near viewport bottom.

### visual spec
```
┌──────────────────────┐
│ 🗑 Delete conversation│  destructive: text-destructive
│ ⬇ Export as Markdown │
│ ⬇ Export as JSON     │
└──────────────────────┘
```
`rounded-md border bg-popover py-1 shadow-md`; items `gap-2 text-sm`.

---

## 2. `DeleteConfirmDialog`

Opened by menu item or sidebar node delete action. Subtree-aware copy per US-402 AC.2.

### props
| name | type | required | default |
|---|---|---|---|
| `open` | `boolean` | yes | — |
| `onOpenChange` | `(open: boolean) => void` | yes | — |
| `title` | `string` | yes | — |
| `childCount` | `number` | yes | — |
| `pending` | `boolean` | no | `false` |
| `onConfirm` | `() => void` | yes | — |

### states
- **default:** heading `Delete "<title>"?` (+ ` and its N sub-chat(s)?` when `childCount > 0`); sub-line "This can be undone for a few seconds."; Cancel (default-styled) + Delete (destructive-styled).
- **hover/focus/active:** standard button states; initial focus = Cancel (safe default).
- **disabled/loading:** all controls when `pending`; Delete → spinner + "Deleting…"; dialog stays open.
- **error:** dialog stays open on 409/429/5xx; error toast owned by caller (US-402 AC.6). **empty:** n/a.

### keyboard
| key | action |
|---|---|
| `Tab` / `Shift+Tab` | trap: Cancel ↔ Delete |
| `Enter` | activates focused button |
| `Esc` | cancel — no request, close, focus → trigger |

### screen reader
- `role="dialog" aria-modal="true" aria-labelledby` (heading) `aria-describedby` (sub-line).
- Announced on open; close restores focus to the delete trigger (menu item or tree node) per phase-3 pattern.

### responsive
- Centered modal both breakpoints; `max-w-sm w-full` (< 768px: `mx-4`); backdrop `bg-black/40`.

### visual spec
```
┌──────────────────────────────────┐
│ Delete "Deploying with Docker"   │  font-semibold
│   and its 3 sub-chats?           │
│ This can be undone for a few     │  text-sm text-muted-foreground
│ seconds.                         │
│         [Cancel]  [Delete]       │  Delete: bg-destructive
└──────────────────────────────────┘
```

---

## 3. `UndoToast`

5s undo window after successful delete. Never steals focus.

### props
| name | type | required | default |
|---|---|---|---|
| `title` | `string` | yes | — |
| `deletedCount` | `number` | yes | — |
| `onUndo` | `() => void` | yes | — |
| `onExpire` | `() => void` | yes | — |
| `durationMs` | `number` | no | `5000` |

### states
- **default:** "Chat deleted" + Undo button; thin progress bar draining 5s→0 (linear, top edge).
- **hover/focus (Undo):** `bg-accent`; Tab-reachable (toast does NOT capture focus on appear); ring per shared pattern.
- **disabled/loading:** Undo disabled + spinner while restore in flight.
- **expired (~1.5s grace):** text swaps to "Deleted", Undo hidden, then dismisses.
- **error:** restore fails → toast swaps to "Could not undo — try again" (`role="alert"`), tree refetch owned by caller. **empty:** n/a.

### keyboard
- `Tab` reaches Undo while visible; `Enter`/`Space` activates. No trap — page stays operable.

### screen reader
- `role="status" aria-label="Chat deleted"` on appear — announced once. Countdown NOT announced per-second (only the expired-state change). Progress bar `aria-hidden`.

### responsive
- Bottom-center, `max-w-sm w-[calc(100%-2rem)]` on mobile; `bottom-4` desktop.

### visual spec
```
        ┌────────────────────────────┐
        │ Chat deleted    [Undo]     │  rounded-md border bg-popover shadow-md
        │ ▓▓▓▓▓▓░░░░░░░░░░░░░░       │  2px progress bar, drains 5s
        └────────────────────────────┘
```

---

## 4. `EditMessageInline`

Edit affordance on user's own messages → inline textarea in the bubble.

### props
| name | type | required | default |
|---|---|---|---|
| `messageId` | `string` | yes | — |
| `content` | `string` | yes | — |
| `isEditing` | `boolean` | yes | — |
| `isStreaming` | `boolean` | no | `false` — true disables Edit (tooltip "Stop the current response first") |
| `onStart` / `onCancel` | `() => void` | yes | — |
| `onSave` | `(content: string) => void` | yes | — |
| `savePending` | `boolean` | no | `false` |
| `fieldError` | `string \| null` | no | `null` |

### states
- **default:** bubble; "Edit" affordance revealed on hover AND keyboard focus (never hover-only, US-407 a11y); `text-muted-foreground → text-foreground` on hover/focus, visible ring.
- **editing:** bubble renders textarea prefilled (≤ 8000 chars, Shift+Enter = newline) + Save/Cancel buttons.
- **disabled:** affordance hidden + `aria-disabled` while `isStreaming`; tooltip "Stop the current response first" on hover/focus.
- **loading (savePending):** textarea disabled; Save → spinner + "Re-asking…"; Cancel still active.
- **error:** `fieldError` inline under textarea (`text-destructive text-xs`); toasts for 404/409/429 owned by caller; provider banner per phase-0.
- **empty:** saving with empty content → inline "Message can't be empty" (client mirror of 422).

### keyboard
| key | action |
|---|---|
| `Enter` / `Space` on affordance | enter edit mode, focus textarea (cursor at end) |
| `Esc` (in textarea) | Cancel — bubble restored unchanged, focus → the message |
| `Cmd/Ctrl+Enter` (textarea) | Save |
| `Tab` | affordance → (editing:) textarea → Save → Cancel |

### screen reader
- Affordance: `aria-label="Edit message"`.
- Entering edit: "Editing your message" via visually-hidden `role="status"`; textarea labelled "Edit message".
- Save/Cancel: labelled buttons. Replaced tail renders in the existing `aria-live` region (phase-1 stream announcement unchanged).

### responsive
- ≥ 768px: hover-reveal + always focusable. < 768px: affordance always visible (no hover); textarea full bubble width; basic responsive only (mobile-optimized edit out of scope §11).

### visual spec
```
┌─────────────────────────────────┐
│ Why did my container exit?  [✏] │  ✏ appears on hover/focus, top-right
└─────────────────────────────────┘
 editing: textarea (auto-height, 6 rows max) +
 (field error)          [Cancel][Save]
```

---

## 5. `RegenerateAffordance`

Text-button below the LAST assistant message only.

### props
| name | type | required | default |
|---|---|---|---|
| `messageId` | `string` | yes | — |
| `isLastAssistant` | `boolean` | yes | — |
| `isStreaming` | `boolean` | no | `false` |
| `isRegenerating` | `boolean` | no | `false` |
| `onRegenerate` | `(messageId: string) => void` | yes | — |

### states
- **default:** "↻ Regenerate" text-button, `text-sm text-muted-foreground`, below bubble, left-aligned.
- **hover/focus/active:** hover `text-foreground`; visible ring (NOT hover-only); pressed flash.
- **disabled/loading:** hidden while `isStreaming` (affordance absent, not merely disabled — it IS the streaming state); during re-stream: spinner replaces ↻ + "Regenerating…" (`aria-disabled` + tooltip).
- **error:** 404/409/429 → toasts (caller); provider banner + partial + Retry per phase-0; affordance reappears once not streaming.
- **empty:** hidden when `isLastAssistant=false`.

### keyboard
- `Tab`-reachable; `Enter`/`Space` activates. Not hover-only (US-408 a11y).

### screen reader
- `aria-label="Regenerate response"`. Replacement stream announces via existing `aria-live` region.

### responsive
- Identical both breakpoints; touch = tap activates.

### visual spec
```
│ Assistant reply bubble          │
│ ↻ Regenerate                    │  text-sm text-muted-foreground
```

---

## 6. `ShortcutOverlay`

`?` dialog — two-column key/action list per US-409 AC.5.

### props
| name | type | required | default |
|---|---|---|---|
| `open` | `boolean` | yes | — |
| `onOpenChange` | `(open: boolean) => void` | yes | — |
| `isMac` | `boolean` | no | UA/platform detection — renders `⌘` vs `Ctrl` |

Content = exactly the §9 map: New chat, Focus tree search, Toggle split view, Close (context-sensitive), Shortcuts. No hidden shortcuts.

### states
- **default:** two-column grid: `<kbd>` chips left, one-line descriptions right; `Esc` row included.
- **hover/focus/active/disabled/loading/error/empty:** n/a (static content; only the close affordance is interactive).

### keyboard
| key | action |
|---|---|
| `?` (Shift+`/`) | open — ONLY when focus is not in input/textarea/contenteditable/dialog (suppression rule §9) |
| `Tab` / `Shift+Tab` | trap (initial focus = dialog container/close) |
| `Esc` | close, focus → previous trigger (help affordance or prior element) |

### screen reader
- `role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"`. `<kbd>` chips presentational; descriptions carry meaning.

### responsive
- ≥ 768px: centered `max-w-lg`. < 768px: `mx-4`; grid collapses to single column (kbd above description) under 480px.

### visual spec
Two-column grid in `max-w-lg` centered modal: `<kbd>` chips (`rounded border bg-muted px-1.5 py-0.5 text-xs font-mono`) left; one-line descriptions right; "Esc never stops a stream" noted on the Esc row. Rows: New chat, Focus tree search, Toggle split view, Close (context-sensitive), Shortcuts.

---

## 7. `StopButton` + `StoppedChip`

### `StopButton`
Replaces the composer send button while a stream is in flight in that pane (US-405 AC.1). Same position/dimensions as send — no layout shift.

**props:** `isStreaming: boolean` · `onStop: () => void`.
**states:** renders ONLY while streaming (empty = absent) — it IS the streaming state, so loading/disabled n/a (abort always allowed); hover `bg-accent`; focus ring; active pressed flash; error n/a — intentional abort never produces the phase-0 error banner.
**keyboard/screen reader/responsive:** Tab-reachable from composer; `Enter`/`Space` activates; after stop focus → composer textarea (US-405 AC.5); `aria-label="Stop generating"`; icon + "Stop" text (not icon-only); identical both breakpoints.
### visual spec
`■ Stop` — 16px square icon + label, `rounded-md px-3 h-9`, secondary styling; send-button geometry (no layout shift on swap).

### `StoppedChip`
Small badge at the partial message tail (US-405 AC.3). Ephemeral (client memory; reload shows plain message).

**props:** none (static render given a stopped message-id set).
**states:** single visible state; rendered once at stop; persists (visually) until navigation/reload; motion: fade-in 150ms, instant under reduced-motion.
**keyboard:** not focusable (informational).
**screen reader:** inside the message region as `role="status"` — announced ONCE at stop ("Response stopped"), never repeated on re-render.
**responsive:** identical both breakpoints.
**visual:** `Stopped` — `text-[10px] uppercase tracking-wide rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground`, trailing the partial text.

---

## 8. `TreeSearchInput`

Sidebar top (both panel and drawer modes) — US-404.

### props
| name | type | required | default |
|---|---|---|---|
| `query` | `string` | yes | — (controlled, 150ms debounce owned by parent) |
| `onQueryChange` | `(q: string) => void` | yes | — |
| `matchCount` | `number \| null` | no | `null` — null = no active query |
| `treeFailed` | `boolean` | no | `false` — disables input, `aria-disabled` |
| `inputRef` | `Ref<HTMLInputElement>` | yes | — (`/` shortcut focus target, US-409) |

### states
- **default:** placeholder "Search tree…", magnifier icon left. **hover/focus:** standard input focus ring (focus ≠ filter change). **active:** typing → debounced 150ms filter.
- **disabled:** `treeFailed` → `aria-disabled`, `opacity-50`, no-op (phase-2 error state takes precedence, US-404 AC.7/§4). **loading/error:** n/a (client-side, zero network — US-404 AC.7).
- **empty result:** tree area shows "No conversations match "<query>"" + "Clear search" button (`text-sm text-muted-foreground` + link-styled button); clearing restores full tree (respecting phase-2 truncation notice).

### keyboard
| key | action |
|---|---|
| `/` (global, focus not in input/dialog) | focus this input (US-409 §9) |
| `Esc` (input focused) | clear query + blur, focus → tree container (US-404 AC.4) |
| `Tab` | input → Clear search (empty state) → tree |

### screen reader
- `<label class="sr-only">Search tree</label>` + `type="search"`.
- Result count changes: `role="status"` "N conversations match" (debounced with the filter, not per keystroke).
- `<mark>` highlights visual-only — node text content unchanged for AT (US-404 a11y).

### responsive
- ≥ 768px: full sidebar width, top of panel. < 768px: top of drawer. Match highlight (`<mark>`) AA in both themes per shared rule.

### visual spec
```
┌────────────────────────┐
│ 🔍 Search tree…        │  h-8 rounded-md border bg-background px-2 text-sm
│ (filtered tree; <mark> │  mark: bg-yellow-200 dark:bg-yellow-900/60
│  matches highlighted)  │
└────────────────────────┘
```

---

## 9. A11y checklist (aggregate for phase 4)

- [ ] Both dialogs (delete-confirm, shortcut overlay): `role="dialog"` + `aria-modal`, focus trap, Esc closes, focus restores to trigger.
- [ ] Menu: `role="menu"`/`menuitem`, arrow-key roving, Esc → trigger focus.
- [ ] All toasts `role="status"` (errors `role="alert"`); undo countdown never ticked per-second.
- [ ] Edit/Regenerate/Stop affordances: visible on keyboard focus (never hover-only), labelled, Enter/Space activate.
- [ ] Focus choreography: edit enter → textarea; edit save/cancel → the message; stop → composer; menu/dialog close → trigger.
- [ ] Stop + "Stopped" chip announced once each; chip not focusable.
- [ ] Search: sr-only label, count announced via `role="status"`, `<mark>` visual-only.
- [ ] `prefers-reduced-motion` honored on toast/undo-bar/chip motion.
- [ ] Destructive actions = icon + text, AA contrast both themes.
