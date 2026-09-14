import { type NextRequest } from "next/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { providers } from "@/lib/db/schema";
import type { Session } from "next-auth";
import { checkProviderRateLimit } from "@/lib/auth/rate-limit";
import { CreateProviderRequestSchema, jsonError, jsonRaw } from "@/lib/types/api";
import { encrypt, CryptoError } from "@/lib/crypto/encrypt";
import { validateProviderBaseUrl } from "@/lib/ai/ssrf-guard";
import { toProviderDto } from "@/lib/ai/provider-dto";
import { withRequestLogging } from "@/lib/obs/request-logging";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER_LIMIT = 10;

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

async function listProviders(
  _req: NextRequest,
  _ctx: unknown,
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;

  const rows = await db
    .select()
    .from(providers)
    .where(eq(providers.userId, userId))
    .orderBy(asc(providers.createdAt));

  return jsonRaw({ items: rows.map(toProviderDto) }, 200);
}

export const GET = withRequestLogging(listProviders);

async function createProvider(
  req: NextRequest,
  _ctx: unknown,
  session: Session | null,
) {
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;

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

  const parsed = CreateProviderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "INVALID_INPUT", undefined, zodFields(parsed.error));
  }
  const data = parsed.data;

  if (data.baseUrl) {
    const ssrf = await validateProviderBaseUrl(data.baseUrl, data.type);
    if (!ssrf.ok) {
      return jsonError(422, "INVALID_INPUT", undefined, {
        baseUrl: ssrf.reason,
      });
    }
  }

  let ciphertext: string | null = null;
  if (data.apiKey !== undefined) {
    try {
      ciphertext = encrypt(data.apiKey);
    } catch (err) {
      log.error(
        { err, userId, providerType: data.type },
        "failed to encrypt provider API key",
      );
      return jsonError(500, "INTERNAL", "Could not store provider key");
    }
  }

  // one userId-filtered scan doubles as the cap check (≤10 rows/user)
  const existing = await db
    .select()
    .from(providers)
    .where(eq(providers.userId, userId));
  if (existing.length >= PROVIDER_LIMIT) {
    return jsonError(
      422,
      "PROVIDER_LIMIT",
      "You can store up to 10 providers",
    );
  }

  // first provider is always the default regardless of submitted value (AC.7)
  const isDefault =
    existing.length === 0 ? true : (data.isDefault ?? false);

  const newId = crypto.randomUUID();
  try {
    const inserted = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(providers)
        .values({
          id: newId,
          userId,
          type: data.type,
          baseUrl: data.baseUrl ?? null,
          apiKeyCiphertext: ciphertext,
          defaultModel: data.defaultModel ?? null,
          isDefault,
          createdAt: new Date(),
        })
        .returning();
      if (isDefault) {
        // clear the previous default in the same transaction (AC.6)
        await tx
          .update(providers)
          .set({ isDefault: false })
          .where(
            and(eq(providers.userId, userId), ne(providers.id, newId)),
          );
      }
      return rows;
    });
    const row = inserted[0];
    if (!row) {
      throw new Error("insert returned no row");
    }
    return jsonRaw(toProviderDto(row), 201);
  } catch (err) {
    if (err instanceof CryptoError) {
      log.error({ err, userId }, "provider insert failed on crypto error");
      return jsonError(500, "INTERNAL", "Could not store provider key");
    }
    log.error({ err, userId, providerType: data.type }, "failed to create provider");
    return jsonError(500, "INTERNAL", "Could not create provider");
  }
}

export const POST = withRequestLogging(createProvider);
