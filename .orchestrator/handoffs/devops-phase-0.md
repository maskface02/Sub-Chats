---
handoff_id: HOFF-001
date: 2026-09-13
from_role: devops
to_role: backend
phase: 0
priority: medium
---

## what was produced

- `.github/workflows/ci.yml` — CI workflow with two jobs (`verify` + `e2e`); triggers on push to `main` and every PR.
- `src/lib/log.ts` — pino logger (default export `log`, named export `withRequestId`).
- `.env.example` — verified; already documents all phase-0 vars including `LOG_LEVEL`. No changes needed.

## logger usage for backend

Import the default logger:

```ts
import log from "@/lib/log";

// Provider resolution (spec §8 AC.2 — log once per server boot at info level)
log.info({ provider: "openai", model: "gpt-4o-mini" }, "active provider resolved");

// Error reporting — always pass the error as `err`, not interpolated into the message
log.error({ err }, "chat stream failed");
```

For request-scoped correlation IDs (use the header value if present, else generate):

```ts
import { withRequestId } from "@/lib/log";

export async function POST(req: Request) {
  const requestId =
    req.headers.get("x-request-id") ?? crypto.randomUUID();

  const log = withRequestId(requestId);
  log.info({ route: "/api/chats", method: "POST" }, "request received");
  // ...
  log.info({ conversationId, model: "gpt-4o-mini" }, "stream started");
}
```

The child logger merges `{ requestId }` into every subsequent log line so production logs can be filtered by request ID.

### behaviour matrix

| `NODE_ENV`       | output   | transport    |
| ---------------- | -------- | ------------ |
| `development`    | colored, human-readable | `pino-pretty` |
| `production`     | JSON, one line per event | none |

Level is read from `LOG_LEVEL` env (`trace`/`debug`/`info`/`warn`/`error`/`fatal`); defaults to `info`.

### constraint: server-only

`src/lib/log.ts` MUST NOT be imported from a `"use client"` file or any module that ends up in the client bundle. `pino` is already listed in `next.config.ts > serverExternalPackages`, so the package itself won't ship to the browser — but importing it from a client module will throw at runtime. If you need a logger in a client component, do not use this file; use `console.*` instead. (A `import "server-only"` guard can be added later when the `server-only` package is in deps.)

## health-check shape contract (for `GET /api/health`)

Per spec §5, the route returns this exact shape:

```jsonc
{
  "status": "ok",
  "provider": {
    "type": "openai" | "ollama" | null,
    "model": "gpt-4o-mini" | "llama3.2:latest" | null,
    "baseUrl": "http://localhost:11434/v1" | null
  },
  "ollamaReachable": true | false
}
```

Notes:

- `provider.type` is `null` only when neither `OPENAI_API_KEY` is set nor Ollama is reachable (spec US-008 AC.1 step 3 → `HTTP 503 NO_PROVIDER` on chat requests).
- `provider.baseUrl` is non-null only for `ollama` (OpenAI uses its SDK default).
- `ollamaReachable` is always populated so DevOps can verify the Ollama leg of the fallback chain even when OpenAI wins.
- Status code is always `200` for the health endpoint itself (even when `provider.type === null`) — clients should branch on `provider.type` to render the "no provider" banner per spec §4.

## CI workflow summary

| job       | runner            | steps                                                                                   | parallel |
| --------- | ----------------- | --------------------------------------------------------------------------------------- | -------- |
| `verify`  | ubuntu-latest     | checkout → setup-node@20 (npm cache) → `npm ci` → lint → typecheck → unit → build       | runs first |
| `e2e`     | ubuntu-latest     | checkout → setup-node@20 → `npm ci` → `playwright install --with-deps chromium` → e2e    | after `verify` |

- Concurrency: in-progress runs are cancelled when a new commit hits the same ref.
- Permissions: `contents: read` only.
- `AUTH_SECRET` is provided as a dummy env for the build (Auth.js v5 requires it at module load); the real secret is not needed at build time.
- `OPENAI_API_KEY` is wired from a GitHub Actions secret for `e2e`; tests are expected to handle absence by exercising the no-provider / Ollama paths per spec §8.

### assumptions documented in the workflow

1. **No `package-lock.json` yet.** Phase 0 has no `node_modules` or lock file committed. The `npm ci || npm install` fallback makes the first CI run self-healing; once Backend/Frontend lock the dep graph, the workflow uses `npm ci` strictly. Generate the lockfile with `npm install` locally and commit it before phase 0 ships.
2. **No vitest/playwright test files yet.** `test:unit` and `test:e2e` will exit non-zero until Backend/Frontend write tests. This is expected — CI gates go green once the suite exists.
3. **Playwright browsers.** Installed fresh per run (`--with-deps chromium` only). Add caching if the suite grows.

## needed deps

None. `pino@^9.5.0` and `pino-pretty@^13.0.0` are already in `package.json > dependencies`. `server-only` is NOT added; see constraint above.

## deferred to phase 1

- `instrumentation.ts` (Sentry wiring) — spec §9 explicitly defers; `@sentry/nextjs@^8.47.0` is installed but not configured.
- Production deploy config (`vercel.json`, env-var wiring in hosting dashboard) — Orchestrator decision #9.
- Runbook, secret rotation procedure, backup procedure — phase 1 deliverable.

## open issues

(none)
