# Phase 3 STRIDE Threat Model

**status:** preliminary (code not yet written — pre-implementation review)
**phase:** 3 — Multi-Provider (BYOK) + Custom Providers + Markdown Rendering
**spec:** `.orchestrator/specs/phase-3.md` (frozen rev 2 — SSRF guard in US-301 AC.3b, §7 encryption design)
**framework:** STRIDE + OWASP Top 10 (2025)
**reviewer:** security (GLM 5.3 Flash tier)
**builds_on:** `.orchestrator/security/threat-models/phase-2.md` (baseline; all phase-2 threats carry over unchanged)
**decisions:** `.orchestrator/decisions/phase-3-open-questions.md` (OQ-6: ENCRYPTION_KEY optional, HKDF from AUTH_SECRET as fallback)

---

## scope

Phase 3 adds the highest-risk surface so far — **user-supplied secrets** and a **user-supplied server-side fetch target**:

1. **NEW (API)** — provider CRUD: `GET/POST /api/providers`, `PUT/DELETE /api/providers/:id` (US-301). Keys encrypted AES-256-GCM into `apiKeyCiphertext` (§7). 10-row cap, 30/10min mutation rate limit.
2. **NEW (crypto)** — encryption module: `v1:<iv-b64>:<ciphertext-b64>` (US-302, §7); key = `ENCRYPTION_KEY` env or HKDF-SHA256(AUTH_SECRET, salt `"subchats-providers-v1"`, info `"providers:apikey"`).
3. **NEW (resolution)** — per-request provider resolution: user default row → env chain OpenAI → Anthropic → Ollama → null (US-304, US-305). Module-init resolution removed. Corrupt ciphertext → env fallback.
4. **NEW (SSRF surface)** — user-supplied `baseUrl` for `ollama` (exempt from private-range denylist) and `custom` (denylist + send-time re-validation) types is fetched server-side at send time (US-301 AC.3b).
5. **NEW (client)** — `/settings/providers` page (US-306), markdown rendering for assistant messages (US-307: react-markdown + remark-gfm, NO rehype-raw, images→links), code blocks (US-308).

Phase 1/2 surfaces (branch, messages, tree, split) unchanged. Phase 2 threat model's assumption #4 ("re-open T-T-1/T-T-2 at markdown time") is discharged by this document (T-T-1, T-T-2).

---

## data flows

1. **Provider create/update.** Client → `POST/PUT /api/providers` (zod `.strict()`, per-type field rules) → SSRF guard on `baseUrl` (scheme allowlist; `custom`: private-range denylist via DNS resolution) → `apiKey` → AES-256-GCM encrypt (12-byte random IV) → `apiKeyCiphertext` column → response = masked item (`apiKeyHint = "…" + last 4`), never ciphertext.
2. **Provider list.** Client → `GET /api/providers` (session required) → rows → for each row with ciphertext: decrypt → hint = last 4 chars (decrypt failure → hint `null`, warn log, row still listed) → masked items only.
3. **Send-time resolution.** Message POST → `resolveProvider(userId)` → one `(userId, isDefault)` query → if row: **send-time SSRF re-validation of `baseUrl`** (custom) → decrypt ciphertext → `createOpenai/createAnthropic/createOpenAICompatible({ baseUrl })` → stream. Corrupt ciphertext → log `error`, fall through to env chain.
4. **Provider stream.** Server → user's provider endpoint (`{baseUrl}/chat/completions` or vendor API) with the user's decrypted key in the Authorization header. Server is a **proxy**: request originates from server IP; response body streams back to the user.
5. **Settings page.** Client-side fetch → `GET /api/providers` (masked). No server-component pass-through of provider rows (T-I-3).
6. **Markdown render.** Persisted assistant message (AI output = untrusted) → react-markdown + remark-gfm → safe components (links `target=_blank rel=noopener noreferrer`, images→links, raw HTML → text). User messages: plain text.

---

## trust boundaries

- **TB-15 (NEW):** User ↔ server-held secret material. The user hands the server a plaintext API key over HTTPS once; from that point the server must hold, transport, and use it without ever echoing it back. Every response/log/error/client payload is a potential leak channel.
- **TB-16 (NEW):** Server ↔ user-supplied `baseUrl`. The server (with its network position — internal DNS, cloud metadata, VPC) makes outbound requests to a URL the user controls. Classic SSRF boundary; the only server-side fetch with user-controlled destination in the codebase.
- **TB-17 (NEW):** AI output ↔ DOM. Assistant messages are attacker-influencable content (prompt injection can make the model emit arbitrary markdown/raw HTML) rendered by the client. Same class as phase-1 TB-9, now with a rich renderer.
- **TB-18 (NEW):** Encryption module ↔ DB. `apiKeyCiphertext` is trusted only after GCM auth verification; a corrupt/tampered blob must fail closed.

---

## threats (STRIDE)

### Spoofing

- **T-S-1: No new spoofing surface.** `userId` on all provider routes comes from the session, never the body (zod `.strict()` rejects `userId` injection). Resolution is keyed by session user id. Provider rows are only reachable through the owner's session.
  - likelihood: n/a; impact: n/a
  - mitigation: carry-over posture; verify `userId` never accepted in provider request bodies (checklist).

- **T-S-2: Provider-type confusion → key exfiltration to attacker endpoint.** Threat: user submits `type: "openai"` with `baseUrl: "https://evil.example"` hoping the server sends their (or a probed) key to a hostile endpoint. Spec AC.3 makes `baseUrl` FORBIDDEN for `openai`/`anthropic` (strict 422 reject) — keys only ever go to the vendor's hardcoded API origin. Keyed vendors cannot be pointed at user-controlled hosts.
  - likelihood: attempted (trivial); impact: high if unmitigated
  - mitigation: zod per-type rules enforced server-side (client-side validation is UX, not security); code-review gate that no `baseUrl` merge path exists for keyed types.

### Tampering

- **T-T-1: Markdown XSS via renderer regression — HIGH.** `react-markdown` without `rehype-raw` is XSS-safe by default: raw HTML in AI output renders as text. Threats: (a) a later dev adds `rehype-raw` (e.g. while wiring phase-4 `rehype-highlight` — OQ-4 explicitly schedules a rehype plugin, making accidental `rehype-raw` adoption plausible); (b) `dangerouslySetInnerHTML` appears in a custom `components` override; (c) GFM autolink bypass — verified: GFM autolinks produce `<a href>` through the same `urlTransform` gate, no bypass. Prompt injection makes AI output fully attacker-influencable, so this is not self-XSS (TB-17).
  - likelihood: medium (regression-class); impact: **high** (stored XSS in chat history — persists, fires on every render, cross-session via shared-device)
  - mitigation: spec US-307 AC.2 is normative; CI grep gate for `rehype-raw` and `dangerouslySetInnerHTML` in the message component; e2e fixture (AC-P3-14) asserts raw HTML renders as text; audit gate.

- **T-T-2: `javascript:` / `data:` URIs in AI-generated links.** react-markdown's default `urlTransform` allows only `http`, `https`, `mailto`, `xmpp`, and relative URLs — `javascript:` and `data:` are neutralized (empty). Threat: Frontend passes a custom `urlTransform` (to "support more schemes") or overrides the `a` component in a way that bypasses the transform.
  - likelihood: low; impact: high if unmitigated
  - mitigation: keep default `urlTransform` (spec §9 normative); component override for links changes only `target`/`rel`, not `href` sourcing; e2e asserts `javascript:alert(1)` link renders inert.

- **T-T-3: GCM auth-tag stripping / ciphertext tampering — HIGH.** GCM is malleable at the ciphertext level only if the tag is not verified. Threats: decrypt implementation (a) reads tag but ignores verification failure, (b) strips the trailing 16-byte tag and decrypts without `setAuthTag` (throws, but a careless `try/catch → return null-plaintext` pattern would silently "succeed"), (c) treats parse failure of the `v1:` envelope as empty-string plaintext. Every failure must THROW and callers must treat throw as "corrupt key" (US-304 AC.4 skip-and-fallback), never as a recoverable value.
  - likelihood: low (implementation-class); impact: **high** (silent corruption acceptance undermines the entire at-rest guarantee; bit-flipped plaintext could also alter a key to point at attacker-controlled infrastructure in edge cases)
  - mitigation: `decipher.setAuthTag` + `final()` mandatory; unit tests: flip-one-byte → throws, wrong key → throws, malformed envelope → throws (US-302 AC.4); no try/catch inside the crypto module that swallows failures.

- **T-T-4: IV reuse across encryptions.** Spec mandates `crypto.randomBytes(12)` per encryption, stored in the blob. Threat: dev caches the IV or derives it deterministically (e.g. from provider id) "for testability". With GCM, IV reuse under the same key is catastrophic (keystream reuse → plaintext XOR recovery, forbidden).
  - likelihood: low; impact: **high** if it happens (breaks GCM confidentiality entirely)
  - mitigation: IV generated inside `encrypt()` only; unit test: two encryptions of the same plaintext produce different blobs (IV differs); code-review gate — no IV parameter on `encrypt()`'s public signature beyond tests.

- **T-T-5: Drizzle parameterization carry-over.** New provider queries (CRUD, resolution lookup, default-clearing transaction) are Drizzle parameterized; no raw `sql\`\`` interpolation of `baseUrl`/`defaultModel` (both user-controlled strings).
  - likelihood: very low; impact: critical if violated
  - mitigation: same ban as phase-1 T-T-1; `defaultModel` is stored and later embedded in provider request bodies — parameterize at write, validate (≤200 chars) at read.

### Repudiation

- **T-R-1: Provider CRUD audit trail — and the decrypt-error logging trap.** Required: create/update/delete/set-default logged with `{userId, providerId, type}` (no key material). Two traps: (a) a decrypt failure's error log must NOT include the ciphertext blob or the plaintext — log only `providerId` + failure class (pino redact covers `*.apiKeyCiphertext`, but a hand-built `log.error({ ciphertext })` with a differently-named field slips past redact — code-review gate); (b) 404-on-foreign PUT/DELETE logged at `warn` for probing telemetry (phase-1 pattern).
  - likelihood: medium (logging mistakes are the most common secret-leak vector); impact: medium (key material in centralized logs = long-lived exposure)
  - mitigation: checklist items; redact list extended BEFORE any provider code logs (US-302 AC.2 ordering requirement); audit greps every provider log call.

### Information Disclosure

- **T-I-1: Key material in API responses — HIGH.** The invariant: **no endpoint response ever contains plaintext keys, full ciphertext, or anything decryptable.** Masked hint (last 4) only. Threats: (a) Backend returns the raw row from Drizzle (includes `apiKeyCiphertext`) and strips fields in the UI instead — one refactor away from a leak; (b) POST/PUT response shapes accidentally mirror the DB row; (c) a future "export providers" feature dumps rows.
  - likelihood: medium (row-passthrough is the natural shortcut); impact: **high** (full key disclosure to the client = disclosure to anything running in the page)
  - mitigation: server-side whitelist mapper (row → `{id, type, baseUrl, defaultModel, isDefault, apiKeyHint, createdAt}`), single shared serializer used by ALL routes; unit test asserting `apiKeyCiphertext` / `apiKey` absent from every response body (US-302 AC.2).

- **T-I-2: Key material in logs / error messages — HIGH.** Phase-0 history: provider errors were logged with full body (T-I-4 phase 0). Threats: (a) vendor client errors embed the Authorization header or the key; (b) encrypt/decrypt throw paths interpolate the plaintext/ciphertext; (c) `console.log` debug leftovers during development. Redact list extension (`*.apiKey`, `*.apiKeyCiphertext`, `*.ANTHROPIC_API_KEY`, `*.ENCRYPTION_KEY`) is spec'd but redact is pattern-based — an object logged under an unlisted key leaks.
  - likelihood: medium; impact: **high** (keys in logs outlive sessions and are broadly readable)
  - mitigation: redact extension before any provider logging; never log request/response bodies of provider calls (log status code + error class only); audit greps provider code paths for `log.*` calls; no `console.*` (existing gate).

- **T-I-3: Keys into the RSC payload / server-passed props — HIGH.** The settings page could be implemented as a server component querying the DB directly and passing provider rows (including `apiKeyCiphertext`) to client components — the ciphertext would serialize into the RSC flight payload, visible to anyone with devtools and to any stored-XSS payload (chained with T-T-1 this becomes full key theft). Spec US-306 AC.1 routes the page through `GET /api/providers`; this must stay client-side fetch.
  - likelihood: medium (server components are the Next.js default idiom); impact: **high**
  - mitigation: spec AC.1 + audit gate: no provider DB query in any server component; settings data flows through the API only; hint decrypt happens server-side in the API route, never in the RSC tree.

- **T-I-4: AUTH_SECRET compromise = all provider keys compromised (OQ-6).** HKDF-from-AUTH_SECRET means the auth secret is now ALSO the root of the key-encryption hierarchy: a leak of `AUTH_SECRET` (e.g. via a misconfigured crash reporter, a leaked `.env`, or a compromised auth-adjacent log) decrypts every stored provider key. Derivation (vs raw reuse) prevents key-purpose bleed but not root compromise. Accepted for dev (zero-config); for prod a dedicated `ENCRYPTION_KEY` shrinks the blast radius of an auth-only compromise and allows rotating auth without invalidating keys.
  - likelihood: low (secret-compromise class); impact: high (all users' keys)
  - mitigation: **accepted risk (documented)**; hardening request: `.env.example` + README must state prod deployments SHOULD set a dedicated 32-byte `ENCRYPTION_KEY`; HKDF derivation per §7 (salt+info domain separation) mandatory — never raw `AUTH_SECRET` as the AES key.

- **T-I-5: SSRF response reflection via user providers.** The server proxies provider responses back to the user. For `custom`/`ollama` types the response body (and error body) of the user-chosen endpoint streams back. Residuals:
  - (a) **ollama exemption (documented accept-risk, US-301 AC.3b):** user-supplied `baseUrl` MAY target internal network addresses (that is ollama's purpose). Blast radius: user can POST attacker-controlled JSON to `POST {internalBaseUrl}/chat/completions` and read the response/error body — a semi-blind internal-request relay with body reflection. Internal services that answer non-OpenAI-shaped JSON leak their response bodies through the `502 PROVIDER_FAILED` error path (phase-0 behavior: full body logged internally — verify the FRIENDLY message returned to the user does not embed the upstream body verbatim beyond what streaming already returns).
  - (b) **custom type:** denylist blocks loopback/private/link-local; send-time re-validation mitigates classic DNS rebinding. Residual: **TOCTOU between the re-validation DNS lookup and the actual fetch** — a second DNS resolution inside the HTTP client can return a different (private) IP. Fully closing this requires pinning the validated IP into the fetch (custom DNS lookup + `connect`-to-IP), which the AI SDK's client does not expose cleanly. Accept residual for phase 3 (attacker needs DNS authority over a public-looking name; Vercel functions have no high-value intranet), revisit for VPC deployments.
  - (c) **redirect-following:** an openai-compatible client may follow a `302` from a validated public baseUrl to `http://169.254.169.254/...` or `http://localhost/...` — the redirect target is never re-validated. This defeats the entire denylist. **Must be confirmed by Backend: set `redirect: 'manual'` (or re-validate each hop).** Raised as hardening request #1.
  - likelihood: medium (a+b); low (c — only if client follows redirects); impact: high (b/c — internal service interaction from server network position; cloud metadata ranges are denylisted: 169.254/16 covers AWS/GCP/Azure metadata, fc00::/7 covers `fd00:ec2::`)
  - mitigation: AC.3b guard at create+update+send-time; redirect policy pending (hardening #1); ollama exemption accepted + prod kill-switch requested (hardening #2); friendly-error message must not echo upstream raw bodies beyond streamed model output.

- **T-I-6: `apiKeyHint` last-4 exposure.** Four trailing chars of the user's own key, computed server-side, shown only to the owner. Negligible entropy leak (4 chars ≈ 2^20-ish for random keys, but the key owner already has… nothing else — they gave the key away, they can't retrieve it). No cross-user path (rows are owner-filtered).
  - likelihood: n/a (own data); impact: negligible
  - mitigation: none required; keep hint computation inside the API route (never cached client-side, per §7).

- **T-I-7: `/api/health` `source` field.** Reports the session user's resolution (`user`/`env`/null) — own-data only; null when unauthenticated. Reveals nothing to third parties.
  - likelihood: n/a; impact: none
  - mitigation: n/a; verify the health route does not include `baseUrl` of the user's provider in the response (existing `baseUrl` field is env-chain only — keep it that way; a user-provider baseUrl would be fine privacy-wise but is unnecessary exposure).

### Denial of Service

- **T-D-1: Provider CRUD abuse.** 10-row cap (422 PROVIDER_LIMIT) + 30/10min combined mutation rate limit (429 + Retry-After) bound DB writes. GET is unauthenticated-cheap (owner-filtered, ≤10 rows). Verified spec'd.
  - likelihood: n/a (bounded by design); impact: low
  - mitigation: verify rate-limit key is per-user and COMBINED across POST/PUT/DELETE (not per-route — three per-route buckets = 3× the ceiling).

- **T-D-2: Custom provider = server as outbound proxy.** User routes AI calls through their own endpoint: cost shifts to user infra (fine), but the server makes the request and holds the connection for the stream duration. Threats: (a) user points at a black-hole IP → connection hangs until timeout; (b) user points at a very slow-drip endpoint → holds a serverless function for minutes (Vercel max-duration caps this). Provider choice must NOT bypass the per-user message rate limit (60/min + 500/hr — that limit is on the message route, independent of provider; spec'd unchanged contract).
  - likelihood: medium; impact: medium (function-time exhaustion; bounded by Vercel max duration + abortSignal)
  - mitigation: phase-0 `abortSignal` (30s per-token / 5-min max stream) must apply to user-provider streams identically (US-305 AC.3: no provider-specific branching — audit confirms the signal reaches `streamText` for user rows too); per-user message rate limit documented as provider-agnostic (checklist).

- **T-D-3: Send-time SSRF re-validation cost.** One DNS resolution per message-send for `custom` rows. Negligible per call; bounded by the message rate limit. No amplification (resolution is of the stored row's baseUrl, not attacker-per-request input).
  - likelihood: n/a; impact: negligible
  - mitigation: none required; do not cache DNS results across users (stale resolution would weaken T-I-5b re-validation).

### Elevation of Privilege

- **T-E-1: IDOR on provider PUT/DELETE — HIGH if missed.** Cross-user mutation of another user's provider row (rebind THEIR key to an attacker baseUrl → next message sends the victim's chat content to the attacker's endpoint — a full conversation-exfil primitive). Spec AC.10: missing OR foreign → byte-identical 404 (no 403, no enumeration). Note the attack is worse than read-IDOR: `PUT { baseUrl }` silently redirects the victim's AI traffic.
  - likelihood: low (single-query ownership pattern exists); impact: **critical** (victim's keys and conversations routed to attacker)
  - mitigation: `WHERE id = :id AND userId = :session` in ONE query (phase-0 pattern); 404 parity test; Vitest: cross-user PUT/DELETE → 404; audit gate.

- **T-E-2: SSRF → cloud metadata / internal services via `custom`.** The denylist ranges (loopback, RFC1918, link-local 169.254/16 + fe80::/10, ULA fc00::/7) cover AWS/GCP/Azure IMDS endpoints (169.254.169.254, fd00:ec2::254) and common intranets. Residual risks beyond the ranges: (a) redirect-following defeat (T-I-5c — hardening #1); (b) DNS rebinding TOCTOU (T-I-5b — accepted); (c) IPv4-mapped IPv6 and decimal/octal IP encodings — the check must resolve hostnames to IPs and compare the RESOLVED addresses (all families), not string-match the hostname, else `http://0x7f000001/` or `http://[::ffff:127.0.0.1]/` bypasses; (d) rebinding-adjacent: multi-A-record names where one A record is private — check ALL resolved addresses, not the first.
  - likelihood: low with AC.3b correctly implemented; impact: **high** (server-network access from user input)
  - mitigation: AC.3b + unit tests (AC-P3-12); implementation note for Backend: resolve ALL address records (A + AAAA), reject if ANY resolved address is denylisted; normalization cases in tests.

- **T-E-3: Ollama exemption as an internal-network relay (documented accept-risk).** Same mechanism as T-I-5a viewed as privilege elevation: an authenticated user makes the server send attacker-crafted POST bodies (`{baseUrl}/chat/completions`, JSON) to intranet hosts and observes reflected responses. This is an internal-network interaction primitive that survives phase 3 by explicit decision (US-301 AC.3b item 3).
  - likelihood: certain (by design); impact: medium (depends on internal surface; single-tenant Vercel deployment minimizes it)
  - mitigation: **accepted risk** — recorded in spec + this model. Hardening request #2: `ADMIN_ALLOW_OLLAMA_USERS` env flag (default `true` dev) to disable user ollama-type providers in prod without a code change. Blast radius documented: error/stream bodies may reflect internal responses.

- **T-E-4: CSRF on new mutation routes.** POST/PUT/DELETE /api/providers are state-changing. Phase-0 posture: SameSite=Lax session cookie blocks cross-site POST cookie attachment; JSON-only content type (zod parsing) blocks form-based CSRF. Carry-over pattern must apply to all four new routes (GET is read-only and returns own masked data — CSRF-relevant only under a same-site embedding scenario, none planned).
  - likelihood: low (posture carried); impact: medium if violated (attacker rebinds victim's provider)
  - mitigation: same middleware/validation pattern as phase-0/1 mutations; audit confirms all four routes parse JSON bodies via zod and are never form-submittable.

---

## assumptions

1. Phase-0 `requireAuth()` + per-user rate-limit helpers are reused on all provider routes (verified pattern phases 0–2).
2. SameSite=Lax session cookie posture carries over (CSRF baseline for T-E-4).
3. Vercel deployment (no privileged intranet behind the server) — sizes the ollama-exemption accept-risk (T-E-3); revisited if self-hosted in a VPC.
4. `ENCRYPTION_KEY`-or-HKDF per OQ-6 is the accepted key hierarchy for phase 3; rotation UI/re-encryption out of scope (§11).
5. react-markdown default `urlTransform` semantics (http/https/mailto/xmpp/relative only) hold in the locked version `^10.1.0` — verified at audit against node_modules if behavior differs.
6. The message-route rate limit (60/min + 500/hr) is enforced upstream of provider resolution and is provider-agnostic.

---

## out of scope (phase 3)

Per spec §11: syntax highlighting (phase 4 — rehype plugins re-open T-T-1 then), streaming markdown, per-conversation model override, provider health-check endpoint, key-rotation UI/re-encryption, BYOK cost tracking, shared providers, OAuth login providers, automatic env failover, more provider backends, model catalog UI, message edit/regenerate, encryption-key management UI.

Not modeled: phase 0–2 surfaces (unchanged; baseline carries), infra/headers (DevOps — CSP covers inline-script risk supporting T-T-1), OAuth/auth internals (phase 0).

---

## residual risk

| risk | likelihood | impact | decision |
|---|---|---|---|
| T-I-4 AUTH_SECRET compromise decrypts all keys (HKDF fallback) | low | high | **accept (documented)** — dedicated `ENCRYPTION_KEY` recommended for prod (hardening #3) |
| T-I-5b DNS rebinding TOCTOU on custom send-time fetch | low | medium | **accept** — IP-pin not exposed by AI SDK client; revisit for VPC/self-hosted |
| T-I-5a / T-E-3 ollama exemption = internal relay | certain (by design) | medium | **accept (documented)** — prod kill-switch requested (hardening #2) |
| T-I-5c redirect-following to private IPs | unknown until Backend confirms client behavior | high | **mitigate** — `redirect: 'manual'` or hop re-validation (hardening #1, blocking at audit) |
| T-T-1 rehype-raw regression (phase 4 highlight work) | medium over time | high | **mitigate** — CI grep gate + e2e fixture; re-open model at phase 4 |
| T-E-2 IP-encoding bypasses in denylist | low | high | **mitigate** — resolve-all-addresses implementation note + tests |

No critical residual remains if AC.3b is implemented per the resolved-addresses note and the redirect policy is confirmed.

---

## OWASP Top 10 (2025) mapping

| OWASP | threats | coverage |
|---|---|---|
| A01 Broken Access Control | T-E-1, T-S-1 | single-query ownership + 404 parity + Vitest |
| A02 Cryptographic Failures | T-T-3, T-T-4, T-I-4 | GCM auth-tag enforcement, per-encryption IV, HKDF domain separation, ENCRYPTION_KEY rec |
| A03 Injection | T-T-1, T-T-2, T-T-5, T-E-2 | react-markdown safe config, urlTransform default, Drizzle parameterization, resolved-IP denylist |
| A04 Insecure Design | T-I-5, T-E-3, T-D-2 | AC.3b guard, documented accept-risks, proxy bounds |
| A05 Security Misconfiguration | T-T-1, T-S-2 | no-rehype-raw gate, per-type field rules |
| A07 Identification/Auth Failures | (inherited) | requireAuth carry-over |
| A09 Logging & Monitoring | T-R-1, T-I-2 | redact extension ordering, no-key-material audit |
| A10 SSRF | T-I-5, T-E-2, T-E-3 | scheme allowlist + private-range denylist + send-time re-validation; documented exemptions |

---

## spec hardening requests (to PM / Orchestrator / Backend)

1. **Provider fetch redirect policy (BLOCKING at audit):** custom/ollama openai-compatible fetch MUST NOT follow redirects to unvalidated targets — `redirect: 'manual'` (treat 3xx as provider error) or re-validate every hop's destination through the same guard. Backend to confirm the AI SDK client's default and record it in the audit. (T-I-5c)
2. **Ollama kill-switch:** add `ADMIN_ALLOW_OLLAMA_USERS` env flag (default `true` in dev; recommended `false` for prod) that disables create/use of user `ollama`-type providers. One gate in create + resolution. (T-E-3)
3. **Prod key hierarchy:** `.env.example` + README must document that prod deployments SHOULD set a dedicated 32-byte `ENCRYPTION_KEY`; HKDF-from-`AUTH_SECRET` is the dev fallback. Never raw `AUTH_SECRET` as the AES key. (T-I-4)
4. **Decrypt-error logging rule:** decrypt/encrypt failure logs carry `providerId` + error class only — never the ciphertext blob, never the plaintext, never the raw thrown error string (may embed either). Redact list is pattern-based and cannot catch ad-hoc field names. (T-R-1/T-I-2)
5. **Settings-page data path:** codify in US-306 that provider data reaches the page ONLY via `GET /api/providers` — no server-component DB reads of the `providers` table (keeps ciphertext out of the RSC flight payload). (T-I-3)
6. **Resolved-addresses SSRF note:** the denylist check must resolve the hostname (A + AAAA, ALL records) and compare resolved IPs against the ranges — never string-match the hostname (blocks `0x7f000001`, IPv4-mapped IPv6, multi-record rebinding-lite). Add to AC.3b implementation notes + tests. (T-E-2)
7. **CI grep gate:** `rehype-raw` and `dangerouslySetInnerHTML` forbidden in the message renderer (lint/grep step), same gate pattern as phases 1–2. (T-T-1)
8. **Rate-limit semantics:** confirm 30/10min is COMBINED across POST+PUT+DELETE (one bucket), and document that the message-send rate limit is provider-agnostic (custom providers cannot bypass it). (T-D-1, T-D-2)

---

## sign-off

- reviewed by: security (GLM 5.3 Flash tier)
- date: 2026-09-14
- status: **needs-mitigation** (audit pending code review; hardening #1 and #6 are audit-blocking gates; #2–#5, #7–#8 recommended pre-build)
- blocking findings: 0 (pre-build; redirect policy unconfirmed is a conditional blocker)
- hardening requests: 8
