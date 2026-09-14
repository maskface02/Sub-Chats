# API reference

All endpoints under `/api/`. JSON in, JSON out — except `POST /api/chats/:id/messages`, which streams SSE. Cross-user access returns `404` (not `403`) on every conversation route to prevent ID enumeration.

## Conventions

### Authentication

Authenticated routes check the Auth.js session cookie. Missing or expired session → `401 { error: { code: "UNAUTHENTICATED" } }`.

### Error envelope

Every error response uses the same shape:

```ts
type ApiError = {
  error: {
    code: ErrorCode;          // see table below
    message?: string;         // human-readable, safe to display
    fields?: Record<string, string>;  // per-field validation errors
  };
};
```

| Code | Typical status | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | No session cookie |
| `INVALID_INPUT` | 422 | Zod validation failed |
| `INVALID_CREDENTIALS` | 401 | Bad email or password |
| `EMAIL_TAKEN` | 409 | Signup email already registered |
| `RATE_LIMITED` | 429 | Hit per-user / per-IP bucket |
| `NOT_FOUND` | 404 | Resource missing OR cross-user access |
| `INVALID_SELECTION` | 422 | Branch request had a bad selection range |
| `ANCESTOR_UNAVAILABLE` | 503 | A sub-chat's parent chain is broken |
| `NO_PROVIDER` | 503 | No AI provider configured |
| `PROVIDER_FAILED` | 502 | AI provider errored mid-call |
| `INTERNAL` | 500 | Unexpected server error |

## Auth endpoints

### `POST /api/auth/signup`

Create a user, hash the password (bcrypt, cost 12), and start a session in one step.

| Auth | Body | Success | Errors |
|---|---|---|---|
| none | `{ email, password, name? }` | `201 { user: { id, email, name } }` + session cookie | `422 INVALID_INPUT`, `409 EMAIL_TAKEN`, `500 INTERNAL` |

Validation: email format; password ≥ 8 chars; name ≤ 80 chars if present.

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"hunter22long","name":"Alice"}'
```

### `POST /api/auth/signin`

Thin wrapper over the Auth.js Credentials provider. Cleaner JSON than the built-in callback.

| Auth | Body | Success | Errors |
|---|---|---|---|
| none | `{ email, password }` | `200 { ok: true }` + session cookie | `401 INVALID_CREDENTIALS`, `422 INVALID_INPUT`, `429 RATE_LIMITED` |

Rate limit: **5 failed attempts / 15 min / IP.** The response also carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` headers.

```bash
curl -X POST http://localhost:3000/api/auth/signin \
  -H 'content-type: application/json' \
  -c cookies.txt \
  -d '{"email":"alice@example.com","password":"hunter22long"}'
```

### `POST /api/auth/signout`

Invalidates the DB session row and clears the cookie.

| Auth | Success | Errors |
|---|---|---|
| session | `200 { ok: true }` | `401 UNAUTHENTICATED` |

```bash
curl -X POST http://localhost:3000/api/auth/signout -b cookies.txt
```

### `GET | POST /api/auth/[...nextauth]`

Auth.js v5 catch-all. Handles `signin`, `signout`, `csrf`, `session`, and `callback` per Auth.js conventions. Used internally by `signIn` / `signOut` client helpers; rarely called directly.

## Chat endpoints

### `GET /api/chats`

List the current user's **root** conversations, ordered by `updatedAt` desc, cursor-paginated.

| Auth | Query | Success |
|---|---|---|
| session | `cursor` (ISO timestamp), `limit` (≤ 100, default 50) | `200 { items: ChatListItem[], nextCursor: string \| null }` |

`ChatListItem`: `{ id, title, updatedAt, preview: string | null }` — `preview` is the first user message truncated to 140 chars.

```bash
curl 'http://localhost:3000/api/chats?limit=50' -b cookies.txt
```

### `POST /api/chats`

Create a **root** conversation. Sub-chats are not created here — use `POST /api/chats/:id/branch` instead.

| Auth | Body | Success | Errors |
|---|---|---|---|
| session | `{}` (no fields) | `201 Conversation` | `401 UNAUTHENTICATED` |

Response: `{ id, title: "New chat", parentId: null, rootConversationId: <self>, depth: 0, createdAt, updatedAt }`.

```bash
curl -X POST http://localhost:3000/api/chats \
  -H 'content-type: application/json' \
  -b cookies.txt -d '{}'
```

### `GET /api/chats/:id`

Read one conversation and all its messages.

| Auth | Success | Errors |
|---|---|---|
| session + owner | `200 ChatWithMessagesResponse` | `404 NOT_FOUND` (also returned for cross-user access) |

**Phase 1 addition:** the response now includes `parentTitle`, `rootTitle`, `highlightText`, `highlightContext` so the frontend can render the breadcrumb + parent-context banner without a second request. All new fields are additive — older clients keep working.

`ChatWithMessagesResponse`:

```ts
{
  id: string;
  title: string;
  parentId: string | null;          // null on root
  rootConversationId: string;      // equals id on root
  depth: number;                    // 0 on root
  highlightText: string | null;     // null on root
  highlightContext: string | null;  // null on root
  parentTitle: string | null;       // null on root (added phase 1)
  rootTitle: string | null;         // null on root (added phase 1)
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}
```

```bash
curl http://localhost:3000/api/chats/<id> -b cookies.txt
```

### `POST /api/chats/:id/messages`

Persist a user message and stream the assistant reply as SSE.

| Auth | Body | Success | Errors |
|---|---|---|---|
| session + owner | `{ content, clientMessageId? }` | `200` SSE stream (AI SDK v4 protocol) | `401`, `404`, `422 INVALID_INPUT`, `502 PROVIDER_FAILED`, `503 NO_PROVIDER`, `503 ANCESTOR_UNAVAILABLE` (sub-chat only) |

**Phase 1 addition:** when `depth ≥ 1`, the server runs the **ancestor-walk algorithm** (see [architecture.md](../architecture.md#sub-chat-tree-model)) and prepends a system note explaining the sub-chat context. The user's message is still persisted only on the sub-chat — ancestors are read but never modified.

On the first message of a conversation whose title is still `"New chat"`, the title auto-derives from the first 6 words of the user content (phase 1 closes phase 0 §10 Q1).

SSE event format (AI SDK v4 data stream):

```
0:"Hi"
0:" there"
d:{"finishReason":"stop","usage":{...}}
```

```bash
curl -N -X POST http://localhost:3000/api/chats/<id>/messages \
  -H 'content-type: application/json' \
  -H 'accept: text/event-stream' \
  -b cookies.txt \
  -d '{"content":"Hello, AI","clientMessageId":"550e8400-e29b-41d4-a716-446655440000"}'
```

### `POST /api/chats/:id/branch` *(phase 1, new)*

Create a sub-chat from a text selection in an assistant message of conversation `:id`.

| Auth | Body | Success | Errors |
|---|---|---|---|
| session + owner of `:id` | `BranchRequest` | `201 BranchResponse` | `401`, `404`, `422 INVALID_SELECTION`, `429 RATE_LIMITED`, `500 INTERNAL` |

Rate limit: **30 requests / 10 min / user** (separate from the sign-in bucket).

`BranchRequest`:

```ts
{
  messageId: string;               // uuid of the assistant message containing the selection
  selectedText: string;            // 1–2000 chars, trimmed non-empty
  charStart: number;               // 0 ≤ charStart < charEnd ≤ message.content.length
  charEnd: number;                 //   content.slice(charStart, charEnd).trim() === selectedText.trim()
  clientHighlightContext?: string; // ≤ 500 chars; optional, the client already has it
}
```

`BranchResponse`:

```ts
{
  id: string;                      // new sub-chat id
  parentId: string;                // == :id from the URL
  rootConversationId: string;      // inherited from the source
  depth: number;                   // source.depth + 1
  highlightText: string;
  highlightContext: string;        // server-built OR clientHighlightContext
  title: "New chat";
  createdAt: string;
}
```

When the client omits `clientHighlightContext`, the server builds one from the surrounding sentence(s) of the source message (capped at 500 chars).

```bash
curl -X POST http://localhost:3000/api/chats/<sourceId>/branch \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{
    "messageId": "<assistant-msg-uuid>",
    "selectedText": "vector database",
    "charStart": 142,
    "charEnd": 157,
    "clientHighlightContext": "In a RAG pipeline, a vector database stores embeddings for retrieval."
  }'
```

### `GET /api/chats/:id/tree` *(phase 2, new)*

Return the full conversation subtree rooted at `:id`'s **root** in one response — the data source for the tree-map sidebar and the split-view picker.

| Auth | Path | Success | Errors |
|---|---|---|---|
| session + owner of `:id` | `id` (uuid) | `200 TreeResponse` | `401 UNAUTHENTICATED`, `404 NOT_FOUND` (missing OR cross-user — indistinguishable), `500 INTERNAL` |

Ownership check is on the `:id` row; a subtree query additionally filters on `userId` (defense-in-depth). A query for any node in a tree returns the same subtree, with `currentId` set to the requested `:id`.

`TreeNodeDto` (recursive):

```ts
{
  id: string;
  title: string;
  depth: number;               // relative to root: root = 0
  highlightText: string | null; // always present in JSON, null when no highlight
  createdAt: string;            // ISO timestamp; used by the sidebar hover tooltip
  children: TreeNodeDto[];      // ordered by createdAt ASC
}
```

`TreeResponse`:

```ts
{
  root: TreeNodeDto;      // the root conversation of :id's tree
  currentId: string;      // == :id
  totalNodes: number;     // count of the FULL subtree BEFORE truncation
  truncated: boolean;
}
```

If the subtree exceeds 500 nodes, the response keeps the first 500 in DFS pre-order (parent before children, children in `createdAt ASC` order), sets `truncated: true`, and omits nodes beyond the cap entirely (no childless partial subtrees). Resolved with a single indexed query on `(rootConversationId, userId)` — no N+1.

```bash
curl http://localhost:3000/api/chats/<id>/tree -b cookies.txt
```

```json
{
  "root": {
    "id": "uuid-root",
    "title": "How to build a RAG system",
    "depth": 0,
    "highlightText": null,
    "createdAt": "2026-09-13T10:00:00Z",
    "children": [
      {
        "id": "uuid-sub",
        "title": "Ask about vector database",
        "depth": 1,
        "highlightText": "vector database",
        "createdAt": "2026-09-13T10:05:00Z",
        "children": []
      }
    ]
  },
  "currentId": "uuid-sub",
  "totalNodes": 2,
  "truncated": false
}
```

## Provider endpoints *(phase 3, new)*

> **Masked-key policy (normative):** no endpoint ever returns a provider's API key or ciphertext. The only key-visible field is `apiKeyHint` — the string `"…"` + the last 4 characters of the key (e.g. `"…abc1"`), or `null` when no key is stored (or the stored ciphertext no longer decrypts). Keys are encrypted at rest (AES-256-GCM, `v1:<iv>:<ciphertext>`).

### `GET /api/providers`

List the current user's provider rows (≤ 10 max).

| Auth | Success | Errors |
|---|---|---|
| session | `200 { items: ProviderItem[] }` | `401 UNAUTHENTICATED`, `500 INTERNAL` |

Not rate-limited. `ProviderItem`:

```ts
{
  id: string;
  type: "openai" | "anthropic" | "ollama" | "custom";
  baseUrl: string | null;
  defaultModel: string | null;
  isDefault: boolean;
  apiKeyHint: string | null;   // "…abc1" or null — never the key itself
  createdAt: string;           // ISO timestamp
}
```

```bash
curl http://localhost:3000/api/providers -b cookies.txt
```

### `POST /api/providers`

Add a provider. Field rules per type: `openai`/`anthropic` require `apiKey` and reject `baseUrl`; `ollama` requires `baseUrl` and rejects `apiKey`; `custom` requires `baseUrl`, `apiKey` optional.

| Auth | Body | Success | Errors |
|---|---|---|---|
| session | `{ type, baseUrl?, apiKey?, defaultModel?, isDefault? }` (zod `.strict()`) | `201 ProviderItem` (masked) | `401`, `422 INVALID_INPUT` (with `fields`), `422 PROVIDER_LIMIT`, `429 RATE_LIMITED`, `500 INTERNAL` |

Rules:

- **Limit:** 10 providers per user — an 11th create → `422 { error: { code: "PROVIDER_LIMIT", message: "You can store up to 10 providers" } }`.
- **Default:** your **first** provider is automatically the default; after that, `isDefault: true` clears the previous default (server transaction — exactly one default per user).
- **Model default:** omitted `defaultModel` applies the type default (`gpt-4o-mini`, `claude-3-5-haiku-latest`; `ollama`/`custom` require it).
- **SSRF guard:** user-supplied `baseUrl` must be `http`/`https`; `custom` baseUrls pointing at loopback/private/link-local IPs are rejected → `422 { fields: { baseUrl: "baseUrl must not point to a private address" } }`. The `ollama` type is exempt (local Ollama is its purpose).
- **Rate limit:** 30 mutation requests / 10 min / user (combined POST/PUT/DELETE) → `429 RATE_LIMITED` with `Retry-After` and `X-RateLimit-*` headers.

```bash
curl -X POST http://localhost:3000/api/providers \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{"type":"anthropic","apiKey":"sk-ant-api03-...","defaultModel":"claude-3-5-haiku-latest","isDefault":true}'
```

### `PUT /api/providers/:id`

Edit a provider. Accepts any subset of `{ baseUrl, apiKey, defaultModel, isDefault }` (`.strict()`); `type` is immutable (attempting to change it → `422 INVALID_INPUT`).

| Auth | Body | Success | Errors |
|---|---|---|---|
| session + owner | any subset of `{ baseUrl, apiKey, defaultModel, isDefault }` | `200 ProviderItem` (masked, updated) | `401`, `404 NOT_FOUND`, `422 INVALID_INPUT`, `429 RATE_LIMITED`, `500 INTERNAL` |

- A supplied `apiKey` re-encrypts and replaces the stored ciphertext (`apiKeyHint` updates); an omitted `apiKey` leaves the existing key untouched. There is no "read back the key" — see the masked-key policy above.
- `404 NOT_FOUND` is returned byte-identically for a missing id and a foreign-owned row.

```bash
curl -X PUT http://localhost:3000/api/providers/<id> \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{"isDefault":true,"defaultModel":"claude-sonnet-4-20250514"}'
```

### `DELETE /api/providers/:id`

| Auth | Success | Errors |
|---|---|---|
| session + owner | `204` (no body) | `401`, `404 NOT_FOUND`, `429 RATE_LIMITED`, `500 INTERNAL` |

Deleting your default provider does **not** promote another row — chat resolution falls back to the server env chain (see the [resolution docs](../architecture.md#provider-resolution-phase-3)).

```bash
curl -X DELETE http://localhost:3000/api/providers/<id> -b cookies.txt
```

## Health

### `GET /api/health`

Provider status for ops, DevOps, and the "no AI provider configured" banner.

| Auth | Success |
|---|---|
| none | `200 HealthResponse` |

```ts
{
  status: "ok";
  provider: {
    type: "openai" | "anthropic" | "ollama" | null,
    model: string | null,
    baseUrl: string | null,
    // phase 3: resolution for the CURRENT session's user (null when unauthenticated)
    source: "user" | "env" | null,
  };
  ollamaReachable: boolean;
}
```

```bash
curl http://localhost:3000/api/health
```

## See also

- Architecture → [architecture.md](../architecture.md)
- Local setup → [getting-started.md](../getting-started.md)
- Phase 1 spec → `.orchestrator/specs/phase-1.md`
- Phase 2 spec → `.orchestrator/specs/phase-2.md`
- Phase 3 spec → `.orchestrator/specs/phase-3.md`
- Phase 2 handoff → `.orchestrator/handoffs/tech-writer-phase-2.md`
- Phase 0 API handoff → `.orchestrator/handoffs/api-phase-0.md`