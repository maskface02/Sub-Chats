# Phase 0 Build Issue — RESOLVED (swapped to pglite)

## what was the issue
`next build` failed because `better-sqlite3@11.10.0` had no prebuilt binary for Node 26.7.0 and the native compile via `node-gyp` failed in this env (missing toolchain).

## resolution
swapped SQLite for **pglite** (`@electric-sql/pglite`) — an in-process WASM Postgres. Pure JS to use, no native bindings required. Build now passes cleanly.

## what changed
- `src/lib/db/schema.ts`: rewrote with `drizzle-orm/pg-core` (`pgTable`, `timestamp`, `boolean`, `text`)
- `src/lib/db/index.ts`: swapped `better-sqlite3` + `drizzle-orm/better-sqlite3` → `PGlite` + `drizzle-orm/pglite`
- `src/lib/db/bootstrap.ts`: new file with `BOOTSTRAP_SQL` constant (idempotent CREATE statements) called by `ensureSchema()`
- `drizzle.config.ts`: `dialect: "postgresql"`
- `next.config.ts`: `serverExternalPackages: ["@electric-sql/pglite", "pino"]`
- `package.json`: removed `better-sqlite3` + `@types/better-sqlite3`, added `drizzle-orm@^0.45.0` + `@electric-sql/pglite@^0.5.0`
- `.env.example`: updated DATABASE_URL docs (dev = no URL = pglite memory; prod = postgres://...)

## how to use
```bash
# dev (no setup)
npm run dev   # pglite in-memory, auto-bootstraps schema

# dev with file persistence
PGLITE_DATA_DIR=./.pglite npm run dev

# prod
DATABASE_URL=postgres://... npm run build
DATABASE_URL=postgres://... npm run start
# in prod, also run real Drizzle migrations:
# DATABASE_URL=... npx drizzle-kit generate
# DATABASE_URL=... npx drizzle-kit migrate
```

## verification
- [x] `npx tsc --noEmit`: **0 errors**
- [x] `npx vitest run`: **17/17 pass**
- [x] `npx next build`: **PASS** — 9 static pages, 9 API routes, middleware, all bundles built

## phase 0 sign-off
**GREEN** — typecheck, tests, build all pass. Phase 0 complete.

