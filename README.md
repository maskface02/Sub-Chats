# Sub-chats

> AI chat with branching conversation trees — a foundation for threaded, exploratory conversations with any model.

![status](https://img.shields.io/badge/status-alpha-yellow) ![phase](https://img.shields.io/badge/phase-3-blue) ![license](https://img.shields.io/badge/license-MIT-green)

> Phase 3 ships **bring-your-own-key providers** and **markdown rendering**. It builds on phase 0 (auth, streaming chat, history) and phases 1–2 (branching sub-chats, tree navigation, split view).

## Features

Phase 0 includes:

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

What is **not** yet shipped: attachments, search, message edit/regenerate, syntax highlighting. See the [roadmap](#roadmap).

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

Coming after phase 0 ships. The UI is minimal on purpose — signin screen, chat list, and a single conversation view.

## Quick start

You need Node 20+ and an AI provider (OpenAI key or a local Ollama install).

```bash
npm install
cp .env.example .env.local       # then edit .env.local (AUTH_SECRET, OPENAI_API_KEY)
npm run db:push                  # create the SQLite database
npm run dev                      # http://localhost:3000
```

Open <http://localhost:3000>, sign up, click **New chat**, and send a message.

Full setup, troubleshooting, and configuration → [docs/getting-started.md](docs/getting-started.md).

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
│   ├─ Drizzle ORM → SQLite (dev) / Postgres (prod)        │
│   └─ Vercel AI SDK → @ai-sdk/openai → fallback Ollama    │
└──────────────────────────────────────────────────────────┘
```

Detailed write-up → [docs/architecture.md](docs/architecture.md).

## Tech stack

- **[Next.js 15](https://nextjs.org)** — App Router, React Server Components, route handlers
- **[Auth.js v5](https://authjs.dev)** — credentials provider, DB sessions, rate-limited sign-in
- **[Drizzle ORM](https://orm.drizzle.team)** — typed schema, SQLite for dev, Postgres-ready
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

Phase 0 is **shipped** when the [definition of done](.orchestrator/specs/phase-0.md#11-definition-of-done) is met. Subsequent phases:

- **Phase 1** — sub-chat creation (highlight any assistant text → branch into a sub-chat). DB schema already reserves the columns.
- **Phase 2** — tree-map sidebar + split view (shipped; regenerated messages deferred to phase 3).
- **Phase 3** — BYOK providers (encrypted per-user keys), Anthropic, markdown rendering (shipped).
- **Phase 4** — syntax highlighting, attachments, tool use / function calling, MFA.

Full specs → [`.orchestrator/specs/`](.orchestrator/specs/).

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
