# Tech Writer Handoff — Phase 0

**role:** Tech Writer (Muse Spark 1.3)
**phase:** 0 — setup + root chat end-to-end
**date:** 2026-09-13
**spec:** `.orchestrator/specs/phase-0.md`

## docs created

| path | purpose |
|---|---|
| `README.md` | Top-level project README. Status badge, phase-0 features, quick start, architecture pointer, stack, roadmap, license, acknowledgments. 147 lines. |
| `docs/getting-started.md` | Detailed local setup: prerequisites, env vars (with `openssl rand` and provider notes), `db:push`, first-time walkthrough, provider fallback, troubleshooting (no-provider banner, port conflicts, DB lock, rate limit, stream errors, peer-dep warnings). |
| `docs/architecture.md` | Textual architecture: ASCII diagram, layer-by-layer walkthrough (frontend, route handlers, data, AI, auth), data-flow diagrams for signup / send-message / chat-list, tree structure with phase-1 foresight, branching-placement table, security notes, deferred decisions. |
| `CONTRIBUTING.md` | Bug filing, PR process, code style (neighbour-file rule, TS strict, server-first, Zod-at-boundary), how the orchestration works, license. |

## paths NOT touched (per instructions)

- `package.json` — frozen, unchanged
- All configs (`next.config.ts`, `drizzle.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `playwright.config.ts`, `.eslintrc*`) — frozen
- All code paths under `src/` — Backend/Frontend own these
- `.orchestrator/specs/`, `.orchestrator/decisions/`, `.orchestrator/roles/`, `.orchestrator/templates/` — read-only references
- `.env.example` — already matches the spec; not modified

## open issues

1. **No screenshots yet.** Phase 0 ships UI, but the chat surface is a moving target while Frontend finalises styling. Screenshots will be captured and embedded after phase 0 lands visually; a `Screenshots` placeholder section exists in `README.md`.
2. **No links verified by a link checker.** I read each `docs/` cross-link and confirmed it points at a file I created in this handoff. The `LICENSE` and `CONTRIBUTING.md` references also resolve. A repo-wide link check should run after phase 0 merges (recommended: `lychee` or `markdown-link-check` in CI; not set up here because adding CI is DevOps' scope).
3. **Anthropic mention.** `package.json` includes `@ai-sdk/anthropic` as a dep but the spec (§10 Q10) defers wiring it. The README's "Tech stack" section lists it implicitly under "Vercel AI SDK"; it does **not** advertise Anthropic as a working provider. If you'd rather drop the dep until phase 3, that's a Backend / DevOps call.
4. **Vercel deployment docs.** Phase 0 is dev-only (spec §10 Q9). No `vercel.json`, no production env-var wiring guide. Both will land in phase 1; this handoff does not pre-empt them.
5. **API reference.** Spec §11 lists an API reference under "Docs" DoD, but the tech-writer role definition (`roles/tech-writer.md`) defers `docs/api/` to OpenAPI auto-generation. Since the route handlers do not exist yet (Backend is still spawning), the API surface is documented **inline in `architecture.md`** (data-flow diagrams) and in the spec (§5). A `docs/api/endpoints.md` page should be generated once routes are stable — phase 1 candidate.
6. **Architecture mermaid.** The diagrams are ASCII to match the spec's plain-text style and to avoid adding a render step. If the project adopts a Markdown renderer with mermaid support, the diagrams can be ported in a one-line follow-up.

## plan for phase 1 docs

When phase 1 (sub-chat branching) ships:

- **README**: add "branching" to features, add a "Tree structure" section link, add phase-1 screenshot when UX captures the tree-map sidebar.
- **docs/getting-started.md**: extend "Next steps" with a phase-1 setup addendum (probably no new env vars; just the existing provider config covers it).
- **docs/architecture.md**: replace the "phase 0 / phase 1" comparison block with the actual tree query path; document the new `/api/chats/:id/branch` endpoint and the title-derivation hook.
- **docs/branching.md** (new): user-facing guide — "Highlight any assistant text → right-click → New sub-chat". Screenshots required.
- **docs/api/endpoints.md** (new, auto-generated): full endpoint list with examples. Generated from OpenAPI / route-handler inspection.
- **CONTRIBUTING.md**: update "code style" examples with phase-1 files once they exist (e.g., `branch-button.tsx`, `src/lib/chat/title.ts`).

## verification (what I did before handing off)

- [x] README ≤ 200 lines (147)
- [x] Each docs page references real files / commands that match the spec and `package.json`
- [x] No invented features — every feature listed is in the spec
- [x] All `docs/` cross-links resolve to files created in this handoff or pre-existing (`LICENSE`)
- [x] No edits to `package.json` or any config
- [x] No edits to `src/` or any code path
- [x] No edits to `.orchestrator/specs/`, `.orchestrator/decisions/`, `.orchestrator/roles/`, `.orchestrator/templates/`

## handoff

This document lives at `.orchestrator/handoffs/tech-writer-phase-0.md`. The orchestrator and Reviewer should treat the docs as ready for the phase-0 DoD "Docs" checklist:

- [x] `.env.example` documents required and optional vars (DevOps owns; I read it and matched it in `getting-started.md`)
- [x] README "Getting started" section runs locally with the commands documented (matches `package.json` scripts: `npm install`, `npm run db:push`, `npm run dev`)

Two follow-up doc items are flagged in **open issues** and can land in phase 1 without blocking phase 0 sign-off.
