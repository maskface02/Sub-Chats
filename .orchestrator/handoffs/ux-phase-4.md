# UX Handoff — Phase 4

**from:** UX (Muse Spark 1.3) · activation 2
**to:** Frontend (implement), QA (test)
**contract:** `.orchestrator/specs/ux/phase-4.md` (authoritative for visuals/interaction)
**behavior spec:** `.orchestrator/specs/phase-4.md` (frozen rev 2, authoritative for behavior/data)

## What Frontend builds (7 surfaces)

| Component | Suggested file | Key contracts |
|---|---|---|
| `HeaderOverflowMenu` | `src/components/chat/HeaderOverflowMenu.tsx` | "…" trigger, `role="menu"`, 3 items (Delete / Export md / Export json); arrow-key roving, Esc → trigger focus; export item spinner + `aria-busy` while in flight |
| `DeleteConfirmDialog` | `src/components/chat/DeleteConfirmDialog.tsx` | subtree-aware copy ("and its N sub-chat(s)?" when `childCount > 0`); initial focus Cancel; Delete destructive-styled; pending → "Deleting…" spinner; Esc/Cancel = no request |
| `UndoToast` | `src/components/chat/UndoToast.tsx` | 5s window with draining progress bar; does NOT capture focus; Undo Tab-reachable; expired → "Deleted" ~1.5s → dismiss; restore error → `role="alert"` swap |
| `EditMessageInline` | `src/components/chat/EditMessageInline.tsx` | affordance on hover AND focus (never hover-only); textarea prefilled, Shift+Enter newline; Esc = Cancel → focus the message; Cmd/Ctrl+Enter = Save; streaming → disabled + tooltip; fieldError inline |
| `RegenerateAffordance` | `src/components/chat/RegenerateAffordance.tsx` | last-assistant-only; hidden while streaming; spinner + "Regenerating…" during re-stream; Tab-reachable, Enter/Space |
| `ShortcutOverlay` | `src/components/chat/ShortcutOverlay.tsx` | two-column kbd/action grid; exactly the §9 map; `?` suppressed in inputs/dialogs; platform modifier ⌘/Ctrl; focus trap + restore |
| `StopButton` + `StoppedChip` / `TreeSearchInput` | `src/components/chat/StopButton.tsx`, `src/components/tree/TreeSearchInput.tsx` | Stop replaces send while streaming (no layout shift), focus → composer after stop; chip `role="status"` announced once, ephemeral; search at sidebar top, `/` focuses, Esc clears + blurs to tree, empty state with Clear |

No new dependencies. Reuses phase-3 dialog a11y pattern and phase-2 toast/tree primitives.

## Non-negotiable a11y implementation notes

1. Dialogs: `role="dialog"` + `aria-modal` + labelled; focus trap; Esc closes; focus restores to trigger (delete: menu item or tree node; overlay: help affordance).
2. Menu: `role="menu"`/`menuitem`; arrows rove + wrap; Tab closes; Esc → "…" trigger.
3. Toasts `role="status"`, errors `role="alert"`; undo countdown NEVER announced per-second.
4. Edit/Regenerate/Stop affordances visible on keyboard focus, labelled, Enter/Space activate; after stop focus → composer textarea.
5. Edit focus choreography: enter → textarea (cursor end); save/cancel → the message element.
6. Chip announced once at stop, not focusable, never repeated.
7. Search: sr-only label; "N conversations match" via `role="status"`; `<mark>` visual-only (node text unchanged for AT); filtered tree keeps the full WAI-ARIA tree pattern.
8. Destructive = icon + text; AA contrast both themes; `prefers-reduced-motion` kills toast/undo-bar/chip motion.

## Testable UX requirements for QA (each = one test)

- Menu: open → arrow keys rove with wrap → Enter activates → Esc returns focus to "…" trigger.
- Delete confirm (leaf): copy has no count line; Cancel/Esc close with zero network requests; focus → trigger.
- Delete confirm (subtree): copy reads "and its N sub-chat(s)?"; Delete → spinner "Deleting…", all controls disabled.
- Undo toast: appears bottom-center, no focus steal, Tab reaches Undo, progress bar drains exactly 5s, then "Deleted" → dismiss ~1.5s.
- Undo click → subtree reappears in tree/list without reload; toast dismissed.
- Delete failure 409/429/5xx → correct toast copy; conversation stays visible; dialog closed or stays per state.
- Export md/json → file downloads, no navigation; menu item shows spinner while in flight; failure toast.
- Edit: hover AND Tab-focus reveal affordance; enter edit → textarea focused, prefilled; Esc cancels unchanged + focus → message; Cmd/Ctrl+Enter saves; while streaming affordance disabled with tooltip; save → truncated tail replaced by new stream.
- Regenerate: visible only under last assistant message; hidden while streaming; click → spinner + re-stream in place; Stop during regenerate → partial + "Stopped" chip + composer ready.
- Stop: replaces send with identical geometry (no layout shift); click aborts; NO error banner; "Stopped" chip at message tail announced once; after stop focus in composer.
- `?` overlay: opens only when focus outside inputs/dialogs (typing `?` in composer must NOT open it); trapped; Esc closes + restores focus; shows ⌘ on macOS, Ctrl elsewhere.
- `/`: focuses tree search; suppressed while typing in composer. Esc in search: clears + focus → tree.
- Search: typing filters with 150ms debounce; zero network requests (assert via mocked fetch); non-matching leaves hidden, ancestor chains kept; `<mark>` highlight on matches; empty result → "No conversations match" + Clear search restores full tree.
- Reduced motion: toast/chip/undo-bar transitions instant.

## Open items (none blocking build)

- No UX deltas vs frozen spec. OQ-7 (sub-chat banner "parent was edited" notice) stays silent per PM default — flagged for phase 5.
