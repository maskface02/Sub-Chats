# Phase 3 Code Audit (stub)

## Orchestrator-closed blocker (hardening #1 — redirect policy)

The conditional blocker "provider-fetch redirect policy" is CLOSED. `ssrfSafeFetch(type)`
was added to `src/lib/ai/ssrf-guard.ts` and wired as the custom `fetch` for all
ollama/custom openai-compatible clients in `src/lib/ai/provider.ts`. It uses
`redirect: "manual"`, re-validates every hop's URL through the same private-IP
denylist, follows up to 3 redirects itself (301/302 degrade to GET; 303/307/308
preserve method+body), and throws `SsrfBlockedError` on violation or too many
hops. Verified: 114/114 unit tests pass, build green.

**status:** stub — audit AFTER Backend + Frontend delivery
**phase:** 3 — Multi-Provider (BYOK) + Custom Providers + Markdown Rendering
**threat model:** `.orchestrator/security/threat-models/phase-3.md`

## conditional blocker (resolve first)

**Redirect policy of the provider fetch client (T-I-5c).** Before any other gate:
confirm whether the openai-compatible client used for `custom`/`ollama` baseUrl
fetches follows 3xx redirects. If it does, the AC.3b denylist is defeated by a
redirect to a private/link-local target. Required fix: `redirect: 'manual'`
(treat 3xx as provider error → 502) or per-hop re-validation through the same
guard. Record the confirmed behavior + fix here.

## audit gates (fill in at delivery)

### Backend — encryption module (`src/lib/crypto/*` or equivalent)
- [ ] AES-256-GCM; storage format `v1:<iv-b64>:<ciphertext-b64>` with 16-byte tag appended (US-302 AC.1)
- [ ] IV: `crypto.randomBytes(12)` INSIDE `encrypt()` — no IV parameter, no caching, no deterministic derivation (T-T-4)
- [ ] `decipher.setAuthTag` + `final()` on every decrypt; ANY failure (parse, tag, wrong key) THROWS — no try/catch inside the module that returns a fallback plaintext (T-T-3)
- [ ] Key source: `ENCRYPTION_KEY` (32-byte base64) else HKDF-SHA256 from `AUTH_SECRET` with salt `subchats-providers-v1` + info `providers:apikey` — never raw AUTH_SECRET as AES key (T-I-4)
- [ ] Missing key env at runtime → 500 INTERNAL on key-storing create, never plaintext fallback (US-302 AC.5)
- [ ] Unit tests: round-trip, flip-one-byte → throws, wrong key → throws, two encryptions → different IVs (US-302 AC.4, T-T-4)

### Backend — provider CRUD (`/api/providers`, `/api/providers/:id`)
- [ ] `requireAuth()` at top of all four routes; `userId` from session only (T-S-1)
- [ ] zod `.strict()` on POST/PUT bodies; per-type field rules per US-301 AC.3 (baseUrl FORBIDDEN for openai/anthropic — T-S-2); `type` immutable on PUT
- [ ] SSRF guard at create AND update: scheme allowlist http/https; `custom` denylist resolves hostname (A + AAAA, ALL records) and rejects any resolved address in loopback/private/link-local ranges — no hostname string matching (T-E-2, hardening #6); ollama exempt (documented)
- [ ] Send-time re-validation of `custom` baseUrl in `resolveProvider()` (T-I-5b); redirect policy confirmed + fixed (conditional blocker above)
- [ ] Ownership: `WHERE id = :id AND userId = :session` single query on PUT/DELETE; missing AND foreign → byte-identical 404 (T-E-1)
- [ ] Response serialization: shared whitelist mapper (`{id, type, baseUrl, defaultModel, isDefault, apiKeyHint, createdAt}`) used by ALL routes — `apiKeyCiphertext`/`apiKey` structurally unreachable in responses (T-I-1)
- [ ] `apiKeyHint` computed server-side by decrypt; list-time decrypt failure → hint `null` + warn log, row still listed, no 500 (US-302 AC.3)
- [ ] Default invariant: single transaction clearing other rows' `isDefault`; first provider auto-default (US-301 AC.6–7)
- [ ] 10-row cap → 422 PROVIDER_LIMIT; mutations rate-limited 30/10min/user COMBINED across POST+PUT+DELETE, 429 with Retry-After + X-RateLimit-* (T-D-1, hardening #8)
- [ ] Resolution: per-request (module-init code REMOVED); user default → env chain OpenAI → Anthropic → Ollama → null/503; corrupt ciphertext → error log + env fallback, no crash (US-304 AC.2/AC.4)
- [ ] `abortSignal` reaches `streamText` for user-provider streams too — no provider-specific branching that drops it (T-D-2, US-305 AC.3)
- [ ] Drizzle parameterized everywhere; `baseUrl`/`defaultModel` never raw-interpolated (T-T-5)

### Backend — logging
- [ ] pino redact extended BEFORE provider code logs: `*.apiKey`, `*.apiKeyCiphertext`, `*.ANTHROPIC_API_KEY`, `*.ENCRYPTION_KEY` (US-302 AC.2)
- [ ] Provider CRUD audit events: create/update/delete/set-default with `{userId, providerId, type}` — NO key material, NO ciphertext blob, NO raw decrypt-error strings (T-R-1, hardening #4)
- [ ] Foreign PUT/DELETE 404 logged at `warn` (probing telemetry); provider upstream errors logged as status + error class only — no request/response bodies (T-I-2)

### Frontend — settings page (`/settings/providers`)
- [ ] Provider data reaches the page ONLY via `GET /api/providers` — NO server-component DB reads of the `providers` table (ciphertext must never enter the RSC flight payload) (T-I-3, hardening #5)
- [ ] `apiKey` input: `type="password"`, `autocomplete="off"`, never pre-filled; empty submit on edit = keep existing key (US-306 AC.3)

### Frontend — markdown renderer (US-307/308)
- [ ] NO `rehype-raw` (or any raw-HTML pass) in the react-markdown config; raw HTML in AI output renders as TEXT (T-T-1)
- [ ] NO `dangerouslySetInnerHTML` anywhere in the message component tree — grep gate (T-T-1)
- [ ] Default `urlTransform` untouched (no custom scheme expansion); `javascript:`/`data:` links render inert (T-T-2)
- [ ] Link component override adds `target="_blank" rel="noopener noreferrer"` + underline, does NOT alter href sourcing (T-T-2, US-309 AC.5)
- [ ] Images render as links with URL as text — no `<img>` (tracking-pixel guard, US-307 AC.4)
- [ ] User messages: plain text with preserved newlines — NO markdown parsing (US-307 AC.5)
- [ ] CI/lint grep gate for `rehype-raw` + `dangerouslySetInnerHTML` exists (hardening #7)

### Cross-cutting
- [ ] CSRF posture on the four new mutation routes matches phase-0 pattern (JSON-only bodies, SameSite=Lax cookie) (T-E-4)
- [ ] Message-send rate limit (60/min + 500/hr) is provider-agnostic — custom providers cannot bypass it (T-D-2)
- [ ] `/api/health` `source` field added; no user-provider `baseUrl` echoed in health response (T-I-7)
- [ ] `pnpm audit` clean or risks documented; NO new dependencies (spec-locked, AC-P3-15)
- [ ] Security headers middleware covers the new routes
- [ ] AC-P3-12 unit tests exist (incl. SSRF: private-IP custom rejected, public accepted, ollama-localhost accepted, non-http(s) rejected, send-time re-validation) + AC-P3-13/14 e2e pass

## verdict

- [ ] approved / [ ] findings (fill at audit)
