import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, dbReady } from "@/lib/db";
import { getActiveProviderFor } from "@/lib/ai/provider";
import { withRequestLogging } from "@/lib/obs/request-logging";
import { jsonRaw } from "@/lib/types/api";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2000;

async function checkDbReachable(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("db health check timed out")),
          DB_TIMEOUT_MS,
        );
      }),
    ]);
    return true;
  } catch (err) {
    log.warn({ err }, "health: database unreachable");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function checkMigrationsApplied(): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT to_regclass('public.conversations') IS NOT NULL AS has_conversations,
             EXISTS (
               SELECT 1 FROM information_schema.columns
               WHERE table_name = 'conversations' AND column_name = 'deleted_at'
             ) AS has_soft_delete
    `);
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    const row = rows[0];
    return Boolean(row?.has_conversations) && Boolean(row?.has_soft_delete);
  } catch (err) {
    log.warn({ err }, "health: migration sentinel check failed");
    return false;
  }
}

export const GET = withRequestLogging(
  async () => {
    await dbReady;

    const session = await auth();
    const userId = session?.user?.id ?? null;

    const [dbReachable, migrationsApplied, providerResolved] = await Promise.all([
      checkDbReachable(),
      checkMigrationsApplied(),
      getActiveProviderFor(userId)
        .then((p) => p !== null)
        .catch(() => false),
    ]);

    const ok = dbReachable && migrationsApplied && providerResolved;
    // Non-revealing by AC.11: booleans only — no provider names/models/DSNs.
    return jsonRaw(
      {
        status: ok ? "ok" : "degraded",
        dbReachable,
        providerResolved,
        migrationsApplied,
      },
      ok ? 200 : 503,
    );
  },
  { resolveSession: false },
);
