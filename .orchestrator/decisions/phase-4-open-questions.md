# Phase 4 Open Questions — Orchestrator Decisions

**date:** 2026-09-13
**phase:** 4
**decided_by:** Orchestrator
**input:** PM's 7 open questions in `.orchestrator/specs/phase-4.md` §12

| # | question | decision | rationale |
|---|---|---|---|
| OQ-1 | delete cascade vs block-parents | **cascade with soft-delete undo** (PM default) | matches user intent ("delete this whole branch of exploration"); undo makes it safe |
| OQ-2 | deletedBatchId column | **add the column** (PM default; flagged deviation from brief accepted) | exact, idempotent restore with zero new tables; live-only cascade filter (Reviewer fix) prevents cross-batch overwrites |
| OQ-3 | hljs auto-detect | **off** (PM default) | misfires on short snippets, costs CPU |
| OQ-4 | edit truncation destructive | **accept** (PM default) | documented; branch-on-edit is a phase 5 idea |
| OQ-5 | "Stopped" indicator | **ephemeral UI state** (PM default) | no schema churn for a cosmetic chip |
| OQ-6 | undo window | **UI-only 5s** (PM default) | server soft-delete window is the real safety net; UI toast is a convenience |
| OQ-7 | sub-chat context mutation after ancestor edit | **silent** (PM default) | sub-chats explore the living conversation — that IS the product philosophy; banner notice would imply staleness the product doesn't have |

## Reviewer-driven spec fixes (applied by Orchestrator before freeze)
1. **deletedAt-404 coverage extended** to `POST /:id/branch` + new edit/regenerate routes (was list/read/tree/export/send only) + unit tests
2. **US-405 AC.2 verify-or-implement**: phase-0 §8 makes onFinish the only assistant writer — abort-time partial persistence may need building; unit-test gate either way
3. **Delete 409 covers descendants' active streams**; cascade UPDATE filters `deletedAt IS NULL` (live-only) so nested deletes never overwrite another batch's id
4. **MD export escaping** (fence-wrap `#`/`---`/fence-leading content) + filename slug sanitization (strip CR/LF/quotes/control chars) + adversarial fixture test
5. **Restore batchId source explicit**: the soft-deleted target row's own `deleted_batch_id`

## next action
Hand frozen spec to all roles. Spawn Backend + Frontend + UX + Security + Tech Writer in parallel.
