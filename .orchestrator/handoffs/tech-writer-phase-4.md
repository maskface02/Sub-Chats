# Handoff — Tech Writer, phase 4 (polish: delete/undo, export, search, stop, highlighting, edit/regenerate, shortcuts)

**date:** 2026-09-14
**phase:** 4
**spec:** `.orchestrator/specs/phase-4.md` (frozen rev 2)
**decisions:** `.orchestrator/decisions/phase-4-open-questions.md`

## Files updated

| file | change |
|---|---|
| `README.md` | badges → phase 4; status line rewritten for the polish pass; 7 new feature bullets (delete with undo, export, tree search, stop, edit & regenerate, keyboard shortcuts, syntax-highlighted code blocks); "not yet shipped" refreshed (attachments, tool use, optimistic rendering, MFA); roadmap: phase 4 marked shipped with the correct feature list |
| `docs/getting-started.md` | new **Everyday actions** section: delete via header ⋯ menu with 5s undo (incl. stream-blocked note), export md/json, `/` tree search (client-side, `Esc` clear), Stop button semantics (partial kept, `Esc` never stops), edit (truncate + re-stream warning) and regenerate (last-reply-only), shortcut table (`Cmd/Ctrl+K`, `/`, `Cmd/Ctrl+\`, `Esc`, `?`) with suppression-while-typing note |
| `docs/architecture.md` | new **Soft delete (phase 4)** section: `deletedAt` + `deletedBatchId` columns, live-only partial index swap, subtree cascade with `WHERE deleted_at IS NULL` (nested-batch integrity), restore-by-batch idempotence, 404 parity across all routes, truncate-on-edit hard-delete semantics, purge cron noted out of scope |
| `docs/api/endpoints.md` | error table gains `STREAM_ACTIVE` (409), `NOT_EDITABLE` (422), `NOT_REGENERABLE` (422); new **Conversation lifecycle endpoints (phase 4)** section: `DELETE /api/chats/:id`, `POST /api/chats/:id/restore`, `GET /api/chats/:id/export?format=md|json`, `POST /api/chats/:id/messages/:messageId/edit`, `POST /api/chats/:id/messages/:messageId/regenerate` — full request/response shapes, error codes, rate-limit buckets (delete/restore bucket vs shared send LLM bucket), soft-delete 404-parity callout, md export structure notes, curl examples |

No code files touched (role constraint: docs only).

## Links checked

All internal links in modified files resolve: README feature links → `docs/getting-started.md#bring-your-own-key` anchor unchanged; getting-started section links to `architecture.md` / `CONTRIBUTING.md` intact; endpoints.md See-also unchanged; new sections use no cross-file anchors that could break.
**links_checked:** 11 · **broken_links:** 0

## Open issues

- **Screenshots TBD** — every phase-4 UI surface needs captures, owner UX: delete confirm dialog (subtree copy), undo toast, export menu items, tree search with `<mark>` highlights + empty state, Stop button + "Stopped" chip, edit-in-place textarea, regenerate affordance, `?` shortcut overlay, highlighted code block in light AND dark themes.
- Getting-started screenshots generally lag (README "Screenshots" section still says "coming after phase 0") — one capture pass should cover phases 0–4.
- Shortcut overlay copy should be verified against the shipped §9 map at sign-off (docs assume the spec map verbatim).
- Release notes for phases 3–4 not yet written (deferred to phase sign-off per phase-3 handoff).

## Phase 5 plan (docs)

1. README/docs refresh for production deploy: Postgres migration guide (SQLite → Postgres), deploy runbook link, env var changes.
2. Document whatever lands from the phase-5 idea pile: branch-on-edit, cross-root server-side search, optimistic rendering, persisted "stopped" flag, per-message model override, go-to-parent hotkey — spec-dependent.
3. API reference: any new routes (trash UI? purge cron ops endpoint?) plus regeneration-history/version-picker endpoints if built.
4. Release notes for phases 3–4 under `.orchestrator/handoffs/release-notes/`.
5. Screenshot pass covering all shipped surfaces (with UX).
