# Architecture

This document describes how Sub-chats is put together as of v1.0.0 (phase 5). It is intentionally textual — diagrams, conventions, and the rationale behind the layers.

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
│ → pglite    │  │  → @ai-sdk/openai          │  │ (signup password    │
│   (dev)     │  │  → OpenAI-compatible       │  │  hashing)           │
│ → Postgres  │  │    (Ollama fallback)       │  │                     │
│   (prod)    │  │                            │  │ in-memory token     │
│             │  │                            │  │ bucket for rate     │
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
- **`/api/health`** — liveness + dependency check: provider status in dev (drives the no-provider banner), the non-revealing prod contract (`dbReachable` / `providerResolved` / `migrationsApplied`) in production — see [Production topology](#production-topology-phase-5) and the [health entry](api/endpoints.md#health).

### Data layer

- **Drizzle ORM** with the schema in `src/lib/db/schema.ts`. The driver is selected at startup by the `DATABASE_URL` branch in `src/lib/db/index.ts`: pglite when unset (dev), `drizzle-orm/node-postgres` when set (production). Details → [Production topology](#production-topology-phase-5).
- **Tables**: `users`, `accounts` (unused in phase 0, OAuth-ready), `sessions`, `verification_tokens`, `conversations`, `messages`, `providers` (no rows in phase 0; reserved for phase 3 BYOK).
- **Indexes**: `(userId, updatedAt DESC)` on `conversations` for the list query; `(conversationId, createdAt ASC)` on `messages` for thread loading; `(parentId)` and `(rootConversationId)` for the future subtree queries.

### AI layer

- **Vercel AI SDK v4** (`ai`) with **`@ai-sdk/openai`** and **`@ai-sdk/anthropic`** (both wired as of phase 3). Ollama/OpenAI-compatible endpoints use `createOpenAICompatible`.
- **Provider resolution** happens **per message send** (no module init, no caching) — see [Provider resolution](#provider-resolution-phase-3) below.
- **Ollama** is reached via `createOpenAICompatible` (from the `ai` package) pointed at `OLLAMA_BASE_URL` — Ollama exposes an OpenAI-shaped API.
- **Streaming**: `streamText({ model, messages, onFinish })`. The user message is inserted before the call. The `onFinish` callback persists the concatenated assistant content with `model` and `providerId`.
- **Single in-flight stream per conversation**: an in-process `Map<conversationId, AbortController>` aborts the previous stream before starting a new one (grace ≤ 100 ms), enforcing the spec rule that only one active stream per conversation exists at a time.

### Provider resolution (phase 3)

Resolution replaces the phase-0 module-init logic and runs **per message send** with the session user id:

```
resolveProvider(userId):
  row = SELECT * FROM providers WHERE userId = userId AND isDefault = true   -- one query
  if row:
    try: decrypt(row.apiKeyCiphertext) → build client (row id as providerId)
    catch: log error, continue            -- corrupt ciphertext → fall through
  env chain: OPENAI_API_KEY → ANTHROPIC_API_KEY → reachable OLLAMA_BASE_URL → null (503)
```

- **Precedence:** the user's default provider row wins; the env chain (`env:openai` / `env:anthropic` / `env:ollama` sentinels) is the fallback for users with no rows or a corrupt row. **No automatic env failover** when the user's provider errors at send time (the response is `502 PROVIDER_FAILED`).
- **Build:** `openai` → `createOpenAI({ apiKey })`, `anthropic` → `createAnthropic({ apiKey })`, `ollama`/`custom` → openai-compatible client at the row's `baseUrl`; `defaultModel` falls back to the type default (`gpt-4o-mini`, `claude-3-5-haiku-latest`, `llama3.2`).
- At most one row per user has `isDefault = true` (server-enforced in the create/update transaction); deleting it falls back to the env chain — no auto-promotion.

### Key encryption at rest (AES-256-GCM)

- **Key source:** dedicated `ENCRYPTION_KEY` (base64, 32 bytes) if set; otherwise HKDF-SHA256 derived from `AUTH_SECRET` (`salt = "subchats-providers-v1"`, `info = "providers:apikey"`).
- **Storage format:** `v1:<iv-b64>:<ciphertext-b64>` — 12 random bytes IV per encryption, GCM ciphertext with the 16-byte auth tag appended. The `v1:` prefix allows future rotation.
- **Exposure:** plaintext keys and full ciphertext never appear in API responses, logs (pino redact list covers `*.apiKey`, `*.apiKeyCiphertext`, `*.ANTHROPIC_API_KEY`, `*.ENCRYPTION_KEY`), or errors. Reads expose only `apiKeyHint` (`…` + last 4 chars). Tampered/wrong-key ciphertexts throw on decrypt → the row is skipped and the env chain used.

### SSRF guard (custom providers)

User-supplied `baseUrl` is fetched server-side, so the `custom` type is an SSRF vector. Enforced at create, update, AND send-time resolution (re-validation mitigates DNS rebinding):

1. Scheme allowlist: `http` / `https` only.
2. Hostname/IP denylist for `custom`: loopback (127/8, ::1), private (10/8, 172.16/12, 192.168/16, fc00::/7), link-local (169.254/16, fe80::/10). Violations → `422 INVALID_INPUT`.
3. `ollama` type is **exempt** from the private-range denylist — local Ollama is its purpose (documented accept-risk in the phase-3 threat-model addendum).

### Markdown rendering

Assistant messages render with `react-markdown@^10.1.0` + `remark-gfm@^4.0.1` (no new deps) in a **safe configuration**: no `rehype-raw`, no `dangerouslySetInnerHTML` — raw HTML in AI output renders as plain text; default `urlTransform` neutralises `javascript:`/`data:` URIs; links get `target="_blank" rel="noopener noreferrer"`; images render as links (no `<img>`). User messages stay plain text with preserved newlines. Rendering happens once **after** the stream completes; during streaming the message is plain-text accumulation with a caret.

## Soft delete (phase 4)

Conversations are never hard-deleted. Deletion is a soft delete on the `conversations` table (migration `0001` — the first post-bootstrap migration):

### Columns and index

- `deleted_at` — nullable timestamptz. `NULL` = live row.
- `deleted_batch_id` — nullable text. A uuid generated per delete call; every row soft-deleted by the same delete carries the same batch id.
- The list index is swapped to a **live-only partial index**: `conversations_user_updated_live_idx ON conversations (user_id, updated_at DESC) WHERE deleted_at IS NULL` — the hot list query never scans deleted rows.

### Cascade semantics

`DELETE /api/chats/:id` soft-deletes the target **and its whole subtree** in one transaction: the subtree id set is computed from `rootConversationId`, then one `UPDATE ... SET deleted_at, deleted_batch_id WHERE deleted_at IS NULL` marks every **live** descendant. Descendants already soft-deleted by an earlier, separate delete keep their original batch id — restoring the parent does **not** resurrect them; restoring their own batch does.

### Restore by batch

`POST /api/chats/:id/restore` replays the exact batch: `UPDATE conversations SET deleted_at = NULL, deleted_batch_id = NULL WHERE deleted_batch_id = :batchId AND user_id = :userId`. Exact and idempotent (second call → `restoredCount: 0`) with no extra table.

### 404 parity

A soft-deleted conversation is indistinguishable from a missing one: **every** read and write route — list, `GET /api/chats/:id`, tree, export, message send, branch, edit, regenerate — filters `deleted_at IS NULL` or returns the same byte-identical `404 NOT_FOUND` (ownership guard parity). A soft-deleted root also 404s its descendants via the tree endpoint's root lookup.

### Truncate-on-edit

Message-level soft delete does not exist. `POST .../messages/:messageId/edit` **hard-DELETEs** message rows after the target (strictly `createdAt > target`, id tie-break) inside the same transaction that applies the edit, then re-streams. The conversation-level undo is the only safety net. The 30-day hard-purge cron for soft-deleted conversations is an ops concern, out of phase-4 scope.

## Auth layer

- **Auth.js v5** with `@auth/drizzle-adapter`, **Credentials** provider only, **DB session strategy** (not JWT) so sign-out invalidates server-side.
- **Rate limit** on sign-in: in-process token bucket keyed by IP, 5 attempts / 15 min. In-memory in v1.0.0 — a single-instance limitation documented in the [release notes](../RELEASE_NOTES.md); a shared store (Upstash Redis) is a future option, out of phase-5 scope.
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
- **Secrets at rest** — per-user provider keys are AES-256-GCM encrypted in the `providers` table (see [Key encryption](#key-encryption-at-rest-aes-256-gcm)); server keys stay in env vars only.
- **No client-side provider picker** — provider config is server-boot only, so the browser never sees which provider is selected unless it calls `/api/health`.
- **Error tracking** — Vercel built-in observability + structured pino request logging; Sentry was removed in phase-5 prep and is deliberately not re-added (see [Production topology](#production-topology-phase-5)).

## Open architectural decisions (deferred)

- **WebSocket vs SSE** — v1.0.0 is SSE only. WS remains an option if bidirectional pushes (e.g., background tasks) are ever needed.
- **Optimistic message rendering** — server-first (the user message is only shown after persistence); not scheduled.
- **Postgres migration script** — resolved in phase 5: the regenerated drizzle-kit chain + `db:migrate` shipped; see [Production topology](#production-topology-phase-5).

## Production topology (phase 5)

### Database driver switch

`src/lib/db/index.ts` branches on `DATABASE_URL` at startup:

| `DATABASE_URL` | Driver | Schema setup |
|---|---|---|
| unset | `@electric-sql/pglite` (in-process WASM Postgres) | `ensureSchema()` applies the full DDL idempotently on first use — dev only; `PGLITE_DATA_DIR` optionally persists it to disk |
| `postgres://` / `postgresql://` | `drizzle-orm/node-postgres` (`pg` Pool) | `drizzle-kit migrate` (`npm run db:migrate`) — `ensureSchema()` is never invoked on this path |

- Dev needs zero setup: no env var, no migrate step — pglite bootstraps itself.
- Production always sets `DATABASE_URL` (Vercel Postgres). The build never touches the DB: `next build` succeeds with `DATABASE_URL` set but unreachable (route handlers are not evaluated at build time).
- **Migrations:** the regenerated chain is exactly `drizzle/0000_init.sql` (full schema) + `0001` (soft-delete columns + live-only partial index); `db:migrate` is idempotent (second run applies 0 statements). Verified by a round-trip test: fresh DB → migrate → `drizzle-kit generate` produces zero new statements. `ensureSchema()` and migrations must never both manage one database.

### Health endpoint contract (prod)

`GET /api/health` in production returns:

```json
{ "status": "ok", "dbReachable": true, "providerResolved": true, "migrationsApplied": true }
```

- `200` when all three checks pass; `503` with `status: "degraded"` otherwise — post-deploy verification is one `curl -sf`.
- **Non-revealing:** booleans only — no provider names, model ids, base URLs, or connection details. Local dev keeps the richer `{ status, provider, ollamaReachable }` shape that drives the sign-in banner ([endpoints.md](api/endpoints.md#health)).

### Request logging + correlation

Every `/api/*` request is logged by pino with `requestId`, `route`, `status`, `durationMs` — plus `userId` when authenticated, omitted anonymously. `requestId` is a locally-generated UUID per request (identical behavior local + Vercel, no platform coupling — the §10 Q3 decision) and is echoed to the client in the `X-Request-Id` response header, so a user-reported bug maps to exactly one log line. The pino redact list is unchanged: no PII, keys, or secrets in logs.

### Observability choice

v1 uses Vercel's built-in observability (log drains, wall-clock metrics) plus the structured pino request log — no third-party error tracker. Sentry was removed during phase-5 prep (unused dependency; its 2 CVEs retired with it), and re-adding it would cost instrumentation work plus a new vendor/DSN surface conditioned on handler exceptions, for marginal gain at current scale. Revisit only if users report bugs that Vercel's log view cannot cluster, or fingerprint-based grouping becomes necessary. Deploy, backup/restore, rollback, and secret-rotation procedures → [docs/deploy.md](deploy.md).
