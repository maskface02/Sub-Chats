import "server-only";
import { makePgliteDb } from "@/lib/db/pglite";
import { makePostgresDb } from "@/lib/db/postgres";
import type { Db } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var __dbInstance: Db | undefined;
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const isPostgresUrl = /^postgres(ql)?:\/\//.test(DATABASE_URL);

function makeDb(): Db {
  return isPostgresUrl ? makePostgresDb(DATABASE_URL) : makePgliteDb();
}

// Re-enter the PGlite factory after an additive schema change during hot reload.
// It reuses the existing client and issues the idempotent bootstrap first.
export const db: Db = (!isPostgresUrl && globalThis.__pgliteSchemaVersion !== 2)
  ? (globalThis.__dbInstance = makeDb())
  : globalThis.__dbInstance ?? (globalThis.__dbInstance = makeDb());

// Resolves once the pglite schema bootstrap has been issued (no-op promise on
// the postgres path — migrations there are managed by drizzle-kit migrate).
export const dbReady: Promise<void> =
  globalThis.__pgliteSchemaReady ?? Promise.resolve();

export { ensureSchema } from "@/lib/db/pglite";
