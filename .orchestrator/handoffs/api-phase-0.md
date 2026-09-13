---
handoff_id: HOFF-001
date: 2026-09-13
from_role: backend
to_role: frontend
phase: 0
priority: high
---

## what was produced

### DB / schema
- `src/lib/db/schema.ts` — Drizzle schema, 7 tables (`users`, `accounts`, `sessions`, `verification_tokens`, `conversations`, `messages`, `providers`) + relations map + inferred types (`User`, `Conversation`, `Message`, `ProviderRow`, `NewUser`, `NewConversation`, `NewMessage`).
- `src/lib/db/index.ts` — singleton Drizzle client over better-sqlite3. Reads `DATABASE_URL` (defaults to `file:./local.db`).
- `drizzle/0000_init.sql` — initial SQLite migration. All FKs and indexes per spec §6.

### Auth
- `src/lib/auth.ts` — Auth.js v5 (`next-auth@5.0.0-beta.25`) with `@auth/drizzle-adapter`. **Credentials provider only**, **DB session strategy** (`strategy: "database"`), session callback enriches `session.user.id`. Exports `auth()`, `signIn`, `signOut`, `handlers`.
- `src/lib/auth/rate-limit.ts` — in-memory token bucket, 5 attempts / 15 min / IP. Exports `checkRateLimit(ip)`, `resetRateLimit(ip)`.

### AI
- `src/lib/ai/provider.ts` — provider registry. `getActiveProvider()` resolves **once** at module init. Fallback chain: `OPENAI_API_KEY` → OpenAI (`gpt-4o-mini`) → Ollama (`createOpenAICompatible` from `ai`) → `null`. Exports `noProvider()`. Ollama reachability uses 2s timeout on `/api/tags`.
- `src/lib/ai/stream.ts` — `streamChatResponse({ conversationId, userId, userMessage, clientMessageId? })`. Persists user message **before** streaming; persists full assistant on `onFinish`; persists partial assistant on `abort` (via `onChunk` accumulation) or thrown error. Maintains `Map<conversationId, AbortController>` for single in-flight per conversation (100ms abort grace).

### API routes
- `src/app/api/auth/[...nextauth]/route.ts` — Auth.js handler (GET + POST)
- `src/app/api/auth/signup/route.ts` — POST, creates user + signs in (bcrypt cost 12)
- `src/app/api/auth/signin/route.ts` — POST, thin wrapper with rate limit + clean JSON errors
- `src/app/api/auth/signout/route.ts` — POST
- `src/app/api/chats/route.ts` — GET (list, cursor-paginated by `updatedAt`, 50/page), POST (create root conversation)
- `src/app/api/chats/[id]/route.ts` — GET (conversation + messages ordered `createdAt ASC`)
- `src/app/api/chats/[id]/messages/route.ts` — POST (streams SSE)
- `src/app/api/health/route.ts` — GET (provider status)

### Shared types
- `src/lib/types/api.ts` — zod schemas + inferred types for every request and response, error code enum, `jsonError` / `jsonRaw` helpers.

### Tests
- `tests/unit/provider.test.ts` — provider resolution (OpenAI / Ollama / none / Ollama default fallback / OpenAI preferred over Ollama / reachability)
- `tests/unit/rate-limit.test.ts` — 5 attempts blocks 6th, per-IP isolation, reset behavior
- `tests/unit/cross-user.test.ts` — cross-user 404 mapping + auth guards on routes
- `vitest.config.ts` — path alias config for `@/`

## what was accepted
- [x] types exported (`@/lib/types/api` → all DTOs)
- [x] tests added (3 files, ~14 cases)
- [x] spec items implemented: US-001, US-002, US-003, US-004, US-005, US-006, US-007, US-008 (per `.orchestrator/specs/phase-0.md` §2)
- [x] review by Backend.Critic — pending (Critic spawn after this handoff)

## spec reference
`.orchestrator/specs/phase-0.md` — sections 5 (API surface), 6 (DB schema), 7 (Auth flow), 8 (AI integration).

## API surface for Frontend

### Base
All routes under `/api/`. JSON in, JSON out (except SSE on `/api/chats/:id/messages`).

### Error envelope (every route)
```ts
type ApiError = {
  error: {
    code: ErrorCode;          // see below
    message?: string;
    fields?: Record<string, string>;  // per-field validation errors
  };
};
```
Error codes: `UNAUTHENTICATED | EMAIL_TAKEN | INVALID_INPUT | INVALID_CREDENTIALS | RATE_LIMITED | NOT_FOUND | NO_PROVIDER | PROVIDER_FAILED`.

### Auth flow — recommended client usage

```ts
// 1) SIGN UP
const res = await fetch("/api/auth/signup", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password, name? }),
});
if (res.status === 409) show("An account already exists for this email");
if (res.status === 422) {
  const { fields } = await res.json();
  // fields.email, fields.password (per-field messages)
}
if (res.status === 201) router.push("/");  // session cookie set automatically
```

```ts
// 2) SIGN IN — uses custom thin wrapper (cleaner JSON than Auth.js built-in)
const res = await fetch("/api/auth/signin", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (res.status === 401) show("Invalid email or password");
if (res.status === 429) show("Too many attempts. Try again in N minutes");
if (res.status === 200) router.push("/");
```

```ts
// 3) SIGN OUT
await fetch("/api/auth/signout", { method: "POST" });
router.push("/signin");
```

**Note:** you can also use `signIn` / `signOut` from a client component via Auth.js's React helpers, but the wrapper routes give cleaner JSON for our error UX.

### Server-side auth check (your pages / layouts)
```ts
import { auth } from "@/lib/auth";
const session = await auth();
if (!session?.user?.id) redirect("/signin?callbackUrl=/chats/abc");
const userId = session.user.id;  // UUID
```

### Chat list (US-006)
```ts
const res = await fetch("/api/chats?cursor=" + encodeURIComponent(cursor ?? "") + "&limit=50");
const { items, nextCursor } = await res.json();
// ChatListItem: { id, title, updatedAt (ISO), preview (string|null) }
```

### Create conversation (US-004)
```ts
const res = await fetch("/api/chats", { method: "POST", body: "{}" });
// 201 → { id, title: "New chat", parentId: null, rootConversationId, depth: 0, createdAt }
router.push(`/chats/${id}`);
```

### Open conversation (US-007)
```ts
const res = await fetch(`/api/chats/${id}`);
if (res.status === 404) show("Conversation not found");
const chat = await res.json();
// ChatWithMessagesResponse: { id, title, parentId, rootConversationId, depth, createdAt, updatedAt, messages[] }
// messages[i] = { id, role: "user"|"assistant"|"system", content, model?, providerId?, createdAt }
```

### Send message + stream (US-005) — chosen approach

**Decision (phase 0):** use a **custom stream client** in `src/components/chat/ChatView.tsx` (no `@ai-sdk/react` dep needed). The hook would have required adding `@ai-sdk/react` to package.json AND reshaping the request body to AI SDK's standard `{ messages: [...] }` form — but the spec defines our API as `{ content, clientMessageId }`. Custom client is simpler and matches the spec.

Reference implementation: `src/components/chat/ChatView.tsx` (the `consumeDataStream` + `handleDataStreamLine` helpers). It:
- POSTs `{ content, clientMessageId }` to `/api/chats/:id/messages`
- Reads the AI SDK v4 data-stream SSE protocol (`0:"text"`, `d:{...}`, `e:{...}` lines) via fetch + ReadableStream
- Accumulates tokens into a local `messages` array
- On `d:` (finish), marks the assistant message as complete
- On error, surfaces an "AI stopped responding — try again" inline banner; Retry re-sends the same user content (the server has already persisted the user row from the first attempt)

**Single in-flight per conversation is enforced server-side** (in `src/lib/ai/stream.ts` via an in-process `Map<conversationId, AbortController>`). The previous stream is aborted when a new one starts. The client should disable the composer while a stream is active. To queue messages while streaming, hold them locally and submit after the current stream's `d:` event fires.

### Health (US-008, for ops + UI banner)
```ts
const res = await fetch("/api/health");
const { status, provider, ollamaReachable } = await res.json();
// provider: { type: "openai"|"ollama"|null, model, baseUrl|null }
// → show "No AI provider configured" banner on /signin and / when provider.type is null
```

### Health route example curl
```bash
curl http://localhost:3000/api/health
# { "status": "ok", "provider": { "type": "openai", "model": "gpt-4o-mini", "baseUrl": null }, "ollamaReachable": false }
```

### Signup example curl
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"hunter22long","name":"Alice"}'
# 201 → { "user": { "id": "uuid", "email": "...", "name": "Alice" } }
```

### Signin example curl
```bash
curl -X POST http://localhost:3000/api/auth/signin \
  -H 'content-type: application/json' \
  -c cookies.txt \
  -d '{"email":"alice@example.com","password":"hunter22long"}'
# 200 → { "ok": true }   (cookie set)
# 401 → { "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password" } }
# 429 → { "error": { "code": "RATE_LIMITED", "message": "Too many attempts. Try again in 15 minutes" } }
```

### Create conversation example curl
```bash
curl -X POST http://localhost:3000/api/chats \
  -H 'content-type: application/json' \
  -b cookies.txt \
  -d '{}'
# 201 → { "id": "uuid", "title": "New chat", "parentId": null, "rootConversationId": "uuid", "depth": 0, "createdAt": "..." }
```

### List chats example curl
```bash
curl 'http://localhost:3000/api/chats?limit=50' -b cookies.txt
# 200 → { "items": [ { "id": "uuid", "title": "New chat", "updatedAt": "...", "preview": "..." } ], "nextCursor": null }
```

### Open chat example curl
```bash
curl http://localhost:3000/api/chats/<id> -b cookies.txt
# 200 → { id, title, parentId, rootConversationId, depth, createdAt, updatedAt, messages: [ ... ] }
# 404 → { "error": { "code": "NOT_FOUND" } }  ← returned for cross-user too (security: no enumeration)
```

### Send message example curl (SSE stream)
```bash
curl -N -X POST http://localhost:3000/api/chats/<id>/messages \
  -H 'content-type: application/json' \
  -H 'accept: text/event-stream' \
  -b cookies.txt \
  -d '{"content":"Hello, AI","clientMessageId":"550e8400-e29b-41d4-a716-446655440000"}'
# 200 → SSE stream with AI SDK protocol:
#   0:"Hi"
#   0:" there"
#   d:{"finishReason":"stop","usage":{...}}
# 503 → { "error": { "code": "NO_PROVIDER" } }
# 502 → { "error": { "code": "PROVIDER_FAILED" } }
```

## SSE event format from `streamText`

The response uses **AI SDK v4 data stream protocol** (SSE). Each line is one of:
- `0:"<text-delta>"` — token fragment from the assistant
- `0:"<text-delta>"` — more tokens
- `d:{...}` — final metadata `{ finishReason, usage }`
- `e:{...}` — error payload (rare; client should still surface the error state)
- `g:{...}` — generation annotations (unused in phase 0)

The custom client in `src/components/chat/ChatView.tsx` parses these directly. No external hook required.

**Response security headers** (set in `src/lib/ai/stream.ts`):
- `Cache-Control: no-store`
- `X-Content-Type-Options: nosniff`
- `X-Accel-Buffering: no` (disables proxy buffering so chunks reach the client immediately)

Anything not in the zod schema on the request is dropped silently — that's intentional.

## consumer notes
- Import request/response types from `@/lib/types/api`. Do NOT redefine them.
- The route handlers export `runtime = "nodejs"` — do not mark them `edge`.
- Sessions are DB-backed; SSR layouts should call `auth()` from `@/lib/auth` (NOT from `next-auth/react`).
- The cross-user 404 is **404, not 403** — match on `code === "NOT_FOUND"`, do not surface "Forbidden".
- Rate-limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`) are set on `/api/auth/signin` responses — surface them on the signin form for transparency.
- Auth.js sets `__Secure-authjs.session-token` (HTTPS) / `authjs.session-token` (HTTP) cookies automatically when signIn succeeds in the route handler. Frontend fetch with `credentials: "include"` (default) gets them for free on same-origin.
- `clientMessageId` is **optional** in phase 0 (no dedupe logic wired — reserved for phase 1).

## open changes requested
(none)

## blockers
(none — Frontend can begin once `@/lib/types/api` is imported)

## for Frontend — what you can start building immediately

1. `/signin` page → POST `/api/auth/signin`, handle 401/422/429.
2. `/signup` page → POST `/api/auth/signup`, handle 422 (per-field), 409.
3. `/` (chat list) → GET `/api/chats`, render items with TanStack Query (30s stale time per spec).
4. `/chats/:id` → GET `/api/chats/:id` + custom stream client in `src/components/chat/ChatView.tsx` against `/api/chats/:id/messages`.
5. "New chat" button → POST `/api/chats`, redirect.
6. No-provider banner → poll `GET /api/health` on mount; hide banner when `provider.type !== null`.

`assistant-ui` primitives are in `package.json` (`@assistant-ui/react`, `@assistant-ui/ai-sdk`) — use them per the spec's "use for basic chat surface" decision.

## cross-role notes

- **Security** (asked us to verify): API keys are redacted in pino logs (`src/lib/log.ts` redact list). Password hashes never returned from `authorize()`. Session shape strips provider fields.
- **DevOps** (asked us to document): env vars are in `.env.example`. No new env vars required for phase 0. `@sentry/nextjs` is in deps but unwired.
- **Tech Writer**: README run instructions are unchanged — `pnpm i && pnpm db:push && pnpm dev` (the package manager differs from `npm` but commands work identically).
- **UX**: I deferred UX to phase 1; UI surfaces are simple enough for Frontend to drive per `.orchestrator/STATE.md`.