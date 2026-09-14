# Phase 2 Open Questions — Orchestrator Decisions

**date:** 2026-09-13
**phase:** 2
**decided_by:** Orchestrator
**input:** PM's 6 open questions in `.orchestrator/specs/phase-2.md` §11

| # | question | decision | rationale |
|---|---|---|---|
| OQ-1 | sidebar side | **fixed left** (PM default) | consistent with phase 0 AppShell; user toggle is polish, not core |
| OQ-2 | tree-map click during split | **navigates the ACTIVE pane** (PM default) | matches user mental model — last-focused pane receives the action |
| OQ-3 | createdAt on tree nodes | **add** (PM default) | hover tooltip date is cheap and useful |
| OQ-4 | node cap behavior | **500 + DFS truncate + `truncated` flag** (PM default); `totalNodes` = pre-truncation total (per Reviewer fix) | lazy-load is phase 4 complexity; truncate+notice is honest and simple |
| OQ-5 | split picker vs zero-click shortcut | **picker only** (PM default) | one interaction model in phase 2; shortcut can be added later without breaking anything |
| OQ-6 | tree refetch triggers | **branch-creation only** (PM default) | window-focus refetch adds noise; the tree only changes on branch creation or delete (delete is phase 3) |

## Reviewer-driven spec fixes (applied by Orchestrator before freeze)
1. `totalNodes` semantics unified: pre-truncation full subtree size (US-201 AC.2 + §5 step 5 now match US-202 AC.6's notice)
2. §1 markdown provenance corrected (phase 0 → phase 1 → phase 2 → now phase 3)
3. §10 now explicitly re-defers message edit/regenerate/delete + optimistic rendering (phase 0 had targeted them at phase 2) → phase 3

## locked libs
- `@visx/hierarchy@^4.0.0` — tree-map (React 19 compatible, verified)
- `react-resizable-panels@^4.12.4` — split view (React 19 compatible, verified)
- both already installed in package.json

## next action
Hand frozen spec to all roles. Spawn UX (first activation) + Backend + Frontend + Security + Tech Writer in parallel.
