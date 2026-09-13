# Phase 1 Open Questions — Orchestrator Decisions

**date:** 2026-09-13
**phase:** 1
**decided_by:** Orchestrator
**input:** PM's 12 open questions in `.orchestrator/specs/phase-1.md` §11
**Reviewer-flagged (must resolve before freeze):** Q1, Q7, Q8

## Q1: Route migration `/chats/[id]` → `/c/[id]`
**Decision: moot — phase 0 already uses `/c/[id]`.**
Verified `src/app/c/[id]/page.tsx` exists and is the chat view route from phase 0. The PM's premise ("phase 0 ships `/chats/[id]`") was incorrect. No migration needed. The new branch API route is `POST /api/chats/:id/branch` (API keeps `/api/chats/...` per phase 0 convention).

## Q7: `parentId` FK declaration
**Decision: add now.**
Schema has `parentId` column without `.references(() => conversations.id)` FK. Add it in this phase. pglite + drizzle-kit will reflect it on next migration generation. Small, safe change. Documented in spec §6 note.

## Q8: `GET /api/chats/:id` response shape change (add `parentTitle`, `rootTitle`)
**Decision: ship as additive.**
Add the new fields to the existing response. One fewer round-trip. Backward-compatible. Documented in spec §5 "Existing route behavior changes".

## Q2: Title auto-derivation trigger
**Decision: on first user message send** (PM default). Immediate, no AI latency. Implement in `POST /api/chats/:id/messages` for the first message of a conversation where title is still "New chat".

## Q3: Max depth
**Decision: uncapped** (PM default). Phase 1 has no max-depth UI. Revisit if a real UX report shows user pain.

## Q4: Sub-chat rename / delete
**Decision: skip both in phase 1** (PM default). Defer to phase 2 with tree-map.

## Q5: Banner collapsed-state persistence
**Decision: always default per breakpoint** (PM default). Desktop expanded, mobile collapsed. No localStorage churn.

## Q6: Ancestor chain size
**Decision: full chain** (PM default). gpt-4o-mini 128k context covers deep chains. Add `MAX_ANCESTOR_TOKENS` env var as a future escape hatch but don't enable truncation in phase 1.

## Q9: Floating-pill placement
**Decision: above with 8px gap, flip below on overflow, clamp horizontally** (PM default). UX role to validate.

## Q10: Selection event debounce
**Decision: 50ms debounce** (PM default). Reduces mobile churn.

## Q11: System prompt for sub-chat
**Decision: env var `SUBSCHAT_SYSTEM_PROMPT` with default** (PM default). Operational flexibility.

## Q12: Pill placement on scroll
**Decision: follow selection** (PM default). Spec US-101 AC.1.

## impact on spec
- Q1: spec question resolved by code inspection; spec header updated.
- Q7: small Backend schema change (add `.references()`); no runtime impact in dev.
- Q8: additive response field, no breaking change.
- All other Qs: PM defaults locked.

## next action
Hand frozen spec to all roles. Spawn Backend + Frontend + Security + Tech Writer in parallel.
