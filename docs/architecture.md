# Architecture

This document describes how Sub-chats is put together at the end of phase 0. It is intentionally textual — diagrams, conventions, and the rationale behind the layers.

## High-level diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser                                                           │
│  ┌──────────────────────┐  ┌────────────────────────────────────┐  │
│  │ assistant-ui thread  │  │ TanStack Query (chat list cache)   │  │
│  │  + shadcn/ui inputs  │  │                                    │  │
│  └──────────┬───────────┘  └─────────────┬──────────────────────┘  │
└─────────────┼──────────────────────────────┼─────────────────────────┘
              │ fetch / SSE                 │ fetch
┌─────────────▼──────────────────────────────▼─────────────────────────┐
│  Next.js 15 (App Router)                                            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Server Components: page shells, data loaders                 │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ Route Handlers (/api/*):                                     │   │
│  │   • /api/auth/[...nextauth]   Auth.js v5 (Credentials)       │   │
│  │   • /api/auth/signup          Custom: create user + session  │   │
│  │   • /api/chats                List / create root chats       │   │
│  │   • /api/chats/:id            Get one chat + all messages    │   │
│  │   • /api/chats/:id/messages   POST → SSE stream (streamText) │   │
│  │   • /api/health               Provider status (ops)          │   │
│  └──────────────┬───────────────────────────────────────────────┘   │
└─────────────────┼───────────────────────────────────────────────────┘
                  │
        ┌─────────┼──────────┐
        │         │          │
┌───────▼─────┐  ┌▼──────────▼────────────────┐  ┌─────────────────────┐
│ Drizzle ORM │  │ Vercel AI SDK (streamText) │  │ bcrypt (cost 12)    │
│ → SQLite    │  │  → @ai-sdk/openai          │  │ (signup password    │
│   (dev)     │  │  → OpenAI-compatible       │  │  hashing)           │
│ → Postgres  │  │    (Ollama fallback)       │  │                     │
│   (prod,    │  │                            │  │ in-memory token     │
│   phase 1)  │  │                            │  │ bucket for rate     │
│             │  │                            │  │ limit (5/15min/IP)  │
└─────────────┘  └────────────────────────────┘  └─────────────────────┘
```

## Stack layers

### Frontend (Browser)

- **Next.js App Router** — page-level Server Components for the chat list (`/`) and chat view (`/chats/[id]`); Client Components only where interaction requires it (composer, buttons).
- **assistant-ui** (`@assistant-ui/react` + `@assistant-ui/ai-sdk`) — provides the chat surface: composer, message bubbles, and the streaming hook. Phase 0 uses the basic primitives; branching primitives are deferred to phase 1.
- **shadcn/ui** — accessible primitives (Button, Input, Dialog, DropdownMenu, Tooltip, Resizable) built on Radix and Tailwind, owned by Frontend. Theme tokens in `tailwind.config.ts`.
- **TanStack Query** — caches the conversation list (`/api/chats`) with a 30-second stale time so navigation between chats feels instant.

### Application server (Next.js Route Handlers)

- **`/api/auth/[...]`** — Auth.js v5 catch-all. Handles `signin`, `signout`, `csrf`, and `session`. The Credentials provider's `authorize()` looks up the user by email and verifies with `bcrypt.compare(password, user.passwordHash)`.
- **`/api/auth/signup`** — custom handler. Validates input with Zod, hashes the password, inserts the `users` row, then calls `signIn('credentials', { redirect: false })` server-side so a session row and cookie are created in one step.
- **`/api/chats`** — `GET` lists the current user's root conversations (cursor-paginated by `updatedAt`); `POST` creates a new root conversation with `parentId=null`, `depth=0`, `rootConversationId=<self>`.
- **`/api/chats/:id`** — `GET` returns the conversation meta + all messages in one response. Cross-user access returns **404**, not 403, to avoid leaking conversation IDs.
- **`/api/chats/:id/messages`** — `POST` persists the user message, calls `streamText(...)`, streams tokens via SSE (`toDataStreamResponse`), and on `onFinish` persists the assistant message. On error mid-stream, the partial assistant message is saved and the stream is closed with an error event the client renders as an inline banner with Retry.
- **`/api/health`** — returns `{ status, provider, ollamaReachable }` for DevOps to verify provider config without sending a chat.

### Data layer

- **Drizzle ORM** with the schema in `src/lib/db/schema.ts`. Dev runs against SQLite (`better-sqlite3`); production uses Postgres (phase 1 — switching the `drizzle-orm/<dialect>` import and rewriting no SQL is the goal).
- **Tables**: `users`, `accounts` (unused in phase 0, OAuth-ready), `sessions`, `verification_tokens`, `conversations`, `messages`, `providers` (no rows in phase 0; reserved for phase 3 BYOK).
- **Indexes**: `(userId, updatedAt DESC)` on `conversations` for the list query; `(conversationId, createdAt ASC)` on `messages` for thread loading; `(parentId)` and `(rootConversationId)` for the future subtree queries.

### AI layer

- **Vercel AI SDK v4** (`ai`) with **`@ai-sdk/openai`**. The `@ai-sdk/anthropic` package is installed but unwired in phase 0 — the fallback chain is intentionally simple (OpenAI → Ollama).
- **Provider selection** runs once at server boot in `src/lib/ai/provider.ts` (`getActiveProvider()`). It checks `OPENAI_API_KEY`, then `fetch(OLLAMA_BASE_URL/api/tags)` with a 2-second timeout, and falls back to `null`. The result is logged at `info` and memoised.
- **Ollama** is reached via `createOpenAICompatible` (from the `ai` package) pointed at `OLLAMA_BASE_URL` — Ollama exposes an OpenAI-shaped API.
- **Streaming**: `streamText({ model, messages, onFinish })`. The user message is inserted before the call. The `onFinish` callback persists the concatenated assistant content with `model` and `providerId`.
- **Single in-flight stream per conversation**: an in-process `Map<conversationId, AbortController>` aborts the previous stream before starting a new one (grace ≤ 100 ms), enforcing the spec rule that only one active stream per conversation exists at a time.

### Auth layer

- **Auth.js v5** with `@auth/drizzle-adapter`, **Credentials** provider only, **DB session strategy** (not JWT) so sign-out invalidates server-side.
- **Rate limit** on sign-in: in-process token bucket keyed by IP, 5 attempts / 15 min. Phase 0 keeps it in memory; phase 1 may move to Upstash Redis.
- **Session shape**: `{ user: { id, email, name, image }, expires }`. `session.user.id` is the **only** trusted join key — every query filters by it.

## Data flow

### Signup

```
Browser                          Next.js                       DB
  │ ──POST /api/auth/signup──▶  │                              │
  │   {email, password, name}    │ validate (Zod)               │
  │                             │ bcrypt.hash(password, 12)    │
  │                             │ INSERT users                 │ ─▶ users
  │                             │ signIn('credentials', …)     │
  │                             │   ↓ Auth.js                  │
  │                             │ INSERT sessions              │ ─▶ sessions
  │ ◀──201 {user} + Set-Cookie── │                              │
```

### Send a message (streaming)

```
Browser                              Next.js                       DB         AI provider
  │ ──POST /api/chats/:id/messages─▶ │                              │
  │   {content, clientMessageId}     │ auth() → session.user.id     │
  │                                  │ INSERT messages (user)       │ ─▶ messages
  │                                  │                              │
  │                                  │ streamText({ model, msgs })  │ ──▶ OpenAI/Ollama
  │                                  │ ◀──token chunks (SSE)──────  │
  │ ◀────SSE: 0:"Hello"──────────────│                              │
  │ ◀────SSE: 0:" there"─────────────│                              │
  │ ◀────SSE: d:{finishReason}───────│                              │
  │                                  │ onFinish → INSERT messages   │ ─▶ messages
  │                                  │   (assistant, full content,  │
  │                                  │    model, providerId)        │
```

### View chat list

```
Browser                                 Next.js                       DB
  │ ──GET /api/chats (cached by Q)────▶ │                              │
  │                                     │ auth() → session.user.id     │
  │                                     │ SELECT * FROM conversations  │
  │                                     │   WHERE userId=?             │
  │                                     │   ORDER BY updatedAt DESC    │
  │                                     │   LIMIT 50                   │ ─▶ conversations
  │ ◀──200 {items, nextCursor}─────────│                              │
```

## Sub-chat tree model

Conversations form a tree:
- Root conversation: `parentId = null`, `depth = 0`, `rootConversationId = self`
- Sub-chat: `parentId = <source>`, `depth = parent.depth + 1`, `rootConversationId = source.rootConversationId`
- The tree is the recursive closure of `parentId`

### Context reconstruction (sub-chats only)

When a user sends a message in a sub-chat, the server:
1. Loads the target conversation
2. Walks up the parent chain (root → ... → direct parent)
3. Verifies ownership of every ancestor (foreign-owned → 503 ANCESTOR_UNAVAILABLE)
4. Collects all messages from all ancestors in chronological order
5. Prepends a system note explaining the context
6. Passes the full array to the model

This is `O(d)` round-trips where `d = depth`. A batched query (`messages.listByConversationIds`) flattens it to `O(1)` round-trips for messages.

See `.orchestrator/specs/phase-1.md` §7 for the algorithm.

## Tree data model (phase 2)

Phase 2 adds read-only navigation over the tree: a tree-map sidebar and a split view. No schema change — everything rides on the phase 1 columns and indexes.

### Subtree fetch via `rootConversationId`

Conversations form a tree via `parentId`; every row also carries `rootConversationId` (the id of its root). This makes the whole subtree a **single indexed query** — no recursive ancestor walk:

```
SELECT id, title, depth, parentId, highlightText, createdAt
FROM conversations
WHERE rootConversationId = ? AND userId = ?   -- served by the (rootConversationId) index
ORDER BY createdAt ASC
```

Rows are assembled into a tree in memory (map `parentId` → `children`). The endpoint `GET /api/chats/:id/tree` resolves the root from `:id`'s row and returns `{ root, currentId, totalNodes, truncated }`. Trees over 500 nodes are truncated in DFS pre-order (parent before children, children by `createdAt ASC`); `truncated: true` and `totalNodes` count the FULL subtree before truncation so the UI can render "Showing 500 of N". Cross-user access returns `404 NOT_FOUND` — identical body and timing to a missing id (no existence oracle); the subtree query also filters on `userId` so foreign nodes can never enter the response. API details → the `GET /api/chats/:id/tree` entry in [endpoints.md](api/endpoints.md).

### Tree shape (depth 2)

```
                    ┌───┐  depth 0
                    │ A │  root  (parentId = null, rootConversationId = A)
                    └─┬─┘
        ┌─────────────┴─────────────┐
    ┌───┐                       ┌───┐  depth 1
    │ B │  rootConversationId=A │ C │  rootConversationId=A
    └─┬─┘  parentId=A            └───┘  parentId=A
      │
    ┌───┐  depth 2
    │ D │  rootConversationId=A, parentId=B
    └───┘

GET /api/chats/:id/tree  →  root=A
  children(B) = [D], children(A) = [B, C]   (each sorted by createdAt ASC)
  totalNodes = 4, truncated = false
  :id determines currentId;  a query for A, B, C or D returns the SAME tree
```

### Split view is client-state only

Splitting uses `react-resizable-panels`: two panes, each an independent chat view (own composer, own SSE stream, independent errors). The split lives entirely in client state (Zustand) — the URL stays on the current conversation, the right pane's id is never persisted, and a reload returns to single view. The two panes always share one root: both are conversations within the same tree, keeping the sidebar's data coherent.

## Conversation tree (phase 0 shape)

Phase 0 only ships **root** conversations — every row in `conversations` has `parentId=null`, `depth=0`, and `rootConversationId=<self>`. The schema already carries the columns phase 1 needs:

```
phase 0                          phase 1 (planned)
                                 conversations
conversations                     ┌───┐ parentId=null  (root A)
┌───┐ parentId=null                │ A │ depth=0
│ A │ depth=0                      └─┬─┘
└───┘ rootConversationId=A          ├───┐ parentId=A    (sub-chat from highlight in A)
                                       │ B │ depth=1   rootConversationId=A
                                       └───┘
```

The piece that **is not** built yet is the user-facing "branch from highlight" affordance and the tree-map sidebar — both are out of scope per phase 0 §9 and land in phases 1 and 2 respectively.

## Where branching logic will go (foreshadowing phase 1)

When sub-chat creation lands in phase 1, the changes are localised:

| concern | where it will live |
|---|---|
| "Branch from highlight" UI (select assistant text → context menu → "Branch") | `src/components/assistant-ui/branch-button.tsx` + a Radix `ContextMenu` |
| Server endpoint `POST /api/chats/:id/branch` | `src/app/api/chats/[id]/branch/route.ts` |
| Title derivation from the first user message | `src/lib/chat/title.ts` (called from the messages handler on first user turn) |
| Subtree fetch (one root, all descendants) | new helper in `src/lib/db/queries/conversations.ts` using `(rootConversationId)` |
| Tree-map visualisation | `src/components/tree/tree-map.tsx` (react-d3-tree) — phase 2 |

The DB schema needs **no migration** for phase 1 — `parentId`, `rootConversationId`, `depth`, `highlightText`, `highlightContext` are all reserved columns in phase 0.

## Security notes

- **Password storage** — bcrypt, cost 12. Never logged, never returned in API responses.
- **Cross-user isolation** — every conversation/message query filters by `session.user.id`. Cross-user access returns **404**, not 403, to prevent ID enumeration.
- **Rate limit** — sign-in is 5 attempts per 15 minutes per IP, in-memory in phase 0 (single-instance dev is fine).
- **CSRF** — Auth.js issues a CSRF token on the sign-in form; sign-out posts with that token.
- **Session** — DB-backed (not JWT) so sign-out invalidates server-side. Auth.js default 30-day lifetime.
- **Secrets at rest** — phase 0 reads provider keys from env vars only; per-user BYOK with encryption lands in phase 3.
- **No client-side provider picker** — provider config is server-boot only, so the browser never sees which provider is selected unless it calls `/api/health`.
- **Sentry** — SDK installed but inactive without `SENTRY_DSN`. Do not enable it in production until secrets handling and PII redaction are reviewed (phase 1).

## Open architectural decisions (deferred)

- **WebSocket vs SSE** — phase 0 is SSE only. WS is an option for phase 2 if we want bidirectional pushes (e.g., background tasks).
- **Optimistic message rendering** — phase 0 is server-first (the user message is only shown after persistence). Optimistic rendering lands in phase 2.
- **Postgres migration script** — phase 0 ships SQLite only. The schema is dialect-portable; the prod migration script lands in phase 1.
