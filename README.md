# Sub-chats

> AI chat with branching conversation trees — a foundation for threaded, exploratory conversations with any model.

![status](https://img.shields.io/badge/status-v1.0.0--production--ready-brightgreen) ![license](https://img.shields.io/badge/license-MIT-green)

> **v1.0.0 — production ready.** All six phases shipped: auth, streaming chat, sub-chat branching, tree navigation, BYOK providers, everyday polish, and the production deploy pipeline. See the [release notes](RELEASE_NOTES.md).

## Features

Everything shipped in v1.0.0, across phases 0–4:

- **Email + password auth** — sign up, sign in, sign out. Passwords hashed with bcrypt (cost 12).
- **Root chat** — start a new conversation and stream AI replies token-by-token.
- **Persistent history** — every message (user and assistant) is saved to the database.
- **Provider fallback chain** — OpenAI if `OPENAI_API_KEY` is set, otherwise Ollama if it is running locally. If neither is available the UI shows a clear banner.
- **Conversation list** — your recent chats on the home page, ordered by recency.
- **Secure by default** — cross-user access returns 404 (not 403) to prevent ID enumeration. Sign-in rate limited to 5 attempts per 15 minutes per IP.
- **Tree-map sidebar** — see and navigate your whole conversation tree.
- **Split view** — read two chats side-by-side.
- **Bring your own key** — OpenAI, Anthropic, Ollama, or any OpenAI-compatible endpoint — [provider docs](docs/getting-started.md#bring-your-own-key).
- **Markdown rendering** — assistant replies render GFM tables, code blocks, and task lists safely (no raw HTML).
- **Delete with undo** — soft-delete a conversation and its subtree, restore within 5 seconds.
- **Export** — download any conversation as Markdown or JSON (⋯ menu).
- **Tree search** — filter the sidebar by title or highlight text (`/` shortcut).
- **Stop generation** — abort a streaming reply; the partial response is kept.
- **Edit & regenerate** — fix a sent message or regenerate the last reply.
- **Keyboard shortcuts** — `Cmd/Ctrl+K`, `/`, `Cmd/Ctrl+\`, `Esc`, `?` (press `?` for the overlay).
- **Syntax-highlighted code blocks** — GitHub light/dark themes for fenced code.

What is **not** shipped: attachments, tool use, optimistic rendering, MFA. See the [roadmap](#roadmap).

## Sub-chats (the unique feature)

Sub-chats let you branch any AI conversation by highlighting text:

1. Highlight any text in an assistant message
2. Click the floating "Ask about this" pill (or right-click → "Sub-chat about selection")
3. A new chat opens, focused on your highlight, with full parent context loaded
4. Ask your follow-up — the AI knows what you're asking about

Sub-chats can themselves spawn sub-chats. Navigate via the breadcrumb at the top.

## Navigation

Three ways to move between conversations:

- **Breadcrumb** (top of the chat) — jump to any ancestor.
- **Tree-map sidebar** — the full conversation tree of the current root; click any node to jump there (hamburger button on mobile).
- **Split view** — "Split" in the header opens a second conversation side-by-side.

## Screenshots

Placeholder table — captures owned by UX (one pass covers all surfaces):

| # | Surface | Captured |
|---|---|---|
| 1 | Sign-in / sign-up screen | ☐ |
| 2 | Chat list (home) | ☐ |
| 3 | Conversation view with a streaming reply | ☐ |
| 4 | Highlight → "Ask about this" pill → sub-chat with parent-context banner | ☐ |
| 5 | Tree-map sidebar (incl. mobile drawer) | ☐ |
| 6 | Split view with the draggable divider | ☐ |
| 7 | Provider settings (`/settings/providers`) with masked key hint | ☐ |
| 8 | Export menu (Markdown / JSON) | ☐ |
| 9 | Delete confirm dialog + undo toast | ☐ |
| 10 | Tree search with `<mark>` highlights | ☐ |
| 11 | Stop button + "Stopped" chip | ☐ |
| 12 | Edit-in-place textarea + regenerate affordance | ☐ |
| 13 | `?` shortcut overlay | ☐ |
| 14 | Syntax-highlighted code block (light + dark themes) | ☐ |

## Quick start

You need Node 20+ and an AI provider (OpenAI key or a local Ollama install).

```bash
npm install
cp .env.example .env.local       # then edit .env.local (AUTH_SECRET, OPENAI_API_KEY)
npm run dev                      # http://localhost:3000
```

Open <http://localhost:3000>, sign up, click **New chat**, and send a message. No database setup needed — dev uses in-process pglite and bootstraps its own schema.

Full setup, troubleshooting, and configuration → [docs/getting-started.md](docs/getting-started.md).

## Deploy

1. Create a Vercel Postgres database and copy its `DATABASE_URL`.
2. Import the repo in Vercel — PRs get preview deploys, `main` deploys to production.
3. Set the env vars (`AUTH_SECRET`, `ENCRYPTION_KEY`, `AUTH_TRUST_HOST`, `LOG_LEVEL`, …).
4. Run migrations once against the new database: `DATABASE_URL=… npm run db:migrate`.
5. Verify: `curl https://<your-app>/api/health` → `200`, then run the smoke checklist.

Full runbook — backup/restore, rollback, secret rotation, incident response → [docs/deploy.md](docs/deploy.md).

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Browser (assistant-ui + shadcn/ui + TanStack Query)       │
└───────────────┬───────────────────────────┬──────────────┘
                │ HTTP / SSE                │
┌───────────────▼───────────────────────────▼──────────────┐
│ Next.js 15 (App Router, RSC, Route Handlers)             │
│   ├─ /api/auth/*  (Auth.js v5 Credentials, DB sessions)  │
│   ├─ /api/chats/* (REST: list / get / create)            │
│   ├─ /api/chats/:id/messages (SSE stream from AI SDK)   │
│   └─ /api/health (provider status for ops)               │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│ Data + AI                                                 │
│   ├─ Drizzle ORM → pglite (dev) / Postgres (prod)         │
│   └─ Vercel AI SDK → @ai-sdk/openai → fallback Ollama    │
└──────────────────────────────────────────────────────────┘
```

Detailed write-up → [docs/architecture.md](docs/architecture.md).

## Tech stack

- **[Next.js 15](https://nextjs.org)** — App Router, React Server Components, route handlers
- **[Auth.js v5](https://authjs.dev)** — credentials provider, DB sessions, rate-limited sign-in
- **[Drizzle ORM](https://orm.drizzle.team)** — typed schema; pglite in dev, Postgres in production (`DATABASE_URL` driver switch)
- **[pino](https://getpino.io)** — structured request logging with `X-Request-Id` correlation
- **[Vercel AI SDK v4](https://sdk.vercel.ai)** — `streamText` → SSE for streaming chat
- **[@assistant-ui/react](https://www.assistant-ui.com)** — chat surface (composer + message list)
- **[shadcn/ui](https://ui.shadcn.com)** — accessible primitives built on Radix
- **[TanStack Query](https://tanstack.com/query)** — client cache for the chat list
- **[@visx/hierarchy](https://airbnb.io/visx/hierarchy)** — conversation-tree visualisation (tree-map sidebar, phase 2)
- **[react-resizable-panels](https://github.com/bvaughn/react-resizable-panels)** — split-view panes with a draggable divider (phase 2)
- **[bcrypt](https://www.npmjs.com/package/bcrypt)** — password hashing (cost 12)
- **[Zod](https://zod.dev)** — request validation

## Project layout

```
.
├── src/
│   ├── app/              # Next.js App Router (routes, pages, api/)
│   ├── components/       # React components (assistant-ui, shadcn wrappers)
│   └── lib/              # auth, db, ai, schema
├── docs/                 # user + contributor docs (you are here)
├── .orchestrator/        # phase specs, role briefs, handoffs
├── drizzle/              # Drizzle migrations
├── .env.example          # required + optional env vars
└── package.json
```

## Roadmap

v1.0.0 ships phases 0–5 — every [spec](.orchestrator/specs/) frozen and complete:

- **Phase 0** — auth, streaming chat, persistence, provider fallback (shipped)
- **Phase 1** — sub-chat branching with full parent context (shipped)
- **Phase 2** — tree-map sidebar + split view (shipped)
- **Phase 3** — BYOK providers (encrypted keys), Anthropic, markdown rendering (shipped)
- **Phase 4** — delete with undo, export, tree search, stop, syntax highlighting, edit/regenerate, keyboard shortcuts (shipped)
- **Phase 5** — Vercel + Postgres deploy pipeline, health check, request logging, runbook (shipped)

What is **not** shipped (no schedule): attachments, tool use, optimistic rendering, MFA, a shared rate-limit store (Upstash Redis), E2E in CI.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, code style, and how this multi-agent project is orchestrated.

## License

[MIT](LICENSE) — copyright (c) 2026 subchats contributors.

## Acknowledgments

This project stands on the shoulders of:

- [vercel/chatbot](https://github.com/vercel/chatbot) — the streaming chat reference implementation
- [Vercel AI SDK](https://sdk.vercel.ai) — streaming primitives used everywhere
- [Auth.js](https://authjs.dev) — auth with DB sessions
- [assistant-ui](https://www.assistant-ui.com) — chat surface components
- [shadcn/ui](https://ui.shadcn.com) — accessible component primitives
- [Drizzle ORM](https://orm.drizzle.team) — typed database access
- [@visx/hierarchy](https://airbnb.io/visx/hierarchy) — the tree visualisation in the phase 2 sidebar
- [Ollama](https://ollama.com) — local LLM runner used as the offline fallback provider
