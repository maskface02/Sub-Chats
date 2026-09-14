# Post-Ship UX Change — Sub-chat Question Dialog

**date:** 2026-09-14
**requested_by:** user (product owner)
**status:** implemented, verified headlessly

## the change

Sub-chat creation is now **gated behind a question dialog**:

```
select text in an assistant reply
  → floating pill OR right-click → "Sub-chat about selection"
  → MINIMAL DIALOG: highlight preview + question input
  → Enter (or "Ask in sub-chat" button)
  → sub-chat CREATED + navigated to, question ALREADY SENT
    (full parent context via the existing ancestor walk)
```

Previously: pill/menu click created the sub-chat immediately and navigated
to an empty composer — the user lost the moment and had to retype their
question with no anchor to the highlight.

## implementation

- `src/lib/state/pending-question.ts` (NEW) — set/take store; the question
  rides ahead of navigation, ChatView consumes it on mount (get-and-clear,
  inherently idempotent under React strict-mode double-effects) and
  auto-sends through the normal streaming path
- `src/components/chat/SelectionMenu.tsx` — `startBranch` split into
  `openQuestionDialog` (pill + menu now both route here) and
  `createSubChatWithQuestion` (create → stash question → invalidateTree →
  navigate); new `SubChatQuestionDialog` (role=dialog, aria-modal, focus
  trap, Esc cancel, Enter submit, Shift+Enter newline, highlight preview,
  loading state reuses the pill spinner)
- `src/components/chat/ChatView.tsx` — mount effect consumes the pending
  question and calls `send(question)`
- `tests/unit/pending-question.test.ts` (NEW) — 4 store tests

## verified (headless chromium against the live compose stack)

1. selection → right-click menu visible ✓
2. menu click → dialog visible, still on parent chat (no premature creation) ✓
3. Enter → navigated to NEW sub-chat ✓
4. question auto-send: fires through the normal path — with no AI provider
   configured it correctly surfaces the no-provider error (same as manual
   composer send); with a provider the answer streams into the sub-chat
5. 0 pageerrors; 160/160 unit tests; tsc clean; build green

## notes

- the pill remains as a keyboard-accessible entry to the SAME dialog
  (a11y path per phase-1 US-101 AC.4); creation still only happens after
  explicit question entry — if the owner wants pill-removed entirely,
  it is a one-line change
- the dialog is intentionally minimal (no markdown, no provider picker)
  per the owner's "minimal window input" requirement
