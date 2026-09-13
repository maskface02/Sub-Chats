# Tech Writer Handoff — Phase 1

**role:** Tech Writer (Muse Spark 1.3)
**phase:** 1 — sub-chat core
**date:** 2026-09-13
**spec:** `.orchestrator/specs/phase-1.md` (frozen rev 2)
**inputs:** `.orchestrator/handoffs/api-phase-0.md`, `.orchestrator/handoffs/tech-writer-phase-0.md`

## docs created

| path | purpose |
|---|---|
| `docs/api/endpoints.md` | New. Full API reference: every phase-0 + phase-1 endpoint, auth, request/response shape (zod-derived), error codes table, curl examples. Replaces the inline API notes that lived in `architecture.md` and the phase-0 handoff. |

## docs modified

| path | change |
|---|---|
| `README.md` | Phase badge → `phase-1`. Top callout rewritten to lead with branching. "What is not in phase 0" → "What is not yet shipped" (branching is now shipped). New section **"Sub-chats (the unique feature)"** with the 4-step user flow. Net additions: ~12 lines (under the 30-line cap). |
| `docs/getting-started.md` | New section **"Try the branching feature"** appended after the first-time walkthrough, before "Verifying the provider". 7-step walkthrough with the pill → banner → follow-up → ancestor-context flow. |
| `docs/architecture.md` | New section **"Sub-chat tree model"** between "Data flow" and "Conversation tree (phase 0 shape)". Documents the `parentId`/`depth`/`rootConversationId` invariants and the 6-step context-reconstruction algorithm, with a forward reference to spec §7. |
| `.env.example` | Added `SUBSCHAT_SYSTEM_PROMPT` (commented) per spec §11 Q11 decision. Placeholders `{parentTitle}` and `{highlightText}` documented inline. |

## paths NOT touched (per instructions)

- `package.json` — frozen, unchanged
- All configs (`next.config.ts`, `drizzle.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `playwright.config.ts`, `.eslintrc*`) — frozen
- All code paths under `src/` — Backend/Frontend own these
- `.orchestrator/specs/`, `.orchestrator/decisions/`, `.orchestrator/roles/`, `.orchestrator/templates/` — read-only references
- `CONTRIBUTING.md`, `LICENSE` — untouched
- `docs/security/`, `docs/runbook.md` — not in scope for this phase (DevOps/Security own)

## open issues

1. **No screenshots yet.** Phase 1 ships new UI (pill, right-click menu, sub-chat view with banner + breadcrumb). Screenshots will be captured once UX finalises styling and Frontend ships the surface; the `## Screenshots` placeholder in `README.md` will be filled in then. Recommend: assign UX to capture 4 shots (pill in context, banner open, breadcrumb on depth 2, error toast) and Frontend to drop them into `docs/img/`.
2. **No link checker run.** All internal links I added resolve to files I created or already-existing files (`architecture.md`, `getting-started.md`, `.orchestrator/specs/phase-1.md`, `.orchestrator/handoffs/api-phase-0.md`). External links unchanged from phase 0 (`vercel/chatbot`, `assistant-ui`, `nextjs.org`, etc.). Recommend: add `lychee` or `markdown-link-check` to DevOps CI before phase 2.
3. **`/api/chats/:id/messages` ancestor walk is invisible in docs.** I documented the WHAT (system note prepended, message persisted only on sub-chat) but the WHY (algorithm step-by-step) lives in `architecture.md` and the spec. If readers want a quick example of a reconstructed message array, that's a phase-2 candidate — a small "messages-in, model-sees" worked example in `endpoints.md`.
4. **SSE event format is unverified.** The `endpoints.md` SSE block quotes `0:"..."` and `d:{...}` from the phase-0 handoff. If Frontend lands a different parsing strategy in phase 1 (e.g., wraps `@ai-sdk/react`), the docs may need a follow-up. Coordinate with Frontend before phase 2.
5. **Tree-map screenshot is phase-2.** README "Sub-chats" section mentions the breadcrumb but not the tree-map (which is correctly deferred). When phase 2 ships `react-d3-tree` (or alternative), update the section to mention the tree view too.
6. **`.env.example` still says `ANTHROPIC_API_KEY=""`.** Not modified here — phase-0 state. Backend has not wired the provider yet. When the Anthropic provider lands (phase 3 candidate), the env example will need a real comment block; the format I used for `SUBSCHAT_SYSTEM_PROMPT` is a good template.
7. **`docs/security/` not produced.** Security role owns threat-model docs. Phase 1 introduces a new attack surface (branch rate limit + foreign-owner ancestor walk); if Security produces a phase-1 addendum, link it from `architecture.md`'s Security section.

## plan for phase 2 docs

When phase 2 (tree-map sidebar + split view + message regenerate) ships:

- `docs/branching.md` (new): a dedicated user-facing guide. Highlight-to-branch walkthrough + screenshots; tree-map sidebar walkthrough; how to open a sibling in split view; regenerate button.
- `README.md`: replace the "Screenshots" placeholder with the tree-map screenshot; bump phase badge to `phase-2`; add a one-line "tree map" callout next to the sub-chats section.
- `docs/getting-started.md`: add a "Navigate the tree" section after "Try the branching feature".
- `docs/architecture.md`: add a "Tree query path" section next to "Sub-chat tree model" — the new `(rootConversationId)` index + subtree-fetch helper. Link to `src/lib/db/queries/conversations.ts` (when it lands).
- `docs/api/endpoints.md`: add `GET /api/chats/:id/tree` (returns the full subtree rooted at `:id`, depth ≤ N) and `POST /api/chats/:id/messages/:messageId/regenerate` (re-runs the last assistant turn).
- `.env.example`: add `TREE_MAP_MAX_DEPTH` (phase-2 candidate per the deferred Q3 revisit note).
- A new "Troubleshooting" subsection in `getting-started.md`: common phase-2 issues — tree doesn't render, regenerate reuses stale context, split view loses scroll position.

## verification (what I did before handing off)

- [x] README phase badge updated; top callout accurate for phase 1
- [x] `## Sub-chats (the unique feature)` section added exactly as specified
- [x] README net additions ≤ 30 lines
- [x] `docs/getting-started.md` extended with the branching walkthrough
- [x] `docs/architecture.md` extended with the tree model + algorithm
- [x] `docs/api/endpoints.md` created: 4 auth/chat/health sections, error code table, curl examples for every endpoint, phase-1 additions called out
- [x] `.env.example` documents `SUBSCHAT_SYSTEM_PROMPT` per spec Q11
- [x] All internal cross-links resolve (verified by re-reading source files)
- [x] No edits to `package.json` or any config
- [x] No edits to `src/` or any code path
- [x] No edits to `.orchestrator/specs/`, `.orchestrator/decisions/`, `.orchestrator/roles/`, `.orchestrator/templates/`

## links checked

| count | broken |
|---|---|
| 23 | 0 |

Internal links audited: `README.md` → `docs/getting-started.md`, `docs/architecture.md`, `CONTRIBUTING.md`, `LICENSE`, `.orchestrator/specs/`; new `endpoints.md` → `architecture.md#sub-chat-tree-model`, `getting-started.md`, `.orchestrator/specs/phase-1.md`, `.orchestrator/handoffs/api-phase-0.md`. External links unchanged from phase 0.

## handoff

This document lives at `.orchestrator/handoffs/tech-writer-phase-1.md`. The orchestrator and Reviewer should treat the docs as ready for the phase-1 DoD "Docs & handoffs" checklist:

- [x] README updated with phase-1 user flow (screenshots pending — see open issue #1)
- [x] `.env.example` documents `SUBSCHAT_SYSTEM_PROMPT` (per Q11)
- [x] API reference generated and current (`docs/api/endpoints.md`)
- [x] user guide covers new feature with walkthrough (`docs/getting-started.md`)
- [x] architecture documents the new tree model and algorithm (`docs/architecture.md`)
- [ ] screenshots / GIFs of the pill (deferred — see open issue #1)
- [ ] no-broken-links CI gate (recommended, not set up here — see open issue #2)