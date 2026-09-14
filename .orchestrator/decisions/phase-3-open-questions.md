# Phase 3 Open Questions — Orchestrator Decisions

**date:** 2026-09-13
**phase:** 3
**decided_by:** Orchestrator
**input:** PM's 6 open questions in `.orchestrator/specs/phase-3.md` §12

| # | question | decision | rationale |
|---|---|---|---|
| 1 | streaming markdown | **after-complete** (PM default) | progressive markdown re-parsing per token is expensive and flickers; render markdown once the stream finishes, plain-text accumulation during streaming (same as phase 0-2 behavior) |
| 2 | anthropic default model | **haiku** (PM default) | cheapest capable; matches gpt-4o-mini cost posture |
| 3 | images in AI output | **links only** (PM default) | `<img src>` leaks user IP to arbitrary servers (privacy/SSRF-adjacent); markdown image syntax renders as a plain link in phase 3 |
| 4 | syntax highlighting lib for phase 4 | **rehype-highlight** (PM default) | lighter than shiki, CSS-class based, no worker; revisit if quality insufficient |
| 5 | per-conversation model picker | **out of phase 3** (PM default) | conversation uses user's default provider at send time; picker is phase 4 polish |
| 6 | ENCRYPTION_KEY | **optional with HKDF from AUTH_SECRET** (PM default) | zero-config dev; dedicated key recommended for prod (documented in .env.example) |

## Reviewer-driven spec fixes (applied by Orchestrator before freeze)
1. **SSRF guard (blocking)** — US-301 AC.3b added: scheme allowlist + private/loopback/linkback IP denylist for `custom` type at create/update AND send-time; `ollama` exempt (documented accept-risk); DNS-rebinding mitigated by send-time re-validation; unit tests mandated in AC-P3-12
2. **pino redact AC** — US-302 AC.2 now explicitly requires extending redact with `*.apiKey`, `*.apiKeyCiphertext`, `*.ANTHROPIC_API_KEY`, `*.ENCRYPTION_KEY` before any provider code logs
3. **hint-decrypt failure** — US-302 AC.3: list-time decrypt failure → `apiKeyHint: null` + warn log, row still listed, no 500
4. **SSRF unit tests** — added to AC-P3-12

## next action
Hand frozen spec to all roles. Spawn Backend + Frontend + Security + Tech Writer in parallel.
