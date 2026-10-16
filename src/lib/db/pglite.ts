import "server-only";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  var __pgliteSchemaVersion: number | undefined;
}

function getPgliteClient(): PGlite {
  if (globalThis.__pgliteClient) return globalThis.__pgliteClient;
  const dataDir = process.env.PGLITE_DATA_DIR ??
    (process.env.NODE_ENV === "development" ? resolve(".data/pglite") : undefined);
  if (dataDir && !dataDir.includes(":")) mkdirSync(dirname(dataDir), { recursive: true });
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
  if (!globalThis.__pgliteSchemaReady || globalThis.__pgliteSchemaVersion !== 2) {
    // Wire ensureSchema into init (previously zero callers). PGlite executes
    // queries in issue order, so issuing the bootstrap here — before any
    // consumer can issue a query — guarantees schema-before-first-use.
    globalThis.__pgliteSchemaReady = ensureSchema();
    globalThis.__pgliteSchemaVersion = 2;
  }
  return drizzle(client, { schema, logger: false }) as unknown as Db;
}
