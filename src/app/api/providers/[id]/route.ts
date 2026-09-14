import { type NextRequest } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { providers } from "@/lib/db/schema";
import type { Session } from "next-auth";
import { checkProviderRateLimit } from "@/lib/auth/rate-limit";
import {
  UpdateProviderRequestSchema,
  jsonError,
  jsonRaw,
  type ProviderDto,
} from "@/lib/types/api";
import { encrypt, CryptoError } from "@/lib/crypto/encrypt";
import { validateProviderBaseUrl } from "@/lib/ai/ssrf-guard";
import { toProviderDto } from "@/lib/ai/provider-dto";
import { withRequestLogging } from "@/lib/obs/request-logging";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function zodFields(error: { issues: Array<{ path: (string | number)[]; message: string }> }): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0]?.toString() ?? "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

function rateLimitHeaders(res: Response, retryAfterMs: number): Response {
  res.headers.set("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
  res.headers.set("X-RateLimit-Limit", "30");
  res.headers.set("X-RateLimit-Remaining", "0");
  res.headers.set(
    "X-RateLimit-Reset",
    new Date(Date.now() + retryAfterMs).toISOString(),
  );
  return res;
}

function notFound(): Response {
  // byte-identical for missing id and foreign-owned id (US-301 AC.10)
  return jsonError(404, "NOT_FOUND", "Provider not found");
}

async function updateProvider(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

  const rl = checkProviderRateLimit(userId);
  if (!rl.allowed) {
    const seconds = Math.ceil(rl.retryAfterMs / 1000);
    return rateLimitHeaders(
      jsonError(
        429,
        "RATE_LIMITED",
        `Too many provider changes — try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
      ),
      rl.retryAfterMs,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(422, "INVALID_INPUT");
  }

  // .strict() → a supplied `type` lands here as an unknown-field 422 (immutable)
  const parsed = UpdateProviderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "INVALID_INPUT", undefined, zodFields(parsed.error));
  }
  const data = parsed.data;

  const rows = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return notFound();

  if (data.baseUrl !== undefined) {
    const ssrf = await validateProviderBaseUrl(data.baseUrl, row.type);
    if (!ssrf.ok) {
      return jsonError(422, "INVALID_INPUT", undefined, {
        baseUrl: ssrf.reason,
      });
    }
  }

  let ciphertext: string | undefined;
  if (data.apiKey !== undefined) {
    try {
      ciphertext = encrypt(data.apiKey);
    } catch (err) {
      log.error(
        { err, userId, providerId: row.id },
        "failed to encrypt provider API key",
      );
      return jsonError(500, "INTERNAL", "Could not store provider key");
    }
  }

  const set: Partial<typeof providers.$inferInsert> = {};
  if (data.baseUrl !== undefined) set.baseUrl = data.baseUrl;
  if (ciphertext !== undefined) set.apiKeyCiphertext = ciphertext;
  if (data.defaultModel !== undefined) set.defaultModel = data.defaultModel;
  if (data.isDefault !== undefined) set.isDefault = data.isDefault;

  try {
    if (Object.keys(set).length > 0) {
      await db.transaction(async (tx) => {
        await tx.update(providers).set(set).where(eq(providers.id, row.id));
        if (data.isDefault === true) {
          await tx
            .update(providers)
            .set({ isDefault: false })
            .where(
              and(eq(providers.userId, userId), ne(providers.id, row.id)),
            );
        }
      });
    }
  } catch (err) {
    if (err instanceof CryptoError) {
      log.error({ err, userId, providerId: row.id }, "provider update failed on crypto error");
      return jsonError(500, "INTERNAL", "Could not store provider key");
    }
    log.error({ err, userId, providerId: row.id }, "failed to update provider");
    return jsonError(500, "INTERNAL", "Could not update provider");
  }

  const updated: ProviderDto = toProviderDto({ ...row, ...set } as typeof row);
  return jsonRaw(updated, 200);
}

export const PUT = withRequestLogging(updateProvider);

async function deleteProvider(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

  const rl = checkProviderRateLimit(userId);
  if (!rl.allowed) {
    const seconds = Math.ceil(rl.retryAfterMs / 1000);
    return rateLimitHeaders(
      jsonError(
        429,
        "RATE_LIMITED",
        `Too many provider changes — try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
      ),
      rl.retryAfterMs,
    );
  }

  const rows = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return notFound();

  try {
    // no auto-promotion when the default is deleted (AC.9 → env fallback)
    await db.delete(providers).where(eq(providers.id, row.id));
  } catch (err) {
    log.error({ err, userId, providerId: row.id }, "failed to delete provider");
    return jsonError(500, "INTERNAL", "Could not delete provider");
  }

  return new Response(null, { status: 204 });
}

export const DELETE = withRequestLogging(deleteProvider);
