# API Handoff — Phase 3 (Backend → Frontend)

**status:** ready
**scope:** provider CRUD, key masking, per-user provider resolution, health `source`
**contract source:** `.orchestrator/specs/phase-3.md` §5/§7/§8 (frozen rev 2)
**error shape:** `{ error: { code, message?, fields? } }` (phase-0 shape, unchanged)

---

## 1. `GET /api/providers`

Auth required. Not rate-limited.

**200**
```json
{ "items": [
  { "id": "uuid", "type": "openai", "baseUrl": null, "defaultModel": "gpt-4o-mini",
    "isDefault": true, "apiKeyHint": "…abc1", "createdAt": "2026-09-14T10:00:00Z" }
] }
```

- `apiKeyHint`: `null` when no key stored; else `"…"` + **last 4 chars of the plaintext key** (computed server-side by decrypting). NEVER the ciphertext, NEVER the key.
- If a stored ciphertext is corrupt (rotated secret), that row's `apiKeyHint` is `null`, the row is still listed, endpoint does not 500.
- `401 UNAUTHENTICATED` · `500 INTERNAL`.

## 2. `POST /api/providers`

Auth required. Rate-limited: 30 req / 10 min / user (combined with PUT/DELETE) → `429 RATE_LIMITED` + `Retry-After`, `X-RateLimit-Limit|Remaining|Reset`.

**Request** (zod `.strict()` — unknown fields → `422 INVALID_INPUT`):
```json
{ "type": "anthropic", "apiKey": "sk-ant-…", "defaultModel": "claude-3-5-haiku-latest", "isDefault": true }
```

**Per-type field rules (AC.3)** — violations → `422 INVALID_INPUT` with `fields`:

| type | apiKey | baseUrl | defaultModel |
|---|---|---|---|
| `openai` | REQUIRED | FORBIDDEN | optional (default `gpt-4o-mini`) |
| `anthropic` | REQUIRED | FORBIDDEN | optional (default `claude-3-5-haiku-latest`) |
| `ollama` | FORBIDDEN | REQUIRED (http/https) | optional (default `llama3.2`) |
| `custom` | optional | REQUIRED (http/https) | REQUIRED |

- `defaultModel`: non-empty string ≤ 200 chars when present.
- **SSRF guard (blocking, AC.3b):** `baseUrl` must be http/https; for `custom` the hostname must not resolve to loopback/private/link-local (10/8, 127/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10). Violation → `422 { fields: { baseUrl: "baseUrl must not point to a private address" } }`. `ollama` is EXEMPT (documented accept-risk).
- `apiKey` is encrypted (AES-256-GCM) before insert; never stored or returned in plaintext.
- **Cap:** 11th provider → `422 { code: "PROVIDER_LIMIT", message: "You can store up to 10 providers" }`.
- **Default invariants:** the FIRST provider is auto-`isDefault: true` regardless of submitted value (AC.7); setting `isDefault: true` clears the previous default server-side in one transaction (AC.6).

**201** → single masked item (same shape as a GET item).
**Errors:** `401` · `422 INVALID_INPUT` (fields) · `422 PROVIDER_LIMIT` · `429` · `500 INTERNAL`.

## 3. `PUT /api/providers/:id`

Auth required. Same rate-limit bucket as POST/DELETE.

**Request:** any subset of `{ baseUrl, apiKey, defaultModel, isDefault }` — `.strict()`. `type` is immutable: supplying it → `422 INVALID_INPUT` (strict unknown-field).
- `apiKey` supplied → re-encrypt + replace; omitted → existing ciphertext untouched.
- `baseUrl` re-validated through the SSRF guard against the row's (immutable) type.
- `isDefault: true` clears the previous default (transaction).

**200** → masked item (updated; `apiKeyHint` reflects a newly supplied key).
**Errors:** `401` · `404 NOT_FOUND` · `422` · `429` · `500`.

## 4. `DELETE /api/providers/:id`

Auth required. Same rate-limit bucket.

**204** — empty body. **No auto-promotion**: if the deleted row was the default, resolution falls back to the env chain (AC.9).
**Errors:** `401` · `404 NOT_FOUND` · `429` · `500`.

### 404 parity (AC.10)
Missing id and foreign-owned id return **byte-identical** `404 { error: { code: "NOT_FOUND", message: "Provider not found" } }` — never 403.

## 5. `GET /api/health` (extended)

`provider` object gains `source: "user" | "env" | null` — the resolution for the CURRENT session's user (`null` when unauthenticated). `type` enum now includes `anthropic` and `custom`.

```json
{ "status": "ok",
  "provider": { "type": "anthropic", "model": "claude-3-5-haiku-latest", "baseUrl": null, "source": "user" },
  "ollamaReachable": false }
```

## 6. Resolution semantics (what the UI can rely on)

- Resolution is **per message send**: user's `isDefault` row → env chain (`OPENAI_API_KEY` → `ANTHROPIC_API_KEY` → reachable `OLLAMA_BASE_URL` → null/503). No reload needed after set-default.
- Corrupt user-row state (decrypt failure) → env fallback automatically; send never crashes.
- `providerId` persisted on assistant messages: the provider **row id** (user-resolved) or `env:openai` / `env:anthropic` / `env:ollama` sentinels.
- **Send-time SSRF re-validation** for ollama/custom rows: if the stored baseUrl resolves to a blocked range at send time, the send returns `502 PROVIDER_FAILED` ("Provider endpoint blocked — update it in provider settings"). This is deliberate: no silent env failover to a different key owner (US-304 out-of-scope).

## 7. Backend implementation notes (for review)

- Encryption: AES-256-GCM, format `v1:<iv-b64>:<ciphertext-b64>` (tag appended), 12-byte random IV. Key = `ENCRYPTION_KEY` (base64, 32 bytes) else HKDF-SHA256 from `AUTH_SECRET` with **salt `subchats-providers-v1`**, **info `providers:apikey`** (spec §7 values — the build brief's paraphrase differed; spec wins as frozen contract). Missing key material at create-with-key → `500 INTERNAL`, never plaintext fallback.
- `pino` redact extended BEFORE provider code: `*.apiKey`, `*.apiKeyCiphertext`, `*.ANTHROPIC_API_KEY`, `*.ENCRYPTION_KEY`.
- Rate limiter: `checkProviderRateLimit` in `src/lib/auth/rate-limit.ts` (30 / 10 min / user, global-bucket pattern).
- `.env.example` should document `ENCRYPTION_KEY` (optional, recommended for prod) — TechWriter.
- No new deps, no DB migration.

## 8. Tests added (Vitest)

- `tests/unit/encryption.test.ts` — round-trip, tamper byte-flip, wrong key, format parsing, HKDF determinism, missing-key 500 path.
- `tests/unit/ssrf-guard.test.ts` — private/loopback/link-local custom rejected (mocked dns), public accepted, ollama-localhost exempt, non-http(s) + malformed rejected, send-time re-validation.
- `tests/unit/provider-resolution.test.ts` — user-default precedence, env chain order, decrypt-failure fallthrough, per-type client construction, send-time SSRF propagation.
- `tests/unit/providers-api.test.ts` — 401s, hint masking + no-leak assertions, per-type field rules, PROVIDER_LIMIT, SSRF 422, rate-limit 429 headers, PUT key re-encrypt / type-immutable, 404 parity, DELETE 204 + no auto-promote.

**Verified:** `npx tsc --noEmit` clean; `npx vitest run` 114/114 pass. (`pnpm lint` not runnable in this repo — no ESLint config exists; pre-existing, configs frozen.)
