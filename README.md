# Sub-chats

> AI chat with branching conversation trees — a foundation for threaded, exploratory conversations with any model.

![status](https://img.shields.io/badge/status-alpha-yellow) ![phase](https://img.shields.io/badge/phase-0-blue) ![license](https://img.shields.io/badge/license-MIT-green)

> Phase 0 ships the foundation: signup, signin, and a real, persistent, streamed AI conversation. Branching lands in phase 1.

## Features

Phase 0 includes:

- **Email + password auth** — sign up, sign in, sign out. Passwords hashed with bcrypt (cost 12).
- **Root chat** — start a new conversation and stream AI replies token-by-token.
- **Persistent history** — every message (user and assistant) is saved to the database.
- **Provider fallback chain** — OpenAI if `OPENAI_API_KEY` is set, otherwise Ollama if it is running locally. If neither is available the UI shows a clear banner.
- **Conversation list** — your recent chats on the home page, ordered by recency.
- **Secure by default** — cross-user access returns 404 (not 403) to prevent ID enumeration. Sign-in rate limited to 5 attempts per 15 minutes per IP.

What is **not** in phase 0: branching, tree visualisation, split view, multi-provider picker, attachments, search, custom system prompts. See the [roadmap](#roadmap).

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
- **[react-d3-tree](https://github.com/bkrem/react-d3-tree)** — tree view (used in phase 1)
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
- **Phase 2** — tree-map sidebar (react-d3-tree), split view, message regenerate.
- **Phase 3** — multi-provider picker UI, BYOK (encrypted per-user keys), conversation rename/delete, search.
- **Phase 4** — attachments, tool use / function calling, MFA.

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
- [react-d3-tree](https://github.com/bkrem/react-d3-tree) — the tree visualisation we plan to use in phase 1
- [Ollama](https://ollama.com) — local LLM runner used as the offline fallback provider
