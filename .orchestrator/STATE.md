# Sub-chats — Orchestrator State

last_updated: 2026-09-13

## phase
current: 1
status: complete
title: "sub-chat core"
spec: .orchestrator/specs/phase-1.md (frozen, revision 2)

## phase_status
- 0: ✅ complete (typecheck pass, 17 unit tests pass, build pass — pglite swap)
- 1: ✅ complete (typecheck pass, 46 unit tests pass, build pass — 1 new route, 29 new tests, ancestor walk, context reconstruction, selection UI, breadcrumb, parent banner)

## active_roles (phase 1)
- PM: spec delivered (frozen rev 2 after 3 polish fixes + 3 open-question resolutions)
- Backend: 5 new + 6 modified files, 1 new route, 3 new test files
- Frontend: 5 new + 6 modified files, 3 new components, 1 e2e spec
- Security: threat model (54 threats, 10 high), audit stub, checklist updated, handoff
- Tech Writer: README + 3 docs + .env.example + 1 new endpoints.md

## open_bugs
(none)

## decisions
- 2026-09-13: phase 1 spec frozen
- 2026-09-13: phase 1 open questions resolved (12 of 12)
- 2026-09-13: pino redact extended with selectedText/highlightText/highlightContext/clientHighlightContext
- 2026-09-13: BranchRequestSchema now .strict() (rejects unknown fields per OWASP T-T)
- 2026-09-13: branch rate-limit headers (Retry-After, X-RateLimit-*) on 429
- 2026-09-13: ancestorTitles added to GET /api/chats/:id (depth-asc array; Frontend consumes for breadcrumb at depth ≥ 3)
- 2026-09-13: Frontend breadcrumb uses "Private" consistently for foreign-owned crumbs (US-107 AC.3)

## handoffs (phase 1)
- PM → all roles: .orchestrator/specs/phase-1.md (frozen)
- Backend → Frontend: .orchestrator/handoffs/api-phase-1.md
- Security → Backend/Frontend: .orchestrator/handoffs/security-phase-1.md
- Tech Writer → all: .orchestrator/handoffs/tech-writer-phase-1.md

## cost_so_far
~$0.80 (cumulative: PM phase 0 + 5 roles phase 0 + 2 reviewer passes phase 0 + 7 orchestrator fixes phase 0 + pglite swap + PM phase 1 + 4 roles phase 1 + 1 reviewer pass phase 1 + 5 orchestrator fixes phase 1)

## reviewer_verdicts
- 2026-09-13: PM phase-1 spec → warn, 3 low-severity drift + 3 unresolved open questions, all fixed by Orchestrator
- 2026-09-13: phase-1 all-deliverables → warn, 1 high (pino redact) + 3 medium (batched ancestor walk, ancestorTitles, rate-limit headers) + 3 low (Zod .strict, breadcrumb, 404-vs-422), 5 of 7 fixed by Orchestrator (the ancestor walk O(d) was kept honest with comment + MAX_ANCESTOR_TOKENS escape hatch)
