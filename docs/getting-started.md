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

## Try the branching feature

1. Send a message and get a response
2. In the assistant's reply, highlight a word or phrase (e.g., "vector database")
3. A floating "Ask about this" pill appears above your selection
4. Click the pill → a new sub-chat opens
5. The sub-chat shows the parent context in a banner above the message list
6. Type your follow-up ("what's the best one for small teams?") and press Enter
7. The AI responds with full ancestor context — it knows what you mean by "it"

## Navigate your conversation tree

Once you have at least one sub-chat, two new surfaces help you get around:

**Tree-map sidebar**

1. The tree sidebar sits beside the chat on desktop; on mobile, tap the **Tree** button in the header to open it as a drawer.
2. It shows every conversation in the current tree, top-down: the root at the top, each sub-chat below its parent. Highlighted branches (📌) mark sub-chats created from a text selection.
3. Click any node to jump to that chat — the current chat is highlighted with a bold border.
4. The tree is read-only navigation: no drag, rename, or delete.
5. Create another sub-chat → the tree updates automatically; no reload needed.

**Split view (desktop only, ≥ 768 px)**

1. Click **Split** in the header.
2. Pick a conversation from the picker (if the current chat has a parent, the parent is preselected).
3. Two panes appear side-by-side, each with its own messages, composer, and streaming reply.
4. Drag the divider to resize; use the **⇅** control in the divider to stack the panes vertically instead.
5. Close a pane with its **×** — a reload always returns you to single view (the split is not saved).

## Everyday actions

Phase 4 adds the day-to-day polish. All of these are available from the chat view.

### Delete a conversation (with undo)

1. Open the **⋯** menu in the chat header (or right-click a node in the tree sidebar) → **Delete**.
2. A confirm dialog tells you exactly what goes: a conversation with sub-chats is deleted **with its whole subtree**.
3. After confirming, a toast appears with an **Undo** button, active for **5 seconds**. Click it to restore the conversation and its subtree — no reload needed.
4. After the 5-second window the delete is still soft (recoverable server-side for 30 days), but there is no UI path back — treat it as gone.

Deleting is blocked while a reply is streaming in the conversation or any of its sub-chats — stop the stream first.

### Export a conversation

**⋯** menu → **Export as Markdown** or **Export as JSON**. The file downloads immediately:

- **Markdown** — readable copy with the title, the ancestor path + highlight context (for sub-chats), and every message.
- **JSON** — full raw data of that conversation (messages, model, provider id, timestamps) for backups or tooling.

Exports are per-conversation; whole-tree export is not supported yet.

### Search the tree

Press `/` (or click the search box at the top of the tree sidebar) and type. The tree filters live by title and highlight text; matching substrings are highlighted and ancestor chains stay visible so matches stay reachable. `Esc` clears the search. Search is client-side — nothing is sent to the server, and it only covers the current tree.

### Stop a long response

While a reply is streaming, the composer's send button becomes a **Stop** button. Click it to abort the stream: the partial reply is kept (marked with a "Stopped" badge until reload), and you can send a new message immediately. `Esc` does **not** stop a stream — it is reserved for closing panes and dialogs.

### Edit your message or regenerate a reply

- **Edit** — hover (or keyboard-focus) one of your sent messages → **Edit**. The bubble becomes a textarea; saving truncates everything after it and streams a fresh reply from the edited message. The truncated tail is gone permanently.
- **Regenerate** — on the **last** assistant reply, use the **Regenerate** affordance. The old reply is replaced by a new stream with the same history (a different model may be picked if your provider setup changed).

Both are blocked while a stream is active in that conversation, and both count against the message-send rate limit.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `Cmd/Ctrl + K` | New chat |
| `/` | Focus tree search |
| `Cmd/Ctrl + \` | Toggle split view |
| `Esc` | Close dialog / clear search / close focused pane |
| `?` | Show the shortcut overlay |

Shortcuts are ignored while you're typing in an input or textarea (except `Esc` in its own context). Press `?` anywhere to see the overlay.

## Bring your own key

You don't need a server-level API key — you can add your own provider from the UI:

1. Sign in, then open the user menu → **Provider settings** (or go to `/settings/providers`).
2. Click **Add provider** and pick a type:
   - **OpenAI** — paste your API key (`sk-…`). Get one at <https://platform.openai.com/api-keys>.
   - **Anthropic** — paste your API key (`sk-ant-…`). Get one at <https://console.anthropic.com>.
   - **Ollama** — set base URL `http://localhost:11434` (local, no key needed).
   - **Custom** — any OpenAI-compatible endpoint: a base URL plus an optional key (keyless endpoints allowed).
3. Optionally set a model id (defaults apply: `gpt-4o-mini`, `claude-3-5-haiku-latest`, `llama3.2`).
4. Save. Your **first provider becomes the default automatically** — your chats then use it instead of the server fallback.

Notes:

- Your chats always use your default provider when you have one; otherwise the server default (environment) is used.
- You can store up to 10 providers; add/edit/delete are rate-limited (30 requests / 10 min).
- Keys are **encrypted at rest (AES-256-GCM)** and **never shown again** — edit shows only a masked hint like `…abc1`. Submitting an empty key field on edit keeps the existing key.

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

`provider.type` is `"openai"` when `OPENAI_API_KEY` is set, `"anthropic"` when only `ANTHROPIC_API_KEY` is set, `"ollama"` when Ollama is reachable instead, or `null` when none is available. Signed-in users also see `provider.source` — `"user"` when their own default provider resolves, `"env"` for the env chain.

## Provider fallback

Resolution happens **per message send**, in this order:

1. Your **default provider** (from Provider settings), if you have one — your key and model are used.
2. Otherwise the server env chain, in order: `OPENAI_API_KEY` → `ANTHROPIC_API_KEY` → Ollama (if reachable at `OLLAMA_BASE_URL`).
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
