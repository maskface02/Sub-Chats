# Getting started

This guide walks you through running Sub-chats locally for the first time.

## Prerequisites

- **Node.js 20+** — check with `node --version`
- **npm 10+** — bundled with Node 20; check with `npm --version`
- **Git** — to clone the repository
- **An AI provider** — at least one of:
  - An **OpenAI API key** (easiest), *or*
  - **[Ollama](https://ollama.com)** running locally with any model pulled (`ollama pull llama3.2`)

On macOS / Linux you can install Node via [nvm](https://github.com/nvm-sh/nvm) or your package manager of choice.

## 1. Install dependencies

```bash
git clone <repo-url> subchats
cd subchats
npm install
```

## 2. Configure environment variables

Copy the example file and edit it:

```bash
cp .env.example .env.local
```

`.env.local` is git-ignored; never commit it.

### Required

| var | what to put |
|---|---|
| `AUTH_SECRET` | A random 32+ byte string. Generate one: `openssl rand -base64 32` |
| `AUTH_URL` | `http://localhost:3000` (default) |

### Pick at least one AI provider

| var | when to set it |
|---|---|
| `OPENAI_API_KEY` | Recommended. Get one at <https://platform.openai.com/api-keys>. The app uses `gpt-4o-mini`. |
| `OLLAMA_BASE_URL` | Leave the default `http://localhost:11434/v1` if Ollama is running locally. |

If you set neither, the chat endpoint returns `503 NO_PROVIDER` and `/signin` shows a banner explaining the situation. See [Provider fallback](#provider-fallback) below.

### Optional

| var | what it does |
|---|---|
| `DATABASE_URL` | Defaults to `file:./local.db` (SQLite in the project root). |
| `SENTRY_DSN` | Leave blank in dev. The Sentry SDK is installed but inactive without a DSN. |
| `LOG_LEVEL` | Defaults to `info`. Set `debug` while troubleshooting. |

## 3. Initialise the database

Phase 0 uses SQLite for development. Drizzle creates the schema (users, sessions, conversations, messages, providers — see [architecture.md](architecture.md)) and applies it directly:

```bash
npm run db:push
```

This writes `local.db` in the project root. If you want a GUI, run `npm run db:studio` to open Drizzle Studio in the browser.

## 4. Start the dev server

```bash
npm run dev
```

Open <http://localhost:3000>. You should land on the sign-in page (or on the no-provider banner if no AI provider is configured).

## 5. First-time walkthrough

1. Click **Sign up** → enter your email and a password (≥ 8 characters) → submit. You are redirected to the chat list at `/`.
2. Click **New chat**. You land on `/chats/<id>` with an empty thread.
3. Type a message in the composer and press **Enter**. The first token of the AI reply appears within ~2 s on a warm cache; streaming continues until the model is done.
4. Send a few more messages. Reload the page — your conversation is restored from the database.

## Verifying the provider

A quick smoke test for ops / DevOps without sending a chat:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{
  "status": "ok",
  "provider": { "type": "openai", "model": "gpt-4o-mini", "baseUrl": null },
  "ollamaReachable": false
}
```

`provider.type` is `"openai"` when `OPENAI_API_KEY` is set, `"ollama"` when Ollama is reachable instead, or `null` when neither is available.

## Provider fallback

Selection is automatic at server boot, in this order:

1. `OPENAI_API_KEY` is set → uses `@ai-sdk/openai` with `gpt-4o-mini`.
2. `OPENAI_API_KEY` is unset **and** Ollama responds at `OLLAMA_BASE_URL/api/tags` within 2 s → uses the first model from `/api/tags` (fallback `llama3.2`).
3. Otherwise → chat requests return `503 NO_PROVIDER` and the UI shows the banner.

If the resolved provider fails mid-stream, the partial assistant message is saved and the UI shows an inline error with a **Retry** button.

## Troubleshooting

### "No AI provider configured" banner

Both `OPENAI_API_KEY` is unset and Ollama is not reachable at `OLLAMA_BASE_URL`.

Fix one of them:

```bash
# Option A — set the OpenAI key
echo 'OPENAI_API_KEY="sk-..."' >> .env.local

# Option B — start Ollama and pull a model
ollama serve &
ollama pull llama3.2
```

Then restart `npm run dev`.

### Port 3000 already in use

Either stop the other process, or run on a different port:

```bash
PORT=3001 npm run dev
```

If you change the port, also update `AUTH_URL` in `.env.local` to match (e.g. `http://localhost:3001`).

### "database is locked" / `SQLITE_BUSY`

Only one process can write to the SQLite file at a time. Common causes:

- **Drizzle Studio is open** in another tab — close it.
- **Two `npm run dev` processes** running — kill the duplicate.
- The dev server was force-killed and left a stale lock — delete `local.db-journal` (or stop all processes and retry `npm run db:push`).

### Sign-in says "Too many attempts. Try again in 15 minutes"

The rate limiter is 5 failed attempts per 15 minutes per IP. Wait it out, or restart the dev server to clear the in-memory bucket (this is fine in dev; production will use a shared store in a later phase).

### Stream just stops mid-message

If the AI provider errors mid-stream, the partial assistant message is kept and an inline **Retry** button appears. If you instead see `502 PROVIDER_FAILED`, the model call failed at the network level — check your API key, billing, and provider status page.

### `npm install` warnings about peer deps

A few peer-dep warnings from `assistant-ui` and Radix are expected and harmless in phase 0. If `npm install` exits non-zero, paste the error — it is usually a Node version mismatch.

## Next steps

- Skim the architecture → [architecture.md](architecture.md)
- Want to change behaviour? → [CONTRIBUTING.md](../CONTRIBUTING.md)
- Curious about what's next? → [`.orchestrator/specs/`](../.orchestrator/specs/)
