# Phase 2 Code Audit (stub)

**status:** stub — audit AFTER Backend + Frontend delivery
**phase:** 2 — Tree-Map Visualization + Split View
**threat model:** `.orchestrator/security/threat-models/phase-2.md`

## Orchestrator-accepted deviation (T-D-2)

`GET /api/chats/:id/tree` computes `totalNodes` as `rows.length` after the single
full-subtree fetch rather than a separate cheap `count(*)` aggregate.
**Accepted reasoning:** spec US-201 AC.3 mandates the single full-query fetch for
in-memory tree assembly; the DFS 500-node cap IS applied during output assembly,
so response size is bounded regardless. A second count query would double
round-trips for no additional safety — the full fetch already happens under the
same userId-filtered predicate. Revisit only if subtree sizes grow past
memory-friendly limits (phase 4 lazy-load would replace both).
**reviewer:** security (GLM 5.3 Flash tier)

## audit gates (fill in at delivery)

### Backend — tree endpoint (`GET /api/chats/:id/tree`)
- [ ] Auth at top; 404 `{code: NOT_FOUND}` for missing AND foreign `:id` (never 403, no body/timing delta)
- [ ] Subtree is a SINGLE query with BOTH `rootConversationId` AND `userId` literals (T-I-1 / T-E-1) — ownership NOT filtered only in JS
- [ ] Root node selected from WITHIN the filtered result set (T-I-2); absent root → 404
- [ ] `totalNodes` computed via aggregate count with the SAME `userId` filter — not `rows.length` of a full fetch (T-D-2)
- [ ] 500-node cap applied DURING assembly (DFS stops at 500), not post-fetch slice (T-D-1)
- [ ] No new mutation endpoints; no `highlightContext` or extra fields in payload (T-E-3, T-I-5)
- [ ] Tree 404 logged at `warn` (T-R-1); no titles in logs
- [ ] Drizzle parameterized; no raw `sql\`\`` (T-T-4)

### Frontend — tree map + split view
- [ ] Zero `dangerouslySetInnerHTML` anywhere in phase-2 components (T-T-1, T-T-2) — grep `src/components/**` and tree/picker/tooltip files
- [ ] TreeNode / tooltip / picker titles rendered as React text children
- [ ] Per-pane 404 → terminal "Conversation not found" state, NO retry/refetch loop (T-T-3); one pane's failure never unmounts the other (US-204 AC.7)
- [ ] Tree refetch trigger fires on branch-success only — no fetch→trigger→fetch loop (T-D-4)
- [ ] SSE client instance-scoped per pane (no module-level stream state — US-204 AC.4); close aborts the pane's stream (US-206 AC.2)

### Cross-cutting
- [ ] Message rate-limit key is still per-USER (split view draws from same budget — T-D-3); key regression to `conversationId` = finding
- [ ] `pnpm audit` clean or risks documented; no new deps (spec-locked)
- [ ] Security headers middleware still covers the new route
- [ ] Playwright: cross-user 404 on tree endpoint (AC-P2-15) exists and passes

## verdict

- [ ] approved / [ ] findings (fill at audit)
