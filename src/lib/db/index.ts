import "server-only";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema } from "./schema";
import { BOOTSTRAP_SQL } from "./bootstrap";
import { log } from "@/lib/log";

declare global {
  // eslint-disable-next-line no-var
  var __pgliteClient: PGlite | undefined;
  // eslint-disable-next-line no-var
  var __drizzleDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function getPgliteClient(): PGlite {
  if (globalThis.__pgliteClient) return globalThis.__pgliteClient;
  const dataDir = process.env.PGLITE_DATA_DIR ?? undefined;
  const client = new PGlite(dataDir);
  log.info({ dataDir: dataDir ?? ":memory:" }, "pglite client initialized");
  globalThis.__pgliteClient = client;
  return client;
}

function makeDb() {
  const client = getPgliteClient();
  return drizzle(client, { schema, logger: false });
}

export const db = (() => {
  if (globalThis.__drizzleDb) return globalThis.__drizzleDb;
  const instance = makeDb();
  globalThis.__drizzleDb = instance;
  return instance;
})();

/**
 * Ensure schema exists. Called once on first DB use in dev.
 * Idempotent (all CREATE statements use IF NOT EXISTS).
 * In production, prefer running real Drizzle migrations via `drizzle-kit migrate`.
 */
export async function ensureSchema(): Promise<void> {
  await getPgliteClient().exec(BOOTSTRAP_SQL);
  log.info("pglite schema bootstrap applied");
}
