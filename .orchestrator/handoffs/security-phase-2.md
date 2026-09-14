# Handoff — Security → Backend & Frontend (Phase 2)

**from:** security (GLM 5.3 Flash tier)
**date:** 2026-09-13
**basis:** `.orchestrator/security/threat-models/phase-2.md` (frozen spec `.orchestrator/specs/phase-2.md` rev 2)
**sign-off:** pending code audit (`.orchestrator/security/audits/phase-2.md`)

---

## Top 3 risks — Backend (tree endpoint)

1. **Tree ownership (T-I-1 / T-I-2 / T-E-1 — critical if missed).** The subtree query MUST filter on BOTH `rootConversationId` AND `userId` in SQL — one ownership check on `:id` is not enough. The root node must be selected from within the `userId`-filtered rows (foreign root → 404). The blast radius of a dropped filter is the FULL foreign subtree's metadata (titles are derived from message content — this is a data leak, not just metadata). Add Vitest: foreign descendant attached under a user's root is never returned.
2. **`totalNodes` count must be cheap and ownership-consistent (T-D-2 / T-I-3).** Use an aggregate count (`count(*)` on the `rootConversationId` index) with the SAME `userId` filter — never `rows.length` after a full fetch, and never an unfiltered count.
3. **500-node cap must be applied during assembly (T-D-1).** Stop the in-memory DFS at 500 nodes; do not fetch-all-then-slice. Post-cap, a refetch happens after every branch creation (US-202 AC.3) — an uncapped path would grow linearly with tree age on every branch.

Also verified at audit: 404 parity (byte-identical, ≤50ms), no mutation endpoints, no `highlightContext` in the payload, tree-404 warn-logged without titles.

## Top 2 risks — Frontend (tree map + split view)

1. **No HTML rendering of titles (T-T-1 / T-T-2 — high).** Zero `dangerouslySetInnerHTML` in ALL phase-2 components: TreeNode SVG labels (including any `@visx` text wrapping), hover tooltips, split picker items. Titles are user-controlled text — React text children only. Hard grep gate at audit.
2. **Pane 404 handling (T-T-3 — medium).** A client-crafted/foreign/deleted `secondaryId` in the split store will get a 404 from `GET /api/chats/:id`. The pane must enter a terminal "Conversation not found" state — no retry, no refetch loop — and must never crash or unmount the other pane (US-204 AC.7). Playwright case required (crafted foreign secondaryId, both panes survive). Also: tree refetch fires on branch-success only (no fetch→trigger→fetch loop), and per-pane SSE clients stay instance-scoped with abort on close.

Rate-limit invariant for Backend: the message rate-limit key STAYS per-USER — both split panes draw from the same budget (split must not double the ceiling).

---

## spec hardening requests owed to PM/Orchestrator

8 items (`.orchestrator/security/threat-models/phase-2.md`): (1) count query wording, (2) root-within-filtered-set clarification, (3) cap-during-assembly DoD wording, (4) per-user rate-limit invariant documented, (5) forbid automatic 404 retries in panes, (6) innerHTML prohibition in DoD, (7) keep minimal node shape verbatim, (8) four Vitest additions. Items #1–#6 recommended pre-build.

## sign-off

**Pending code audit.** No blocking pre-build findings; phase-2 surface is read-only and small. Approval contingent on the checklist phase-2 section passing.
