# Phase 0 Open Questions — Orchestrator Decisions

**date:** 2026-09-13
**phase:** 0
**decided_by:** Orchestrator
**input:** PM's 10 open questions in `.orchestrator/specs/phase-0.md` §10

| # | question | decision | rationale |
|---|---|---|---|
| 1 | Conversation title at creation | **keep "New chat" placeholder in phase 0** | simpler; auto-derive is a phase 1 nice-to-have |
| 2 | Ollama default model | **fallback `llama3.2`; first from `/api/tags` if available** | PM's recommendation is correct; aligns with Vercel AI SDK community examples |
| 3 | OpenAI model choice | **`gpt-4o-mini`** | cheapest capable; upgrade to gpt-4o is one env var away |
| 4 | Sign-up fields | **email + password (+ optional name); no confirm-email field** | defer email verification to phase 3 |
| 5 | Password complexity | **≥8 chars, no other rules** | keeps dev simple; tighten in phase 3 if needed |
| 6 | Rate-limit scope | **in-memory, 5/15min/IP** | single-instance dev is fine; move to Upstash when we scale |
| 7 | assistant-ui in phase 0 | **use it for basic chat surface (composer + thread)** | saves UI work; defer advanced primitives to phase 1 |
| 8 | Session lifetime | **Auth.js default (30 days)** | standard; tighten in security audit if reviewer flags |
| 9 | Deployment target | **defer Vercel config (vercel.json, env wiring) to phase 1** | phase 0 is dev-only; no need to bake in deploy config yet |
| 10 | Anthropic wired but unused | **defer to phase 3; `@ai-sdk/anthropic` stays as dep but unwired** | keep fallback chain simple (OpenAI → Ollama) for phase 0 |

## impact on spec
none of these change the spec's structure or AC. The 4 fixes already applied by Orchestrator (bcrypt cost, package name, 429 status, stream lock mechanism) are also documented in the spec header (`frozen_revision: 2`).

## next action
hand frozen spec to all roles. spawn Backend + Frontend + DevOps + Security + Tech Writer in parallel.
