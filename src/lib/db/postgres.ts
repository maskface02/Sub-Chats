import "server-only";
import { createRequire } from "node:module";
import { schema } from "./schema";
import { log } from "@/lib/log";
import type { Db } from "./types";

type PoolCtor = new (config: { connectionString: string }) => unknown;

/**
 * node-postgres branch (US-510). pg is resolved at runtime via createRequire:
 * the driver is only loaded when DATABASE_URL is a postgres URL, so the
 * pglite-only dev environment never needs `pg` installed and the build never
 * connects. sslmode in DATABASE_URL is honored by pg itself — pass-through,
 * never forced here.
 */
export function makePostgresDb(connectionString: string): Db {
  const nodeRequire = createRequire(import.meta.url);
  const { Pool } = nodeRequire("pg") as { Pool: PoolCtor };
  const { drizzle } = nodeRequire(
    "drizzle-orm/node-postgres",
  ) as typeof import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString });
  log.info("postgres client initialized (node-postgres)");
  return drizzle(pool as never, { schema, logger: false });
}
