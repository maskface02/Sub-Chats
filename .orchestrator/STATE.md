# Sub-chats — Orchestrator State

last_updated: 2026-09-13

## phase
current: 0
status: in_progress
title: "setup + root chat end-to-end"

## active_roles
- PM (writing phase 0 spec)
- UX, Backend, Frontend, DevOps, Security, Tech Writer (pending PM)

## open_bugs
(none)

## decisions
- 2026-09-13: stack locked (Next.js 15, Drizzle, assistant-ui, react-d3-tree, Ollama, Auth.js, Vercel)
- 2026-09-13: org locked (8 roles + Reviewer, 18 agents total)
- 2026-09-13: model split locked (Muse Spark default, GLM 5.3 Flash for code, M3 for judgment)
- 2026-09-13: cost optimizations locked (parallel B+C, dynamic model per task, skip-critic on trivial, cheap-reviewer pre-filter, spec files referenced, JSON output)
- 2026-09-13: autonomy = full auto to production, escalate on: spec change, security tradeoff, irreversible cost, scope cut, production deploy

## handoffs
(none yet)

## phase_status
- 0: in_progress

## cost_so_far
~$0.00 (no role agents invoked yet)

## reviewer_verdicts
(none yet)
