import { type NextRequest } from "next/server";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import {
  checkRateLimit,
  resetRateLimit,
  rateLimitConfig,
} from "@/lib/auth/rate-limit";
import {
  SignInRequestSchema,
  jsonError,
  jsonRaw,
} from "@/lib/types/api";
import { log } from "@/lib/log";

export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

const CallbackSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  callbackUrl: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = SignInRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, "INVALID_INPUT");
  }

  const ip = clientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    log.warn({ ip, retryAfterMs: limit.retryAfterMs }, "rate limited");
    const res = jsonError(
      429,
      "RATE_LIMITED",
      `Too many attempts. Try again in ${Math.ceil(limit.retryAfterMs / 60000)} minutes`,
    );
    res.headers.set(
      "Retry-After",
      Math.ceil(limit.retryAfterMs / 1000).toString(),
    );
    res.headers.set("X-RateLimit-Limit", rateLimitConfig.signin.maxAttempts.toString());
    res.headers.set("X-RateLimit-Remaining", "0");
    return res;
  }

  const safe = CallbackSchema.parse({
    email: parsed.data.email,
    password: parsed.data.password,
    callbackUrl: parsed.data.callbackUrl,
  });

  try {
    await signIn("credentials", {
      email: safe.email.toLowerCase(),
      password: safe.password,
      redirect: false,
    });
    // success → reset counter so only failed attempts count
    resetRateLimit(ip);
    const res = jsonRaw({ ok: true }, 200);
    res.headers.set(
      "X-RateLimit-Limit",
      rateLimitConfig.signin.maxAttempts.toString(),
    );
    res.headers.set(
      "X-RateLimit-Remaining",
      rateLimitConfig.signin.maxAttempts.toString(),
    );
    return res;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    const type = (err as { type?: string })?.type;
    if (
      name === "CredentialsSignin" ||
      type === "CredentialsSignin" ||
      type === "CallbackRouteError"
    ) {
      return jsonError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password",
      );
    }
    log.error({ err }, "sign-in error");
    return jsonError(500, "PROVIDER_FAILED", "Sign-in failed");
  }
}