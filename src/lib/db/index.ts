import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { schema } from "./schema";
import { log } from "@/lib/log";

const globalForDb = globalThis as unknown as {
  __sqliteClient?: Database.Database;
  __drizzleDb?: ReturnType<typeof drizzle<typeof schema>>;
};

function rawUrl(): string {
  const raw = process.env.DATABASE_URL ?? "file:./local.db";
  return raw.startsWith("file:") ? raw.slice("file:".length) : raw;
}

function getSqliteClient(): Database.Database {
  if (globalForDb.__sqliteClient) return globalForDb.__sqliteClient;
  const url = rawUrl();
  const client = new Database(url);
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  log.info({ url }, "sqlite client initialized");
  globalForDb.__sqliteClient = client;
  return client;
}

export const db = (() => {
  if (globalForDb.__drizzleDb) return globalForDb.__drizzleDb;
  const client = getSqliteClient();
  const instance = drizzle(client, { schema, logger: false });
  globalForDb.__drizzleDb = instance;
  return instance;
})();