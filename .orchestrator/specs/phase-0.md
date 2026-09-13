# Phase 0 Spec — Setup + Root Chat End-to-End

**status:** frozen
**frozen_on:** 2026-09-13
**frozen_revision:** 2 (4 PM fixes applied by Orchestrator per Reviewer verdict)
**owner:** PM
**orchestrator_decisions_on_open_questions:** see `.orchestrator/decisions/phase-0-open-questions.md`

## 1. Phase overview

Phase 0 establishes the foundation: a Next.js 15 app where a signed-in user can hold a real, persistent, streamed AI conversation. It proves the stack (Next.js + Drizzle + Auth.js v5 + Vercel AI SDK + assistant-ui + shadcn/ui) works end-to-end before branching lands. The DB schema reserves space for branching (`parentId`, `highlightText`, `highlightContext`) so phase 1 does not require a migration. Auth is the simplest viable path (email + password with bcrypt) to avoid SMTP setup in dev. AI provider selection is automatic via a fallback chain (OpenAI → Ollama → visible error); multi-provider and custom-provider UI are deferred to phase 3. Tree-map, split view, and sub-chat creation are explicitly out of scope.

## 2. User stories

### US-001: Sign up

**as a** new visitor
**i want** to create an account with email and password
**so that** my conversations are saved and isolated from other users.

### acceptance criteria
- [ ] AC.1: the system shows a `/signup` page with email, password, confirm-password fields.
- [ ] AC.2: the user submits valid email + password (≥8 chars) + matching confirmation; the system creates a `users` row, hashes the password with bcrypt (cost 12), and signs the user in within 1s.
- [ ] AC.3: the system rejects invalid email with inline message "Enter a valid email" and rejects passwords <8 chars with "Use at least 8 characters".
- [ ] AC.4: the system rejects mismatched confirm-password with "Passwords do not match".
- [ ] AC.5: the system rejects duplicate email with "An account already exists for this email".
- [ ] AC.6: after successful signup the user is redirected to `/` (chat list).

### states
- empty: form rendered with empty fields and disabled submit button.
- loading: submit button shows spinner + "Creating account…"; inputs disabled.
- error: inline field errors appear beneath the offending input; submit button re-enabled.
- success: redirect to `/` within 1s.

### out of scope
- email verification
- OAuth providers
- password reset
- social signup

### dependencies
- depends on: US-002 (sign-in shares same credentials table)
- blocks: US-003 (sign out), US-004 (create conversation)

### a11y notes
- keyboard: Tab order email → password → confirm → submit; Enter on any field submits.
- screen reader: each field has associated `<label>`; error text linked via `aria-describedby`.
- contrast: form text and error text meet WCAG AA against background.

---

### US-002: Sign in

**as a** returning user
**i want** to sign in with my email and password
**so that** I can access my saved conversations.

### acceptance criteria
- [ ] AC.1: the system shows a `/signin` page with email + password fields.
- [ ] AC.2: the user submits correct credentials; the system creates an Auth.js session cookie and redirects to `/` within 1s.
- [ ] AC.3: the system rejects wrong credentials with "Invalid email or password" (single message — does not leak which field was wrong).
- [ ] AC.4: rate limit: after 5 failed attempts within 15 min from the same IP, the next attempt returns "Too many attempts. Try again in 15 minutes" for 15 min.
- [ ] AC.5: a signed-in user visiting `/signin` is redirected to `/`.

### states
- empty: form rendered with empty fields.
- loading: submit button shows spinner + "Signing in…"; inputs disabled.
- error: form-level error message appears above the form; submit re-enabled.
- success: redirect to `/` (or to `?callbackUrl` if present and same-origin).

### out of scope
- SSO, OAuth
- magic link email
- remember-me toggle (Auth.js default 30-day session is fine)
- MFA

### dependencies
- depends on: US-001
- blocks: US-003, all authenticated routes

### a11y notes
- keyboard: Enter submits; Tab order email → password → submit.
- screen reader: form errors announced via `role="alert"`.
- contrast: meets WCAG AA.

---

### US-003: Sign out

**as a** signed-in user
**i want** to sign out from any page
**so that** my session ends and no one else on this device can access my chats.

### acceptance criteria
- [ ] AC.1: a "Sign out" button is visible in the top-right user menu on every authenticated page.
- [ ] AC.2: clicking "Sign out" clears the Auth.js session cookie and redirects to `/signin` within 1s.
- [ ] AC.3: visiting any authenticated route after sign-out redirects to `/signin` with `?callbackUrl=<original>`.

### states
- loading: button shows spinner while session is being cleared.
- error: if clearing fails, show toast "Could not sign out — try again" and keep button enabled.
- success: redirect to `/signin`.

### out of scope
- sign-out from all devices (single-session only)
- account deletion

### dependencies
- depends on: US-002
- blocks: nothing

### a11y notes
- keyboard: button is keyboard-focusable; Enter/Space activates.
- screen reader: button has aria-label "Sign out".
- contrast: meets WCAG AA.

---

### US-004: Create root conversation

**as a** signed-in user
**i want** to start a new chat
**so that** I can ask the AI a question and have it saved.

### acceptance criteria
- [ ] AC.1: an unauthenticated visit to `/` redirects to `/signin`.
- [ ] AC.2: a "New chat" button is visible on the chat-list page and on any empty chat route.
- [ ] AC.3: clicking "New chat" creates a `conversations` row with `userId=<current>`, `parentId=null`, `rootConversationId=<self>`, `depth=0`, `highlightText=null`, `highlightContext=null`, `title="New chat"`; redirects to `/chats/<id>` within 500ms.
- [ ] AC.4: the created conversation is owned by the current user (server validates `session.user.id === conversation.userId`).

### states
- empty: "New chat" button on empty chat-list page.
- loading: button shows spinner while the row is being inserted.
- error: toast "Could not create chat — try again" with retry; button re-enabled.
- success: navigate to `/chats/<id>` and the empty-thread view appears.

### out of scope
- setting custom title at creation (title auto-derives from first message in phase 1)
- creating sub-chats (phase 1)
- importing conversations

### dependencies
- depends on: US-002
- blocks: US-005, US-007

### a11y notes
- keyboard: button focusable via Tab; Enter/Space activates.
- screen reader: button label "New chat".
- contrast: meets WCAG AA.

---

### US-005: Send message + stream AI response

**as a** signed-in user viewing a conversation
**i want** to type a message and see a streamed AI reply
**so that** I get fast, conversational responses.

### acceptance criteria
- [ ] AC.1: the chat view shows a composer (textarea + send button) at the bottom and the message history above it.
- [ ] AC.2: the user types a non-empty message (≤8 000 chars) and presses Enter (Shift+Enter inserts newline); the message is sent to `POST /api/chats/<id>/messages`.
- [ ] AC.3: the user's message is persisted with `role='user'`, `conversationId=<id>`, `content=<text>` before the AI request begins.
- [ ] AC.4: the server streams an assistant token stream back via Server-Sent Events using the Vercel AI SDK `streamText`. The first token appears in the UI within 2s on a warm cache.
- [ ] AC.5: on stream completion the assistant message is persisted with `role='assistant'`, full concatenated content, `model=<provider-model-id>`, `providerId=<resolved-provider-id>`.
- [ ] AC.6: while streaming, the user can type the next message into the composer; it is queued and sent after the current stream ends (single in-flight stream per conversation enforced server-side).
- [ ] AC.7: if the AI provider returns an error mid-stream, the partial assistant message is saved with content up to the last successful token, and an inline error "AI stopped responding — try again" appears with a "Retry" button that re-uses the same user message.
- [ ] AC.8: the empty composer state shows placeholder "Message the AI…"; an empty submit is blocked client-side.

### states
- empty: composer visible, no messages above; prompt "Send a message to get started" in the message list area.
- loading (sending): composer disabled, "Sending…" inline under composer; user message appears immediately in the list.
- loading (streaming): assistant message bubble shows accumulating tokens with a blinking caret at the end.
- error (send): toast "Could not send — check your connection"; user message NOT persisted (transient draft kept in composer).
- error (stream): inline error banner above composer with "Retry" button; partial assistant message retained.
- success: assistant message fully rendered; composer re-enabled and empty.

### out of scope
- editing or deleting sent messages
- regenerating a response (phase 2)
- attachments, images, file uploads
- tool use / function calling
- multi-message history pagination (all messages load at once for phase 0)

### dependencies
- depends on: US-004 (conversation exists)
- blocks: US-007 (view messages)

### a11y notes
- keyboard: Enter sends, Shift+Enter newline, Tab from textarea to send button.
- screen reader: streaming updates announced via `aria-live="polite"` on the assistant message region.
- contrast: user vs assistant bubbles have distinct background colors meeting AA.

---

### US-006: View list of my conversations

**as a** signed-in user
**i want** to see all my conversations on the home page
**so that** I can return to a previous chat.

### acceptance criteria
- [ ] AC.1: `/` shows a sidebar/list of the current user's root conversations ordered by `updatedAt DESC`, with `title`, last-activity timestamp (e.g. "2 min ago"), and an unread-state placeholder (none in phase 0 — placeholder UI slot only).
- [ ] AC.2: each row links to `/chats/<id>`.
- [ ] AC.3: the list is paginated to 50 per page with a "Load more" button (page size constant; cursor pagination by `updatedAt`).
- [ ] AC.4: a user can only see their own conversations — server filters by `session.user.id`; cross-user access returns 404 (not 403, to avoid ID enumeration).
- [ ] AC.5: row click navigates within 200ms (cached list — use TanStack Query with 30s stale time).

### states
- empty: centered illustration + "No chats yet — start your first conversation" + "New chat" button.
- loading: 3 skeleton rows animate in the list area.
- error: "Could not load chats — retry" with retry button.
- success: list rendered; hover state shows subtle background change; current conversation highlighted.

### out of scope
- search across conversations
- sorting options (fixed: most-recent first)
- pinning / favoriting
- rename / delete conversation (delete is phase 1)

### dependencies
- depends on: US-004
- blocks: nothing

### a11y notes
- keyboard: list rows are `<a>` elements, Tab-navigable; current conversation has `aria-current="page"`.
- screen reader: list landmark `<nav aria-label="Conversations">`; each row announces title + relative time.
- contrast: row text + hover background meet AA.

---

### US-007: Open conversation and see all messages

**as a** signed-in user
**i want** to open a conversation from the list
**so that** I can read its full message history and continue the chat.

### acceptance criteria
- [ ] AC.1: visiting `/chats/<id>` loads the conversation and ALL its messages in one request (`GET /api/chats/<id>` returns conversation meta + messages array ordered by `createdAt ASC`).
- [ ] AC.2: messages render in order, user messages right-aligned (or distinct bubble), assistant messages left-aligned, both with timestamps on hover.
- [ ] AC.3: if the conversation belongs to another user, the API returns 404 and the UI shows "Conversation not found".
- [ ] AC.4: the route URL is shareable — opening the same URL in a new tab loads the same conversation (after sign-in if needed).
- [ ] AC.5: the conversation `<title>` is shown in the header (editable in phase 1; read-only in phase 0).

### states
- empty: conversation exists but no messages — shows "Send a message to get started" + composer.
- loading: skeleton message bubbles (3 user + 3 assistant) animate while fetching.
- error (network): "Could not load conversation — retry".
- error (not-found / 404): "Conversation not found" with link back to `/`.
- success: messages rendered, composer visible at bottom.

### out of scope
- scroll-to-bottom auto-follow during streaming (phase 0: page scrolls to bottom on first load only)
- markdown rendering (assistant content rendered as plain text with preserved newlines; rich rendering in phase 1)
- code-block syntax highlighting (phase 1)

### dependencies
- depends on: US-005 (messages exist), US-006 (link from list)
- blocks: nothing

### a11y notes
- keyboard: composer keyboard-accessible per US-005.
- screen reader: messages announced via `<article>` per message with `aria-label="User message"` / `"Assistant message"`.
- contrast: meets AA.

---

### US-008: AI provider fallback (transparent to user)

**as a** signed-in user
**i want** the chat to work without me picking a provider
**so that** I can use the app immediately.

### acceptance criteria
- [ ] AC.1: at server start, the system resolves an "active provider" using this order:
  1. `OPENAI_API_KEY` set → use `@ai-sdk/openai` with `gpt-4o-mini`.
  2. else `OLLAMA_BASE_URL` reachable (GET `/api/tags` returns 200 within 2s) → use `createOpenAICompatible` (from `ai` package) pointed at that base URL with the first available model from `/api/tags`.
  3. else → reject all chat requests with HTTP 503 + code `NO_PROVIDER`.
- [ ] AC.2: the resolution result is logged at `info` level once per server boot.
- [ ] AC.3: a `GET /api/health` endpoint returns `{ status: "ok", provider: { type, model, baseUrl? }, ollamaReachable: boolean }` so DevOps can verify config without sending a chat.
- [ ] AC.4: if a chat request fails with the resolved provider (network error or 5xx), the server returns HTTP 502 + code `PROVIDER_FAILED` and the user sees "AI provider is unreachable — check configuration".
- [ ] AC.5: the user does NOT see any provider-picker UI in phase 0.

### states
- empty (no provider configured): banner on `/signin` and `/` for signed-out/signed-in users: "No AI provider configured — set OPENAI_API_KEY or run Ollama locally".
- loading: not visible (resolution happens server-side, not per-request).
- error: per AC.4 — surfaced in chat as inline banner with retry.
- success: chat works without any user action.

### out of scope
- per-user provider selection (phase 3)
- custom base URL UI (phase 3)
- BYOK UI (phase 3)
- model picker
- Anthropic / Google providers (phase 3 — code-ready via deps but not wired)

### dependencies
- depends on: nothing (server-boot concern)
- blocks: US-005

### a11y notes
- not user-facing in success path; banner text when shown is plain prose, AA contrast.

---

## 3. Acceptance criteria (consolidated, phase-level)

Phase 0 is done when ALL of these pass:

- [ ] **AC-P0-1:** a new visitor can sign up, sign in, and sign out (US-001, US-002, US-003).
- [ ] **AC-P0-2:** a signed-in user can create a new conversation, see it in the list, and open it (US-004, US-006, US-007).
- [ ] **AC-P0-3:** a signed-in user can send a message and receive a streamed AI reply that persists to the DB (US-005).
- [ ] **AC-P0-4:** every UI surface has empty / loading / error states defined and implemented (sections above).
- [ ] **AC-P0-5:** the AI provider fallback chain works (OpenAI → Ollama → 503 with helpful message) (US-008).
- [ ] **AC-P0-6:** DB schema includes `parentId`, `highlightText`, `highlightContext`, `rootConversationId`, `depth` on `conversations` so phase 1 needs no migration (section 6).
- [ ] **AC-P0-7:** cross-user access returns 404 (not 403) for all conversation endpoints.
- [ ] **AC-P0-8:** rate limiting on sign-in (5/15min/IP) is active.
- [ ] **AC-P0-9:** `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass with zero errors.
- [ ] **AC-P0-10:** Playwright e2e covers signup → new chat → send message → reload → see messages happy path.

## 4. States (consolidated matrix)

Every UI surface has empty, loading, error, success. Summary table:

| Surface | Empty | Loading | Error | Success |
|---|---|---|---|---|
| `/signin` form | empty fields | "Signing in…" | form-level error | redirect `/` |
| `/signup` form | empty fields | "Creating account…" | per-field + form errors | redirect `/` |
| Sign-out button | n/a | spinner | toast "Could not sign out" | redirect `/signin` |
| Chat list (`/`) | "No chats yet — start your first conversation" | 3 skeleton rows | "Could not load chats — retry" | rows rendered |
| "New chat" button | visible on empty list | spinner | toast "Could not create chat" | navigate `/chats/<id>` |
| Chat thread (`/chats/<id>`) | "Send a message to get started" | 6 skeleton bubbles | "Could not load conversation" / "Conversation not found" | messages + composer |
| Composer | placeholder shown | "Sending…" / "AI responding…" | inline banner + Retry | input cleared, ready |
| No-provider banner | shown on `/signin` and `/` if `GET /api/health.provider==null` | n/a | n/a | hidden |

## 5. API surface

All routes are Next.js App Router route handlers under `src/app/api/`. All authenticated routes check `auth()` from `src/lib/auth.ts`; missing session → 401 JSON `{ error: { code: "UNAUTHENTICATED", message } }`.

### `POST /api/auth/signup`
Create account (custom — Auth.js Credentials provider does not auto-register).

**Request:**
```json
{ "email": "user@example.com", "password": "hunter22long", "name": "Optional" }
```
**Response 201:**
```json
{ "user": { "id": "uuid", "email": "user@example.com", "name": null } }
```
**Response 409:** `{ "error": { "code": "EMAIL_TAKEN", "message": "An account already exists for this email" } }`
**Response 422:** `{ "error": { "code": "INVALID_INPUT", "fields": { "email": "Enter a valid email", "password": "Use at least 8 characters" } } }`

### `POST /api/auth/signin`
Handled by Auth.js Credentials provider at `POST /api/auth/callback/credentials` (Auth.js convention). Custom thin wrapper at `/api/auth/signin` may be added for nicer error JSON shape.

**Response 401:** `{ "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password" } }`
**Response 429:** `{ "error": { "code": "RATE_LIMITED", "message": "Too many attempts. Try again in 15 minutes" } }`

### `POST /api/auth/signout`
Handled by Auth.js at `POST /api/auth/signout`.

### `GET /api/auth/[...nextauth]`
Standard Auth.js handler (providers, session, csrf).

### `GET /api/chats`
List current user's root conversations, paginated.

**Query:** `?cursor=<updatedAt-iso>&limit=50`
**Response 200:**
```json
{ "items": [ { "id": "uuid", "title": "New chat", "updatedAt": "2026-09-13T10:00:00Z", "preview": "first user message snippet" } ], "nextCursor": "2026-09-13T09:00:00Z" | null }
```

### `POST /api/chats`
Create root conversation.

**Request:** `{}`
**Response 201:**
```json
{ "id": "uuid", "title": "New chat", "parentId": null, "rootConversationId": "uuid", "depth": 0, "createdAt": "..." }
```

### `GET /api/chats/:id`
Get conversation + all messages.

**Response 200:**
```json
{ "id": "uuid", "title": "...", "parentId": null, "messages": [ { "id": "uuid", "role": "user", "content": "...", "createdAt": "..." }, { "id": "uuid", "role": "assistant", "content": "...", "model": "gpt-4o-mini", "providerId": "openai", "createdAt": "..." } ] }
```
**Response 404:** `{ "error": { "code": "NOT_FOUND" } }`

### `POST /api/chats/:id/messages`
Send a message; stream assistant response via SSE (Vercel AI SDK `streamText` → `toDataStreamResponse`).

**Request:**
```json
{ "content": "Hello, world", "clientMessageId": "uuid-for-dedupe" }
```
**Response 200:** SSE stream with AI SDK protocol (`0:"token"`, `d:{...}` etc). After stream completes, server has persisted both the user message and the assistant message.

**Response 503:** `{ "error": { "code": "NO_PROVIDER" } }`
**Response 502:** `{ "error": { "code": "PROVIDER_FAILED" } }`

### `GET /api/health`
**Response 200:**
```json
{ "status": "ok", "provider": { "type": "openai" | "ollama" | null, "model": "gpt-4o-mini" | "llama3.2:latest" | null, "baseUrl": "http://localhost:11434/v1" | null }, "ollamaReachable": true }
```

## 6. DB schema (Drizzle, SQLite dev / Postgres prod)

File: `src/lib/db/schema.ts`. Tables are ported to Postgres in prod by switching the `drizzle-orm/<dialect>` import — no SQL DDL drift.

### `users` (Auth.js + custom fields)
| col | type | notes |
|---|---|---|
| id | text PK | uuid via `crypto.randomUUID()` |
| email | text UNIQUE NOT NULL | |
| emailVerified | integer (timestamp) | nullable, Auth.js standard |
| name | text | nullable |
| image | text | nullable |
| passwordHash | text | nullable (null for OAuth users in future) |
| createdAt | integer (timestamp) NOT NULL | epoch ms |
| updatedAt | integer (timestamp) NOT NULL | epoch ms |

### `accounts` (Auth.js OAuth — schema-ready, unused in phase 0)
| col | type | notes |
|---|---|---|
| userId | text FK → users.id | |
| type | text NOT NULL | |
| provider | text NOT NULL | |
| providerAccountId | text NOT NULL | |
| refresh_token, access_token, expires_at, token_type, scope, id_token, session_state | text/integer | per Auth.js |
| PK | (provider, providerAccountId) | |

### `sessions` (Auth.js — DB strategy)
| col | type | notes |
|---|---|---|
| sessionToken | text PK | |
| userId | text FK → users.id | |
| expires | integer (timestamp) NOT NULL | |

### `verification_tokens` (Auth.js standard, reserved)
| col | type | notes |
|---|---|---|
| identifier | text | |
| token | text | |
| expires | integer | |
| PK | (identifier, token) | |

### `conversations`
| col | type | notes |
|---|---|---|
| id | text PK | uuid |
| userId | text FK → users.id NOT NULL | |
| title | text NOT NULL DEFAULT 'New chat' | |
| parentId | text FK → conversations.id | nullable — null for root |
| rootConversationId | text FK → conversations.id NOT NULL | self-ref for fast subtree queries (phase 1) |
| depth | integer NOT NULL DEFAULT 0 | 0 for root |
| highlightText | text | nullable — set when phase 1 creates sub-chats |
| highlightContext | text | nullable — surrounding sentence(s) at the highlight |
| createdAt | integer NOT NULL | |
| updatedAt | integer NOT NULL | index |

Indexes: `(userId, updatedAt DESC)`, `(parentId)`, `(rootConversationId)`.

### `messages`
| col | type | notes |
|---|---|---|
| id | text PK | uuid |
| conversationId | text FK → conversations.id NOT NULL | |
| role | text NOT NULL | enum: `user` \| `assistant` \| `system` (system unused in phase 0) |
| content | text NOT NULL | full concatenated content |
| model | text | nullable — set for assistant messages |
| providerId | text | nullable — set for assistant messages, references `providers.id` |
| createdAt | integer NOT NULL | |

Index: `(conversationId, createdAt ASC)`.

### `providers`
| col | type | notes |
|---|---|---|
| id | text PK | uuid |
| userId | text FK → users.id NOT NULL | |
| type | text NOT NULL | enum: `openai` \| `anthropic` \| `ollama` \| `custom` |
| baseUrl | text | nullable — for ollama / custom |
| apiKeyCiphertext | text | nullable — encrypted at rest with `AUTH_SECRET` (phase 3 wires BYOK; phase 0 has no per-user rows) |
| defaultModel | text | nullable |
| isDefault | integer NOT NULL DEFAULT 0 | boolean |
| createdAt | integer NOT NULL | |

**Phase 0 simplification:** no `providers` rows are created. Provider config is read from env vars at boot (US-008). Table exists so phase 3 needs no migration.

### Relations (Drizzle `relations()`)
- `users` 1—N `conversations`
- `users` 1—N `providers`
- `conversations` 1—N `messages`
- `conversations` N—1 `conversations` (parent) and N—1 `conversations` (root)

## 7. Auth flow

**Library:** `next-auth` 5.0.0-beta.25 with `@auth/drizzle-adapter`, `Credentials` provider only.

**Strategy:** database sessions (not JWT) so logout invalidates server-side and the DB stays the source of truth.

**Sign up (US-001):**
1. Client posts to `POST /api/auth/signup`.
2. Server validates with Zod, hashes password (`bcrypt`, cost 12).
3. Inserts `users` row.
4. Server creates an Auth.js session by calling `signIn('credentials', { redirect: false })` server-side with the just-created credentials — this writes a `sessions` row and sets the cookie.
5. Redirect to `/`.

**Sign in (US-002):**
1. Client posts to `POST /api/auth/callback/credentials` (Auth.js built-in).
2. `authorize()` callback looks up user by email, verifies `bcrypt.compare(password, user.passwordHash)`.
3. On success, Auth.js creates session row + cookie.
4. On failure, return `null` → Auth.js returns 401 → wrapper maps to friendly JSON.

**Sign out (US-003):**
1. Client posts `POST /api/auth/signout` with CSRF token.
2. Auth.js deletes `sessions` row + clears cookie.

**Rate limiting (US-002 AC.4):**
- In-process token bucket keyed by IP, 5 attempts / 15 min.
- Phase 0: in-memory map (acceptable for single-instance Vercel dev). Phase 1 may move to Upstash Redis.

**Session shape:**
```ts
type Session = { user: { id: string; email: string; name: string | null; image: string | null }, expires: string }
```
`session.user.id` is the join key for all queries — never trust client-supplied `userId`.

## 8. AI provider integration

**Library:** `ai` (Vercel AI SDK v4) + `@ai-sdk/openai`. Anthropic SDK present but not wired in phase 0.

**Selection logic** (run once at module init, exported as `getActiveProvider()`):
```
if env.OPENAI_API_KEY:
  return { type: 'openai', model: openai('gpt-4o-mini'), id: 'openai' }
else if await ollamaReachable(env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1'):
  models = await listOllamaModels()
  return { type: 'ollama', model: openai-compatible(firstModel), baseUrl, id: 'ollama:<model>' }
else:
  return null
```
- `ollamaReachable()` = `fetch(baseUrl + '/api/tags', { signal: 2s timeout })` returns 2xx.
- `listOllamaModels()` parses the JSON tag list; falls back to `'llama3.2'` if list is empty.

**Streaming:** `streamText({ model, messages, onFinish: async ({ text }) => persist assistant message })`. The `onFinish` callback is the only place that writes the assistant message — the user message is persisted before the call begins.

**Per-request hardening:**
- 30s per-token timeout (Vercel AI SDK `abortSignal`).
- On any thrown error during streaming, the partial assistant message is persisted with content up to the last chunk (if any) and the response is closed with an error SSE event the client renders as the inline banner.

**Single in-flight stream per conversation (US-005 AC.6):**
- Server maintains an in-process `Map<conversationId, AbortController>`.
- On request start: if a controller exists for the conversation, abort it and wait for the abort handler to clean up (≤100ms grace), then proceed.
- On stream finish / error / client disconnect: `delete` the map entry.
- The client queues further messages while a stream is active; only the most recent user message is sent after the current stream completes.

**No client-side model selection in phase 0.** Provider is server-boot determined. `GET /api/health` exposes current state for ops.

## 9. Out of scope (explicit)

The following are NOT in phase 0 and MUST NOT be built:

- **Sub-chat creation** (highlight → right-click → new sub-chat) — phase 1
- **Tree-map sidebar visualization** (react-d3-tree) — phase 2
- **Split view** (parent + sub-chat side-by-side) — phase 2
- **Multi-provider selection UI** (pick OpenAI vs Anthropic vs Ollama) — phase 3
- **Custom provider UI** (BYOK form for users) — phase 3
- **Per-user API keys / encrypted key storage** — phase 3 (schema is ready)
- **Conversation rename, delete, archive** — phase 1 (delete endpoint reserved in API surface but not implemented)
- **Message edit, regenerate, delete** — phase 2
- **Search across conversations** — phase 3
- **Markdown / code-block rendering** — phase 1 (plain text + newlines only in phase 0)
- **File / image attachments** — phase 4
- **Tool use / function calling** — phase 4
- **OAuth providers** (Google, GitHub) — phase 3
- **Email magic-link sign-in** — not selected; password is simpler for dev
- **Email verification** — phase 3
- **Password reset** — phase 3
- **MFA** — phase 4
- **Production Postgres migration script** — phase 1 (dev SQLite only in phase 0)
- **Sentry wiring** — phase 1 (SDK installed, not configured)
- **Streaming chat over WebSocket** — SSE only in phase 0
- **Optimistic message rendering** — phase 2 (server-first in phase 0)
- **Internationalization** — English only
- **Mobile-optimized layout** — desktop-first in phase 0; responsive but not tested on mobile
- **assistant-ui advanced primitives** (thread branching UI, etc.) — phase 1; in phase 0 assistant-ui is used only for the basic chat surface

## 10. Open questions (for Orchestrator / user)

1. **Conversation title at creation** — phase 0 uses placeholder "New chat"; auto-derive from first user message in phase 1, or from first message in phase 0? (Current spec: phase 0 keeps "New chat".)
2. **Ollama default model** — fallback is `llama3.2`; if user has only `mistral` installed, we pick the first from `/api/tags`. Confirm OK.
3. **OpenAI model choice** — `gpt-4o-mini` is the cheapest capable model. Confirm acceptable for dev, or pin to `gpt-4o` for parity?
4. **Sign-up fields** — current spec: email + password + optional name. Add "confirm email" field (then verify in phase 3) or skip entirely?
5. **Password complexity** — current spec: ≥8 chars. Add complexity rules (uppercase, digit, symbol) or keep lax for dev?
6. **Rate-limit scope** — current spec: 5 attempts / 15 min / IP, in-memory. Confirm OK for phase 0 single-instance deployment, or move to Upstash Redis now?
7. **assistant-ui in phase 0** — spec uses it for the basic chat surface (composer + message list). If too heavy, fallback is a custom React component using Vercel AI SDK `useChat`. Confirm.
8. **Session lifetime** — Auth.js default 30 days. Shorten to 7 days for security posture, or keep default?
9. **Deployment target** — phase 0 is dev only. Confirm we defer Vercel deployment config (vercel.json, env-var wiring) to phase 1.
10. **"Anthropic wired but unused"** — `@ai-sdk/anthropic` is in deps. Add it to the fallback chain (after OpenAI, before Ollama) now, or defer to phase 3?

## 11. Definition of done

Phase 0 is signed off when ALL boxes are checked:

### Spec hygiene
- [x] every user story uses as-a / i-want / so-that template
- [x] every AC is testable (starts with a verb, names an actor, has a measurable outcome)
- [x] every UI surface has empty / loading / error / success states
- [x] out-of-scope list is explicit and enforced
- [x] open questions listed for Orchestrator resolution before build starts

### Stack & schema
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Drizzle migrations generated and apply cleanly to a fresh SQLite DB
- [ ] `conversations` table has `parentId`, `rootConversationId`, `depth`, `highlightText`, `highlightContext` columns (phase 1 ready)
- [ ] `providers` table exists (even if empty in phase 0)

### Auth
- [ ] sign up creates user + session
- [ ] sign in returns 401 with friendly message on bad creds
- [ ] sign out clears session
- [ ] cross-user chat access returns 404
- [ ] sign-in rate limit (5/15min/IP) active and tested

### Chat
- [ ] creating a root conversation persists and navigates
- [ ] sending a message streams AI response via SSE
- [ ] user message persists before AI request
- [ ] assistant message persists on stream finish
- [ ] partial assistant message persists on stream error
- [ ] retry re-uses the same user message
- [ ] chat list shows current user's conversations only
- [ ] opening a chat loads all messages in one request

### Provider
- [ ] OpenAI selected when `OPENAI_API_KEY` set
- [ ] Ollama selected when OpenAI absent + Ollama reachable
- [ ] 503 `NO_PROVIDER` when neither available
- [ ] `/api/health` reports current provider
- [ ] no-provider banner shown on `/signin` and `/` when no provider

### Tests
- [ ] Playwright e2e: signup → new chat → send → reload → see messages
- [ ] Playwright e2e: cross-user 404
- [ ] Playwright e2e: sign-in rate limit triggers after 5 failures
- [ ] Vitest unit: provider resolution logic (OpenAI / Ollama / none)

### Docs
- [ ] `.env.example` documents required and optional vars
- [ ] README "Getting started" section runs locally with `pnpm i && pnpm db:push && pnpm dev`

### Handoffs
- [ ] spec handed to Backend, Frontend, UX, DevOps, Security, Tech Writer
- [ ] `.orchestrator/STATE.md` updated with phase 0 status = `ready_to_build`
