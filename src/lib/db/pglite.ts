import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema } from "./schema";
import { BOOTSTRAP_SQL } from "./bootstrap";
import { log } from "@/lib/log";
import type { Db } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var __pgliteClient: PGlite | undefined;
  // eslint-disable-next-line no-var
  var __pgliteSchemaReady: Promise<void> | undefined;
}

function getPgliteClient(): PGlite {
  if (globalThis.__pgliteClient) return globalThis.__pgliteClient;
  const dataDir = process.env.PGLITE_DATA_DIR ?? undefined;
  const client = new PGlite(dataDir);
  log.info({ dataDir: dataDir ?? ":memory:" }, "pglite client initialized");
  globalThis.__pgliteClient = client;
  return client;
}

/**
 * Applies the full schema (idempotent CREATE IF NOT EXISTS / ADD COLUMN IF
 * NOT EXISTS). Dev-only: the prod postgres path relies on `drizzle-kit
 * migrate` instead (US-510 AC.18).
 */
export async function ensureSchema(): Promise<void> {
  await getPgliteClient().exec(BOOTSTRAP_SQL);
  log.info("pglite schema bootstrap applied");
}

export function makePgliteDb(): Db {
  const client = getPgliteClient();
  if (!globalThis.__pgliteSchemaReady) {
    // Wire ensureSchema into init (previously zero callers). PGlite executes
    // queries in issue order, so issuing the bootstrap here — before any
    // consumer can issue a query — guarantees schema-before-first-use.
    globalThis.__pgliteSchemaReady = ensureSchema();
  }
  return drizzle(client, { schema, logger: false }) as unknown as Db;
}
