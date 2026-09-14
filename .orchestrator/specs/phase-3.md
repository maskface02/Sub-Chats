# Phase 3 Spec — Multi-Provider + Custom Providers + Markdown Rendering

**status:** frozen
**frozen_on:** 2026-09-13
**frozen_revision:** 2 (4 Reviewer fixes applied by Orchestrator: SSRF guard, pino redact AC, hint-decrypt-failure behavior, SSRF tests in AC-P3-12; 6 open questions resolved)
**owner:** PM
**orchestrator_decisions_on_open_questions:** see `.orchestrator/decisions/phase-3-open-questions.md` (pre-freeze)
**owner:** PM
**builds_on:** `.orchestrator/specs/phase-2.md` (frozen rev 2), `.orchestrator/specs/phase-0.md` §6/§8
**handoffs_required_from:** Security (threat-model addendum: API-key storage + markdown XSS), UX (`.orchestrator/specs/ux/phase-3.md` — settings page + markdown message component contracts)
**locked_decisions:** markdown = `react-markdown@^10.1.0` + `remark-gfm@^4.0.1` (already in package.json — NO new deps); key encryption = AES-256-GCM; `providers` table already exists (phase 0 reserved it)

---

## 1. Phase overview

Phase 3 ships the three items deferred since phase 0 §9: **per-user provider management** (BYOK), **Anthropic wiring**, and **markdown rendering for assistant messages**.

Today provider selection is env-only and resolved once at module init (`getActiveProvider()` in `src/lib/ai/provider.ts`, OpenAI → Ollama → null). Phase 3 evolves resolution to **per-request**: the user's `isDefault` provider row (from the phase-0-reserved `providers` table) takes precedence; the env chain — now extended to **OpenAI → Anthropic → Ollama → null** — remains the fallback when the user has no providers. Users manage providers on a new `/settings/providers` page: add (OpenAI / Anthropic / Ollama / custom-with-baseURL), edit, delete, set default. API keys are encrypted at rest with AES-256-GCM into the existing `apiKeyCiphertext` column and are never returned by any API (masked hint only).

Separately, assistant messages render as markdown (GFM: tables, strikethrough, task lists, autolinks) with styled code blocks — no syntax-highlighting library in this phase. User messages remain plain text. XSS posture: react-markdown's default safe config only (no `rehype-raw`, no `dangerouslySetInnerHTML`, raw HTML stays disabled).

Phase 2 §10 deferred these explicitly; they are absorbed here and nowhere else (message edit/regenerate/optimize rendering remain deferred — see §11).

## 2. User stories

### US-301: Provider CRUD API

**as a** frontend developer building the settings page
**i want** list/create/update/delete endpoints for the current user's AI providers
**so that** the settings UI can manage provider rows without exposing secrets.

#### acceptance criteria
- [ ] AC.1: `GET /api/providers` requires a session (`401 { code: "UNAUTHENTICATED" }` otherwise) and returns `200 { items: [...] }` — every item is `{ id, type, baseUrl, defaultModel, isDefault, apiKeyHint, createdAt }`; `apiKeyHint` is `null` when no key is stored, else the string `"…"` + last 4 chars of the key (e.g. `"…abc1"`); the response NEVER contains `apiKeyCiphertext` or any decryptable key material.
- [ ] AC.2: `POST /api/providers` accepts `{ type, baseUrl?, apiKey?, defaultModel?, isDefault? }` validated with zod `.strict()` (unknown fields → `422 INVALID_INPUT`); `type` is the enum `openai | anthropic | ollama | custom`.
- [ ] AC.3: field rules per type — `openai`/`anthropic`: `apiKey` REQUIRED, `baseUrl` FORBIDDEN (strict reject); `ollama`: `baseUrl` REQUIRED (http/https URL, validated format), `apiKey` FORBIDDEN; `custom`: `baseUrl` REQUIRED (http/https URL), `apiKey` OPTIONAL (keyless endpoints allowed). Violations return `422 INVALID_INPUT` with a `fields` map naming the offending field.
- [ ] AC.3b: **SSRF guard (blocking)** — user-supplied `baseUrl` is fetched server-side at send time, so it is an SSRF vector. Mitigation, enforced at create AND update AND send-time resolution: (1) scheme allowlist `http`/`https` only; (2) hostname denylist for the `custom` type — reject hostnames that resolve to loopback (127.0.0.0/8, ::1), private (10/8, 172.16/12, 192.168/16, fc00::/7), or link-local (169.254/16, fe80::/10) ranges; (3) `ollama` type is EXEMPT from the private-range denylist (local Ollama is its purpose) — this exemption is a documented accept-risk recorded in the Security threat-model addendum (`.orchestrator/security/threat-models/phase-3.md`); (4) send-time re-validation of the resolved IP mitigates DNS rebinding for `custom`. Violations → `422 INVALID_INPUT` with `fields.baseUrl: "baseUrl must not point to a private address"`. Unit tests cover: private-IP custom rejected, public custom accepted, ollama-localhost accepted, non-http(s) scheme rejected.
- [ ] AC.4: on create, `apiKey` (when present) is encrypted with AES-256-GCM (§7) and stored in `apiKeyCiphertext`; the plaintext key appears in NO log, NO response, and NO error message.
- [ ] AC.5: a user is capped at 10 provider rows; an 11th create returns `422 { code: "PROVIDER_LIMIT", message: "You can store up to 10 providers" }`.
- [ ] AC.6: when `isDefault: true` is submitted, the server clears `isDefault` on all the user's other provider rows in a single transaction — at most one default per user exists at any time.
- [ ] AC.7: the user's FIRST provider row is automatically set as default (`isDefault: true`) regardless of the submitted value.
- [ ] AC.8: `PUT /api/providers/:id` accepts `{ baseUrl?, apiKey?, defaultModel?, isDefault? }` (zod `.strict()`; `type` is immutable — attempting to change it → `422 INVALID_INPUT`); a provided `apiKey` re-encrypts and replaces the ciphertext; an omitted `apiKey` leaves the existing ciphertext untouched.
- [ ] AC.9: `DELETE /api/providers/:id` returns `204`; if the deleted row was the user's default, no auto-promotion happens — resolution falls back to the env chain (US-304).
- [ ] AC.10: ownership — `PUT`/`DELETE` on a missing id OR a row owned by another user return `404 { code: "NOT_FOUND" }` (never 403; phase-1 id-enumeration guard), with byte-identical bodies.
- [ ] AC.11: mutation routes (`POST`/`PUT`/`DELETE`) are rate-limited at 30 requests / 10 min / user (combined); exceeding returns `429 { code: "RATE_LIMITED" }` with `Retry-After` and `X-RateLimit-*` headers (phase-1 pattern). `GET` is not rate-limited.
- [ ] AC.12: create/update validate `defaultModel` as a non-empty string ≤ 200 chars when present; omitting it on create applies the type default (`openai` → `gpt-4o-mini`, `anthropic` → `claude-3-5-haiku-latest`, `ollama`/`custom` → required — `422` if omitted).

#### states
- success: 200/201/204 per route.
- error (401): no session.
- error (404): missing or foreign-owned id (PUT/DELETE).
- error (422): zod violations, PROVIDER_LIMIT, missing baseUrl/model per type rules.
- error (429): rate limit exceeded.
- error (500): `{ code: "INTERNAL" }`.

#### out of scope
- provider health-check / test-connection endpoint (§11).
- sharing providers between users (never).
- `type` mutation after create.

#### dependencies
- depends on: phase 0 `providers` table (exists — no migration)
- blocks: US-303, US-304, US-306

#### a11y notes
- n/a (API); error bodies follow the phase 0 error shape so UI errors render consistently.

---

### US-302: API keys are never exposed

**as a** security-minded user
**i want** my provider API keys encrypted at rest and never returned by any endpoint
**so that** a DB leak or API response cannot leak my keys.

#### acceptance criteria
- [ ] AC.1: keys are encrypted with AES-256-GCM per §7; the ciphertext storage format is `v1:<iv-b64>:<ciphertext-b64>` where `ciphertext-b64` is GCM ciphertext with the 16-byte auth tag appended; a wrong/tampered ciphertext fails authentication on decrypt (throws — never returns partial plaintext).
- [ ] AC.2: no endpoint, log line, or error message in phase 3 contains key plaintext or full ciphertext (verified by grep over `pino` redact list + unit test asserting response bodies). The pino redact list in `src/lib/log.ts` is extended BEFORE any provider code logs: add `*.apiKey`, `*.apiKeyCiphertext`, `*.ANTHROPIC_API_KEY`, `*.ENCRYPTION_KEY` (precedent: phase-1 redact extension).
- [ ] AC.3: `apiKeyHint` (US-301 AC.1) is computed server-side by decrypting at list/update time; the hint exposes only the last 4 characters. On list-time decrypt failure for a row (corrupt or rotated ciphertext), that row's `apiKeyHint` is `null` and the failure is logged at `warn` — the row is still listed and the endpoint does not 500 (aligns with US-304 AC.4's skip-and-log pattern).
- [ ] AC.4: encrypt/decrypt round-trip and tamper-rejection are covered by unit tests, including: encrypt → decrypt equals plaintext; flip one ciphertext byte → decrypt throws; wrong key → decrypt throws.
- [ ] AC.5: if `ENCRYPTION_KEY` (or the derived key source, §7) is missing at runtime, provider create with `apiKey` fails with `500 { code: "INTERNAL" }` and a server log — the key is never stored unencrypted as a fallback.

#### states
- n/a (cross-cutting security story; verified by unit tests + code review).

#### out of scope
- key rotation UI / re-encryption migration (§11).
- envelope encryption with a KMS.

#### dependencies
- depends on: §7 encryption design
- blocks: US-301

#### a11y notes
- n/a.

---

### US-303: Set default provider

**as a** user with multiple providers
**i want** to choose which one new messages use
**so that** I control which service (and whose key) answers my chats.

#### acceptance criteria
- [ ] AC.1: the settings page shows a set-default radio (or equivalent single-select control) per provider row; selecting it calls `PUT /api/providers/:id` with `isDefault: true`.
- [ ] AC.2: after a successful set-default, exactly one row shows as default and the previous default is cleared (server-enforced per US-301 AC.6) without a page reload.
- [ ] AC.3: deleting the default provider removes the default state entirely — the UI then shows an "Using server default (environment)" indicator (US-304 fallback), not a stale highlighted row.
- [ ] AC.4: the next message sent in ANY conversation (new or existing) uses the new default immediately — no sign-out/sign-in or reload required (per-request resolution, US-304 AC.2).

#### states
- empty: no providers → row-level control absent; page shows the env-chain indicator instead.
- loading: radio shows a pending state (disabled + spinner) while the PUT is in flight.
- error: failed set-default shows an inline toast "Could not set default — try again"; the previously selected radio remains active.
- success: new default highlighted; `role="status"` announcement "Default provider set to <type>".

#### out of scope
- per-conversation provider override (§11).
- auto-promote another provider on default deletion (US-301 AC.9).

#### dependencies
- depends on: US-301, US-306
- blocks: nothing

#### a11y notes
- keyboard: radio group is arrow-key navigable per WAI-ARIA radio pattern; `Space` selects.
- screen reader: group has `aria-label="Default provider"`; selection change announced via `role="status"`.
- contrast: selected state uses border + weight, not color alone.

---

### US-304: Per-user provider resolution precedence

**as a** signed-in user with a default provider
**i want** my chats to use MY provider when I send a message
**so that** my key and my chosen service are used instead of the server's env fallback.

#### acceptance criteria
- [ ] AC.1: `getActiveProvider()` resolution order per request: (1) the user's provider row with `isDefault = true` (single indexed lookup by `userId` — table is ≤ 10 rows/user, a `userId`-filtered scan suffices; no new index required), else (2) env chain: `OPENAI_API_KEY` → `ANTHROPIC_API_KEY` → reachable `OLLAMA_BASE_URL` → null (`503 NO_PROVIDER`).
- [ ] AC.2: resolution happens PER REQUEST (per message send), not at module init; the module-init-only behavior of phase 0 is removed. The lookup is one query by `(userId, isDefault)` — cheap; no caching layer in phase 3.
- [ ] AC.3: when the user's default row is type `ollama` or `custom`, the provider is built from the row's `baseUrl` (openai-compatible client for both); when `openai`/`anthropic`, from the decrypted `apiKeyCiphertext` via `createOpenai`/`createAnthropic({ apiKey })`; `defaultModel` from the row is the model id (falling back to the type default of US-301 AC.12 when null).
- [ ] AC.4: decryption failure of a stored ciphertext (corrupt row / rotated secret) logs at `error` level, skips the user row, and falls through to the env chain — the message send does not crash.
- [ ] AC.5: a user with NO provider rows gets the env chain exactly as in phases 0–2 (behavior change: none for them, other than Anthropic joining the chain — US-305).
- [ ] AC.6: assistant messages persist `model` + `providerId` (the provider ROW id when user-resolved; `"env:openai"` / `"env:anthropic"` / `"env:ollama"` sentinel strings for env-chain resolution) so provenance stays auditable.
- [ ] AC.7: `GET /api/health` extends its `provider` object with `source: "user" | "env" | null` — reporting the resolution for the CURRENT session's user (null when unauthenticated), plus the existing `type`/`model`/`baseUrl` fields.

#### states
- success: message streams from the resolved provider.
- error (no provider anywhere): `503 NO_PROVIDER` (unchanged phase 0 behavior).
- error (user provider unreachable/5xx): `502 PROVIDER_FAILED` (unchanged phase 0 behavior); no automatic failover to env chain mid-request.

#### out of scope
- automatic env fallback when the user's provider errors at send time (explicit failover is §11 — silent failover to a different key owner is a surprise, not a feature).
- caching resolved providers across requests.

#### dependencies
- depends on: US-301, US-302
- blocks: US-305

#### a11y notes
- n/a (server-side); error copy unchanged from phase 0 (AA contrast).

---

### US-305: Anthropic wiring (provider type + env chain)

**as a** user who prefers Claude
**i want** Anthropic as a selectable provider type and as an env fallback
**so that** I can use my Anthropic key.

#### acceptance criteria
- [ ] AC.1: provider type `anthropic` is fully wired: `@ai-sdk/anthropic` (already a dependency, currently unwired) via `createAnthropic({ apiKey })`; default model `claude-3-5-haiku-latest` (US-301 AC.12).
- [ ] AC.2: the env fallback chain becomes `OPENAI_API_KEY` → `ANTHROPIC_API_KEY` → Ollama (reachable check per phase 0 §8) → null. Anthropic env resolution is logged at `info` level like the others.
- [ ] AC.3: sub-chat system-prompt handling (phase 1 context note) and streaming behavior are identical across all four provider types — no provider-specific branching outside the client-construction layer.
- [ ] AC.4: `GET /api/health` reports `type: "anthropic"` when the env chain resolves to it; `ollamaReachable` field unchanged.
- [ ] AC.5: unit tests cover chain ordering: OpenAI+Anthropic env both set → OpenAI wins; only Anthropic set → Anthropic; neither → Ollama check.

#### states
- success: identical chat UX on Anthropic.
- error: provider errors surface as the existing `502 PROVIDER_FAILED` inline banner regardless of provider type.

#### out of scope
- Google/Gemini, Azure OpenAI, Bedrock (§11).
- model listing / per-provider model catalog UI.

#### dependencies
- depends on: US-304
- blocks: nothing

#### a11y notes
- n/a.

---

### US-306: Provider settings page (`/settings/providers`)

**as a** signed-in user
**i want** a page to add, edit, delete, and rank my AI providers
**so that** I manage my own keys without touching server config.

#### acceptance criteria
- [ ] AC.1: a `/settings/providers` route shows the user's provider list (from `GET /api/providers`) with per-row: type badge, `baseUrl` (when present), `defaultModel`, `apiKeyHint` (masked, e.g. `…abc1`), default radio (US-303), edit, and delete controls.
- [ ] AC.2: an "Add provider" form with a type select (openai / anthropic / ollama / custom) and CONDITIONAL fields per US-301 AC.3: `baseUrl` shown for ollama/custom, `apiKey` shown for openai/anthropic/custom, `defaultModel` shown for all (placeholder communicates the type default). Field visibility updates immediately on type change; hidden fields are not submitted.
- [ ] AC.3: the `apiKey` input is `type="password"` with autocomplete="off", never pre-filled on edit (edit shows the masked hint instead; submitting an empty apiKey field on edit = "keep existing key").
- [ ] AC.4: edit opens an inline/inline-dialog form per row pre-filled with `baseUrl`/`defaultModel` (NOT the key); delete shows a confirm step ("Delete provider <type>? Chats will fall back to the server default.") before calling DELETE.
- [ ] AC.5: the page is linked from the user menu (header) as "Provider settings"; unauthenticated visits redirect to `/signin?callbackUrl=/settings/providers`.
- [ ] AC.6: client-side validation mirrors US-301 AC.3 rules (required fields, http/https URL format for baseUrl) with inline field errors before submit; server `422` responses map onto the same field errors.
- [ ] AC.7: after any successful create/edit/delete/set-default the list refetches and reflects the new state within 300ms (no manual reload).

#### states
- empty: no providers → "No custom providers. You're using the server default (environment)." + "Add provider" button.
- loading: 2 skeleton rows while `GET /api/providers` is in flight.
- error (load): "Could not load providers — Retry" with retry button.
- error (save): inline field errors (422) or toast "Could not save provider — try again" (5xx); form stays filled.
- error (delete): toast "Could not delete provider — try again"; row remains.
- success: list + forms reflect changes; success toasts on create/edit/delete ("Provider added", etc.).
- limit: at 10 providers the "Add provider" button is disabled with helper text "Provider limit reached (10)".

#### out of scope
- test-connection button (§11).
- usage/cost tracking per key (§11).
- copying the full key out of the UI (impossible by design — server never returns it).

#### dependencies
- depends on: US-301, US-302
- blocks: US-303, US-309

#### a11y notes
- keyboard: full form + list operable by keyboard; Tab order: list rows → add form → page nav.
- screen reader: conditional-field changes announced via `role="status"`; errors linked to inputs via `aria-describedby`; delete-confirm is a `role="dialog"` with focus trap and `Esc` = cancel.
- contrast: masked hints, badges, and all state text meet WCAG AA.

---

### US-307: Markdown rendering for assistant messages

**as a** user chatting with the AI
**i want** assistant replies to render markdown (headings, lists, tables, code)
**so that** structured answers are readable instead of a wall of `#` and `|` characters.

#### acceptance criteria
- [ ] AC.1: assistant messages render with `react-markdown@^10.1.0` + `remark-gfm@^4.0.1` — GFM tables, strikethrough (`~~x~~`), task lists (`- [x]`), and autolinks render correctly.
- [ ] AC.2: the renderer is configured with NO `rehype-raw` (or any raw-HTML pass) and does not use `dangerouslySetInnerHTML` anywhere in the message component; raw HTML in AI output (e.g. `<img onerror=…>`, `<script>`) renders as plain TEXT, never as elements.
- [ ] AC.3: links render with `target="_blank"` and `rel="noopener noreferrer"`; URLs are passed through react-markdown's default `urlTransform` (safe schemes only — `javascript:`/`data:` URIs in links are neutralized).
- [ ] AC.4: images in AI output do NOT render as `<img>` (phase 3); they render as plain links with the image URL as link text (tracking-pixel / mixed-content guard — see §12 OQ-3).
- [ ] AC.5: user messages render as PLAIN TEXT with preserved newlines — no markdown parsing for user content (markdown-injection and UI-spoofing guard, e.g. a user cannot fake an "assistant system banner" with heading/table syntax).
- [ ] AC.6: markdown rendering applies to historical messages AND to streamed messages AFTER the stream completes (loading/streaming states unchanged from phase 1 — see §12 OQ-1 for progressive rendering).
- [ ] AC.7: rendering performance: a conversation with 100 markdown-heavy assistant messages renders without blocking input (rendered lazily or memoized per message; no full re-parse of all messages on each new token).

#### states
- empty: n/a (message list states unchanged from phase 0/1).
- loading/streaming: unchanged phase 1 streaming behavior (plain-text accumulation with caret) — markdown kicks in at completion per AC.6.
- error: unchanged phase 1 stream-error inline banner (renders as plain text, not markdown).
- success: fully rendered markdown per AC.1–5.

#### out of scope
- progressive/streaming markdown (§12 OQ-1).
- syntax highlighting library (§11).
- math (KaTeX), mermaid diagrams, footnotes beyond GFM.

#### dependencies
- depends on: nothing new (message component from phase 0/1)
- blocks: US-308

#### a11y notes
- screen reader: markdown output is real semantic HTML (`h1–h4`, `ul/ol/li`, `table` with `th`) — announced with correct structure, not raw asterisks/pipes.
- headings inside messages must not pollute the page outline: message-internal headings styled but excluded from `document` landmark structure (no `id` collisions; heading levels start at `h3` equivalent styling, see §9).
- contrast: code blocks, tables, and blockquotes meet WCAG AA in both themes.

---

### US-308: Code block rendering

**as a** user reading code in replies
**i want** fenced code blocks visually distinct with a language label and horizontal scroll
**so that** code is easy to identify and copy without breaking the chat layout.

#### acceptance criteria
- [ ] AC.1: fenced code blocks (```) render as styled `<pre><code>` blocks with a header bar showing the language (e.g. `python`) or `code` when unlabeled.
- [ ] AC.2: NO syntax-highlighting library in phase 3 (no rehype-highlight, no shiki) — code text renders in a monospace stack with theme-aware block colors; token-level color classes are deferred (§12 OQ-4).
- [ ] AC.3: long lines scroll horizontally within the block (the code block never widens the chat column or the split-view pane); the block has a visible focus/scroll affordance and is keyboard-scrollable (focusable `pre` with `tabindex="0"`).
- [ ] AC.4: a "Copy" button on the block header copies the RAW code text to the clipboard and shows "Copied" feedback for ~1.5s; it works with keyboard (`Enter`/`Space`).
- [ ] AC.5: inline code (`` `x` ``) renders as styled inline `<code>` distinct from body text and from block code.

#### states
- success: blocks render per AC.1–5.
- error: n/a (rendering is synchronous post-stream; a markdown parse failure degrades to plain text — the message is never dropped).
- empty/loading: n/a (covered by US-307).

#### out of scope
- syntax highlighting (§11).
- line numbers.
- language-aware copy (copy-with-format), "wrap lines" toggle.

#### dependencies
- depends on: US-307
- blocks: nothing

#### a11y notes
- keyboard: copy button focusable, `Esc` does not trap; scrollable `pre` is arrow-key scrollable when focused.
- screen reader: code block announced as region with label "<language> code"; copy button `aria-label="Copy code"`.
- contrast: code text vs block background meets AA in both themes.

---

### US-309: Keyboard & screen-reader parity for phase 3 surfaces

**as a** keyboard-only or screen-reader user
**i want** the settings page and markdown-rendered messages fully operable without a mouse
**so that** provider management and reading replies don't exclude me.

#### acceptance criteria
- [ ] AC.1: every phase 3 interaction is completable with keyboard only: add/edit/delete provider (US-306), set default (US-303), copy code (US-308), navigate links in markdown (US-307).
- [ ] AC.2: all phase 3 async states are announced: settings load via `aria-busy="true"`; save/delete/success/error toasts via `role="status"` or `role="alert"` as appropriate; markdown streaming completion needs no announcement beyond the existing phase 1 `aria-live` region.
- [ ] AC.3: `prefers-reduced-motion: reduce` disables any settings-page transition animations (toasts, dialogs appear instantly).
- [ ] AC.4: focus management: after create/cancel of the add form, focus returns to a logical anchor (the new row's edit control, or the "Add provider" button on cancel); after delete-confirm closes, focus moves to the next row's controls (or the empty state).
- [ ] AC.5: markdown-rendered links are visually distinct by MORE than color (underline) in both themes.

#### states
- all states per underlying surface; this story is a cross-cutting QA checklist.

#### out of scope
- voice-control / switch-access testing beyond standard ARIA semantics.

#### dependencies
- depends on: US-303, US-306, US-307, US-308
- blocks: nothing

#### a11y notes
- this story IS the a11y consolidation; per-story a11y notes remain authoritative for implementation detail.

## 3. Acceptance criteria (consolidated, phase-level)

Phase 3 is done when ALL of these pass:

- [ ] **AC-P3-1:** provider CRUD works end-to-end: create (per-type field rules, strict zod), list (masked keys only), update (key re-encrypt only when supplied), delete (204) — with the exact §5 shapes (US-301).
- [ ] **AC-P3-2:** 10-provider cap enforced with `422 PROVIDER_LIMIT`; mutation rate limit 30/10min/user returns 429 with phase-1 headers (US-301 AC.5, AC.11).
- [ ] **AC-P3-3:** cross-user PUT/DELETE return 404 byte-identical to missing-id 404 (US-301 AC.10).
- [ ] **AC-P3-4:** API keys are AES-256-GCM encrypted at rest in `v1:<iv-b64>:<ciphertext-b64>` format; plaintext/ciphertext never in responses or logs; tamper rejection unit-tested (US-302).
- [ ] **AC-P3-5:** exactly one default provider per user at any time; first provider auto-defaults (US-301 AC.6–7).
- [ ] **AC-P3-6:** message send resolution: user default row → env chain (OpenAI → Anthropic → Ollama) → 503, resolved per request; no module-init resolution remains (US-304 AC.1–2).
- [ ] **AC-P3-7:** anthropic type wired end-to-end (user rows + env chain) and chain-order unit tested (US-305).
- [ ] **AC-P3-8:** assistant messages render GFM markdown; raw HTML renders as text; links open safely; images render as links; user messages stay plain text (US-307).
- [ ] **AC-P3-9:** code blocks render with language label, copy button, horizontal scroll, no highlighting lib (US-308).
- [ ] **AC-P3-10:** `/settings/providers` implements all §4 states, is linked from the user menu, and refetches after every mutation (US-306).
- [ ] **AC-P3-11:** every phase 3 surface has empty/loading/error/success states per §4; all US-309 a11y ACs pass as a QA checklist.
- [ ] **AC-P3-12:** `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` pass with zero errors; unit tests cover encryption round-trip/tamper, resolution precedence (user/env/none, per-type), chain ordering, API ownership (404 parity), AND SSRF guard (private-IP custom rejected, public custom accepted, ollama-localhost accepted, non-http(s) scheme rejected, send-time re-validation).
- [ ] **AC-P3-13:** Playwright e2e covers: add provider → set default → send message (uses it, verified via persisted `providerId`) → delete provider → next message falls back to env; and settings-page keyboard-only add-provider flow.
- [ ] **AC-P3-14:** Playwright e2e covers markdown: assistant fixture with table/code/link/raw-HTML renders table+code+safe link and renders raw HTML as text.
- [ ] **AC-P3-15:** NO new dependencies (react-markdown + remark-gfm already present); NO DB migration (§6).

## 4. States (consolidated matrix)

| Surface | Empty | Loading | Error | Success |
|---|---|---|---|---|
| Provider endpoints (US-301) | `items: []` | n/a | 401 / 404 / 422 / 429 / 500 bodies | 200/201/204 |
| Settings page list (US-306) | "No custom providers…" + Add button | 2 skeleton rows | "Could not load — Retry" | rows + env-fallback indicator when no default |
| Add/edit provider form (US-306) | type select, conditional fields empty | submit spinner "Saving…" | inline field errors / toast | toast + list refetch |
| Set default radio (US-303) | absent when no rows | radio pending spinner | toast, previous selection kept | new default highlighted + `role="status"` |
| Delete confirm (US-306) | n/a | n/a | toast, row remains | row removed + toast |
| Message markdown (US-307) | n/a | unchanged phase 1 streaming | unchanged inline stream error (plain text) | rendered markdown |
| Code block (US-308) | n/a | n/a | parse failure → plain text degrade | styled block + copy feedback |
| `GET /api/health` (US-304) | provider null → existing no-provider banner | n/a | n/a | `source` field added |

## 5. API surface

All routes under `src/app/api/`, error shape per phase 0 (`{ error: { code, message?, fields? } }`), `auth()` required on all.

### `GET /api/providers` (NEW)
**Response 200:**
```json
{ "items": [
  { "id": "uuid", "type": "openai", "baseUrl": null, "defaultModel": "gpt-4o-mini",
    "isDefault": true, "apiKeyHint": "…abc1", "createdAt": "2026-09-14T10:00:00Z" },
  { "id": "uuid", "type": "ollama", "baseUrl": "http://localhost:11434/v1", "defaultModel": "llama3.2",
    "isDefault": false, "apiKeyHint": null, "createdAt": "2026-09-14T10:05:00Z" }
] }
```
**Errors:** `401 UNAUTHENTICATED` · `500 INTERNAL`. (No rate limit.)

### `POST /api/providers` (NEW)
**Request:** `{ "type": "anthropic", "apiKey": "sk-ant-…", "defaultModel": "claude-3-5-haiku-latest", "isDefault": true }` — zod `.strict()`.
**Response 201:** single masked item, same shape as a `GET` item.
**Errors:** `401` · `422 INVALID_INPUT` (with `fields`) · `422 PROVIDER_LIMIT` · `429 RATE_LIMITED` (+ `Retry-After`, `X-RateLimit-*`) · `500 INTERNAL`.

### `PUT /api/providers/:id` (NEW)
**Request:** any subset of `{ baseUrl, apiKey, defaultModel, isDefault }` — `.strict()`; `type` immutable.
**Response 200:** masked item (updated). `apiKeyHint` reflects a newly supplied key.
**Errors:** `401` · `404 NOT_FOUND` (missing or foreign) · `422 INVALID_INPUT` · `429` · `500`.

### `DELETE /api/providers/:id` (NEW)
**Response 204:** no body.
**Errors:** `401` · `404 NOT_FOUND` · `429` · `500`.

### `POST /api/chats/:id/messages` (UNCHANGED contract)
No new fields (the per-conversation `model` override was rejected in the brief). Resolution is server-side per US-304. `providerId` on persisted assistant messages now takes the provider row id or an `env:*` sentinel (US-304 AC.6).

### `GET /api/health` (EXTENDED)
`provider` object gains `source: "user" | "env" | null` (session user's resolution; `null` when unauthenticated). Existing fields unchanged.

### Existing routes
No other contract changes.

## 6. DB changes

**None.** Verified against `src/lib/db/schema.ts:127`: `providers` already has all 8 columns — `id`, `userId` (FK cascade), `type` (4-value enum), `baseUrl`, `apiKeyCiphertext`, `defaultModel`, `isDefault` (boolean, default false), `createdAt`. No migration, no new table, no new column, no new index (max 10 rows per user makes a `(userId, isDefault)` index unnecessary — a userId-filtered scan is the resolution query, US-304 AC.1).

## 7. Encryption design (AES-256-GCM)

- **Key source:** dedicated `ENCRYPTION_KEY` env (base64, 32 bytes) if set; otherwise derived from `AUTH_SECRET` via HKDF-SHA256 (`salt = "subchats-providers-v1"`, `info = "providers:apikey"`, 32-byte output). Derivation (not raw reuse) prevents key-purpose bleed if AUTH_SECRET is ever rotated for auth reasons alone.
- **IV:** 12 random bytes per encryption (`crypto.randomBytes(12)`); never reused, never derived. Stored in the ciphertext blob — no DB column needed.
- **Storage format:** `v1:<iv-b64>:<ciphertext-b64>` where `ciphertext-b64` = AES-256-GCM ciphertext with the 16-byte auth tag appended (node's default `cipher.update`+`final`+`getAuthTag` concatenation). The `v1:` prefix allows future algorithm rotation.
- **Decrypt:** parse format, ` decipher.setAuthTag` from the tag suffix; any tamper/failure throws — callers treat throw as "corrupt key" (skip row, log `error`, US-304 AC.4).
- **Masks:** `apiKeyHint = "…" + ciphertext decrypt → plaintext.slice(-4)`; computed only inside provider read paths, never cached client-side.
- **Rotation story:** changing `ENCRYPTION_KEY`/`AUTH_SECRET` invalidates stored ciphertexts (they fail decrypt → env fallback per US-304 AC.4). Bulk re-encryption is out of scope (§11); the `v1:` prefix keeps the door open.

## 8. Provider resolution algorithm

Replaces the phase-0 module-init logic in `src/lib/ai/provider.ts`. Executed per message-send with the session user id:

```
resolveProvider(userId):
  row = SELECT * FROM providers WHERE userId = userId AND isDefault = true   -- one query
  if row:
    try:
      key = row.apiKeyCiphertext ? decrypt(row.apiKeyCiphertext) : null
      return build(row.type, key, row.baseUrl, row.defaultModel ?? TYPE_DEFAULT[row.type], row.id)
    catch: log error, continue   -- corrupt ciphertext → fall through (US-304 AC.4)
  # env chain (US-305 AC.2)
  if env.OPENAI_API_KEY:      return { source: "env", type: "openai",    model: "gpt-4o-mini", providerId: "env:openai" }
  if env.ANTHROPIC_API_KEY:   return { source: "env", type: "anthropic", model: "claude-3-5-haiku-latest", providerId: "env:anthropic" }
  if await ollamaReachable(): return { source: "env", type: "ollama",    model: firstFromTags() ?? "llama3.2", providerId: "env:ollama" }
  return null                 -- caller returns 503 NO_PROVIDER
```

- `build()`: `openai` → `createOpenAI({ apiKey })`; `anthropic` → `createAnthropic({ apiKey })`; `ollama`/`custom` → openai-compatible client at `row.baseUrl`. Provider-agnostic streaming/persistence downstream (US-305 AC.3).
- Ollama reachability probe = phase 0 §8 logic (GET `/api/tags`, 2s timeout), now only on the env path and only when reached.
- No caching across requests in phase 3 (one indexed query per send is cheap; US-304 AC.2).

## 9. Markdown rendering spec

**Libraries (locked):** `react-markdown@^10.1.0`, `remark-gfm@^4.0.1` — nothing else added.

**Safe configuration (normative):**

| Aspect | Phase 3 behavior |
|---|---|
| `rehype-raw` | NOT used — raw HTML in AI output renders as text (US-307 AC.2) |
| `dangerouslySetInnerHTML` | forbidden in the message component |
| `urlTransform` | react-markdown default (http/https/mailto/xmpp/relative only; `javascript:`, `data:` URIs neutralized) |
| links | component override: `target="_blank" rel="noopener noreferrer"` + underline (non-color cue, US-309 AC.5) |
| images | component override: render as link-with-URL-text, no `<img>` (US-307 AC.4) |
| headings | allowed; message component scopes styles so message headings don't join the page outline (styled h3-level regardless of source level) |
| tables (GFM) | allowed, styled, horizontal-scroll wrapper when wider than the column |
| task lists, strikethrough, autolinks | allowed (GFM core) |
| code blocks | per US-308 — styled pre/code, language label, copy, no highlighting lib |
| user messages | plain text with `white-space: pre-wrap` (US-307 AC.5) |
| streaming | plain-text accumulation during stream; markdown render on completion (US-307 AC.6) |

**Trust boundary note:** the rendered content is AI OUTPUT (untrusted). The default-safe react-markdown config treats it as text-with-markup-syntax, which is the correct posture for phase 3; Security's threat-model addendum should confirm no bypass via GFM autolinks or data URIs.

## 10. A11y notes

- **Settings page:** WAI-ARIA radio pattern for default selection (roving tabindex, arrow keys, `Space`); conditional-field reveal announced via `role="status"`; all errors via `aria-describedby` + `role="alert"` on submit failure; delete-confirm is a focus-trapped `role="dialog"`, `Esc` cancels, focus restores per US-309 AC.4.
- **Markdown messages:** semantic HTML from react-markdown gives correct structure for screen readers (lists, tables with `th`, headings); message-internal headings are visually de-emphasized and must not create `id` anchors that collide or join the page outline; code blocks are labeled regions ("<language> code") with keyboard-scrollable `pre` (`tabindex="0"`); copy button labelled.
- **Contrast:** masked key hints, type badges, code blocks, tables, and links meet WCAG AA in both themes; link identity never color-only (underline).
- **Motion:** `prefers-reduced-motion` honored on toasts/dialogs (US-309 AC.3).
- **Focus:** after provider mutations, focus lands per US-309 AC.4; no keyboard traps anywhere in phase 3 surfaces.

## 11. Out of scope (explicit)

The following are NOT in phase 3 and MUST NOT be built:

- **Syntax highlighting** (shiki / rehype-highlight) — §12 OQ-4, likely phase 4.
- **Progressive/streaming markdown rendering** — §12 OQ-1.
- **Per-message or per-conversation model override** (model picker UI) — §12 OQ-5 stretch.
- **Provider health-check / test-connection button.**
- **Key rotation UI / bulk re-encryption.**
- **BYOK usage tracking / cost display.**
- **Team/org shared providers** (never for a single-user model).
- **OAuth login providers** (Google/GitHub auth) — unrelated to AI providers.
- **Automatic env failover when the user's provider errors at send time** (US-304 out of scope).
- **More provider backends** (Gemini, Azure, Bedrock, OpenRouter).
- **Model catalog listing UI** per provider.
- **Message edit / regenerate / delete, optimistic rendering** — remain deferred (phase 0 §9 / phase 2 §10 carry-over; still not scheduled).
- **Encryption key management UI** (env-only in phase 3).

## 12. Open questions (for Orchestrator / user)

1. **Streaming markdown (OQ-1).** Spec default: render markdown only AFTER the stream completes (phase 1 streaming UX unchanged). Alternative: progressive markdown parsing during the stream (prettier feel, but partial syntax — unterminated fences, half-tables — flickers and needs incremental-parse care). **PM default: after-complete**; revisit only if QA/users report the plain-text→markdown "snap" as jarring.
2. **Anthropic default model (OQ-2).** `claude-3-5-haiku-latest` as the cheap capable default (mirrors `gpt-4o-mini`). Alternative: `claude-sonnet` for quality. **PM default: haiku**; user can override per provider row via `defaultModel`.
3. **Images in AI output (OQ-3).** Spec default: render as links, no `<img>` (tracking pixels, mixed content, layout blowups). Alternative: allow `img` with default urlTransform + lazy loading. **PM default: links-only** in phase 3.
4. **Syntax highlighting path (OQ-4).** Deferred per brief. When added: `rehype-highlight` (CSS classes, small) vs shiki (accurate, heavy, build-time friendly). **PM default: rehype-highlight in phase 4**; the US-308 language-label + CSS-class structure is built so highlighting is additive.
5. **Per-conversation model picker (OQ-5).** Brief rejected `model` on the message endpoint; a per-conversation picker is a stretch goal. **PM default: out of phase 3**; provider-row `defaultModel` covers the 90% case.
6. **ENCRYPTION_KEY vs AUTH_SECRET (OQ-6).** Spec: `ENCRYPTION_KEY` optional, HKDF-derived from `AUTH_SECRET` as fallback. Alternative: require a dedicated key always (stricter, but another env var to set up in dev). **PM default: optional with derivation**; Security to confirm at threat-model addendum.

## 13. Definition of done

Phase 3 is signed off when ALL boxes are checked:

### Spec hygiene
- [ ] every user story uses as-a / i-want / so-that template
- [ ] every AC is testable (verb-led, actor-named, measurable)
- [ ] every UI surface has empty / loading / error / success states (§4 matrix)
- [ ] out-of-scope list explicit (§11, 14 items)
- [ ] open questions listed for Orchestrator resolution before build starts (§12, 6 items)
- [ ] spec reviewed by Critic; issues resolved; frozen by Orchestrator
- [ ] UX contract file (`.orchestrator/specs/ux/phase-3.md`) delivered or explicitly scheduled

### Stack & schema
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test` pass with zero errors
- [ ] NO new dependencies (react-markdown + remark-gfm already in package.json; @ai-sdk/anthropic already a dep)
- [ ] NO DB migration (providers table complete — §6)

### Provider API
- [ ] CRUD per §5 shapes; strict zod; per-type field rules enforced (client AND server)
- [ ] masked keys only in every response (unit-tested: no ciphertext/plaintext in any body)
- [ ] 10-row cap → 422 PROVIDER_LIMIT; 30/10min/user rate limit → 429 with headers
- [ ] cross-user 404 byte-identical to missing-id 404
- [ ] single default invariant + first-provider auto-default (transaction-tested)

### Encryption
- [ ] AES-256-GCM, `v1:<iv-b64>:<ciphertext-b64>`, HKDF derivation, 12-byte random IV
- [ ] unit tests: round-trip, tamper-reject, wrong-key-reject
- [ ] missing key env at runtime → 500 on key-storing create, never plaintext fallback

### Resolution & Anthropic
- [ ] per-request resolution: user default → env chain → null/503; module-init code removed
- [ ] chain order OpenAI → Anthropic → Ollama unit-tested; anthropic user rows work end-to-end
- [ ] corrupt ciphertext → env fallback + error log (no crash)
- [ ] `providerId` provenance: row id or `env:*` sentinel persisted on assistant messages
- [ ] `/api/health` reports `source`

### Settings page
- [ ] `/settings/providers` with conditional add form, edit, delete-confirm, default radio
- [ ] all §4 states implemented; linked from user menu; 401 redirect with callbackUrl

### Markdown
- [ ] assistant = react-markdown + remark-gfm; user = plain text
- [ ] NO rehype-raw / dangerouslySetInnerHTML (code-review gate); raw HTML renders as text (e2e)
- [ ] links safe (`target/rel` + default urlTransform); images render as links
- [ ] code blocks: language label, copy button, horizontal scroll, keyboard-scrollable, no highlight lib

### A11y
- [ ] all US-309 ACs pass as a QA checklist
- [ ] radio pattern, dialog focus trap, focus-restore, `role="status"`/`alert` announcements verified

### Tests & docs
- [ ] Vitest: encryption, resolution precedence, chain order, ownership 404 parity, mask-leak guard
- [ ] Playwright: add → default → send (providerId verified) → delete → env fallback; keyboard-only add-provider; markdown fixture (table/code/link/raw-HTML)
- [ ] README + endpoints doc + `.env.example` updated (ENCRYPTION_KEY documented, ANTHROPIC_API_KEY marked wired)
- [ ] `.orchestrator/STATE.md` updated: phase 3 status = `ready_to_build`

---

**PM self-review (Critic pass — pre-freeze):**

| DoD item | Status | Note |
|---|---|---|
| Stories cover happy + edge | ✅ | US-301..309: CRUD, key safety, default, resolution, anthropic, settings UI, markdown, code blocks, a11y |
| AC testable | ✅ | every AC names actor + verb + measurable outcome |
| States per surface | ✅ | §4 matrix: 8 surfaces × 4 states + limit state |
| Out-of-scope explicit | ✅ | §11: 14 items, carry-overs kept deferred |
| Open questions | ✅ | §12: 6 items, each with PM default |
| Schema verified | ✅ | schema.ts:127 read — all columns present, zero migration (§6) |
| Locked libs honored | ✅ | react-markdown/remark-gfm versions as briefed; zero new deps |
| XSS posture | ✅ | no rehype-raw, default urlTransform, images→links, user messages plain (US-307) |
| Brief deviation check | ✅ | one: masked hint via server-side decrypt (brief's storage format kept verbatim — no hint column added) |

**Critic verdict:** pending independent review.
