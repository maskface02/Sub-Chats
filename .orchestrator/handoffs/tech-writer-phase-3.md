# Handoff — Tech Writer, phase 3 (providers + markdown)

**date:** 2026-09-14
**phase:** 3
**spec:** `.orchestrator/specs/phase-3.md` (frozen rev 2)
**decisions:** `.orchestrator/decisions/phase-3-open-questions.md`

## Files updated

| file | change |
|---|---|
| `README.md` | badges → phase 3; features + "Bring your own key" and "Markdown rendering"; status/phase line updated; roadmap: phase 3 marked shipped, phase 4 = syntax highlighting + attachments + tools + MFA; "not yet shipped" list refreshed |
| `docs/getting-started.md` | new **Bring your own key** section (settings walkthrough for OpenAI / Anthropic / Ollama / Custom, first-provider auto-default, key encryption + masking); **Provider fallback** rewritten (per-request resolution, user default → env chain incl. Anthropic); `/api/health` smoke test updated with `anthropic` + `source` |
| `docs/architecture.md` | new **Provider resolution (phase 3)** section: precedence algorithm, per-request resolution, no-failover note; **Key encryption at rest** (AES-256-GCM, `v1:<iv>:<ciphertext>`, HKDF fallback, pino redact, masked hints); **SSRF guard** (scheme allowlist, private-IP denylist for `custom`, ollama exemption documented as accept-risk, send-time re-validation); **Markdown rendering** (react-markdown safe config, after-complete); AI-layer boot-time resolution paragraph replaced; Security "secrets at rest" line updated |
| `docs/api/endpoints.md` | new **Provider endpoints** section: `GET/POST /api/providers`, `PUT/DELETE /api/providers/:id` with request/response shapes, per-type field rules, 10-provider cap, first-provider auto-default, rate limits (429 + headers), SSRF 422, byte-identical 404 policy, curl examples; explicit masked-key policy callout; `GET /api/health` extended with `source`; See-also gains phase 3 spec |
| `.env.example` | `ENCRYPTION_KEY` block added (prod recommended, dev derives from AUTH_SECRET, generate via `openssl rand -base64 32`); `ANTHROPIC_API_KEY` comment updated (wired, third in env chain) |

## Links checked

All internal links in modified files resolve: `docs/getting-started.md` ↔ `architecture.md` anchors, `docs/api/endpoints.md` ↔ `../architecture.md#provider-resolution-phase-3`, README feature links → `docs/getting-started.md#bring-your-own-key`, roadmap spec link, handoff cross-references in See-also.
**links_checked:** 14 · **broken_links:** 0

## Open issues

- **Screenshots TBD** — README "Screenshots" section and settings-page walkthrough need captures: add-provider form (all 4 types showing conditional fields), provider list with masked hint + default radio, markdown table/code-block rendering. Owner: UX in phase 3 review.
- `/api/health` sample response body in getting-started not yet updated to include `source` (field documented in endpoints.md; sample shows phase-0 shape) — minor, fix with screenshots.
- Encryption key-rotation copy for users (what happens when `ENCRYPTION_KEY` changes) documented only in architecture; could use a troubleshooting entry later.

## Phase 4 plan (docs)

1. Update README features/roadmap for rehype-highlight + attachments + tools; knock syntax highlighting out of "not shipped".
2. Extend markdown docs (§9 table) with highlighting config; US-308 code-block section.
3. New API entries for attachment/tool endpoints once specs freeze.
4. Release notes under `.orchestrator/handoffs/release-notes/phase-3.md` (deferring this to phase sign-off).
