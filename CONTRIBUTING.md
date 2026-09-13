# Contributing

Thanks for your interest in Sub-chats. This project is built by a small team using a multi-agent orchestration process — please skim the relevant section before opening an issue or PR.

## Filing a bug

Open a GitHub issue with:

1. **What happened** — one paragraph, no narrative. Include the exact error text if any.
2. **What you expected** — one sentence.
3. **Reproduction** — minimal steps. Include:
   - Phase (e.g. phase 0 / setup)
   - Node version (`node --version`)
   - Whether you used OpenAI or Ollama
   - Relevant request/response if it is an API bug (curl + output)
4. **Environment** — OS, browser, `npm --version`.
5. **Severity** — blocker / minor / cosmetic. Use your judgement.

If it is a **security issue**, do **not** open a public issue. Email the maintainers (see repo metadata) instead.

## Pull requests

1. **Open an issue first** for non-trivial changes. Small fixes (typos, broken links, one-line bugs) can skip this.
2. **One concern per PR.** Avoid mixing refactors with feature work.
3. **Reference the spec.** Every behaviour change should map to a section in `.orchestrator/specs/phase-N.md`. If it does not, the spec probably needs updating first.
4. **Tests:**
   - User-facing changes → add a Playwright case under `tests/e2e/`.
   - Library / pure-logic changes → add a Vitest case under `tests/unit/`.
5. **Local checks must pass** before requesting review:

   ```bash
   npm run typecheck
   npm run lint
   npm run build
   ```

6. **No secrets in diffs.** `.env*`, API keys, and credentials are blocked by `.gitignore`; if you need to reference them in tests, use `process.env.MY_VAR` and document the variable in `.env.example`.
7. **Docs:** if your change is user-facing, update the matching page under `docs/`. The Tech Writer role reviews doc-only PRs.

Use the [PR description template](.orchestrator/templates/pr-description.md).

## Code style

- **TypeScript strict.** No `any` unless the surrounding code forces it; prefer `unknown` + a narrow check.
- **Match neighbouring files.** Look at two or three files in the same directory before adding a new one — copy the import order, naming, and module structure.
- **Server vs client components** — default to Server Components in App Router. Add `"use client"` only when the file uses state, effects, or browser APIs.
- **Validate at the trust boundary** — every route handler validates its body with a Zod schema; do not trust the client.
- **Use the existing logger** (`pino`) instead of `console.log` outside scripts.

Examples to read first when in doubt:

| If you are touching… | Read first |
|---|---|
| Auth or sessions | `src/lib/auth.ts` |
| DB queries | `src/lib/db/schema.ts` + `src/lib/db/queries/` |
| AI streaming | `src/lib/ai/provider.ts` + `src/app/api/chats/[id]/messages/route.ts` |
| Chat UI | `src/components/assistant-ui/*` + `src/app/chats/[id]/page.tsx` |

## How the orchestration works

This project is built by an **orchestrator + 8 specialised roles** (PM, Backend, Frontend, DevOps, Security, Tech Writer, UX, Reviewer). Phase work is:

1. PM writes a **frozen phase spec** under `.orchestrator/specs/phase-N.md`.
2. The orchestrator resolves open questions in `.orchestrator/decisions/`.
3. Each role receives the spec + a short brief in `.orchestrator/roles/<role>.md` and produces its deliverables (code, config, docs, threat model, …).
4. Each role writes a handoff under `.orchestrator/handoffs/<role>-phase-N.md` listing what it shipped, what's deferred, and open issues.
5. Reviewer (Muse Spark) checks against the phase's **definition of done** (spec §11).
6. When DoD is met, the orchestrator advances `STATE.md` to the next phase.

If you are contributing from outside the orchestrator loop:

- **Read `STATE.md`** to see what phase we are on and what is in scope.
- **Read the active phase spec** for ACs and out-of-scope rules.
- **Open an issue** with your proposal before writing code that crosses role boundaries (e.g., a UI change that needs a new API route).

## Communication

- **Bugs and features** — GitHub issues.
- **Security** — email, not issues.
- **Questions** — GitHub Discussions, if enabled.

## License

By contributing you agree your contributions are licensed under the project's [MIT License](../LICENSE).
