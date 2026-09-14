import "server-only";
import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { withRequestId } from "@/lib/log";

type ApiHandler<Ctx> = (
  req: NextRequest,
  ctx: Ctx,
  session: Session | null,
) => Promise<Response> | Response;

/**
 * Wraps an API route handler with structured request logging (US-504 AC.8/9).
 * The wrapper resolves the session ONCE and passes it to the handler as the
 * third argument — handlers must use it instead of calling auth() again.
 * Pass { resolveSession: false } for routes that must not touch auth()
 * (pre-credential routes, health).
 *
 * Logging is best-effort: it never throws and never alters the response
 * beyond adding X-Request-Id.
 */
export function withRequestLogging<Ctx>(
  handler: ApiHandler<Ctx>,
  opts: { resolveSession?: boolean } = {},
): (req: NextRequest, ctx: Ctx) => Promise<Response> {
  const resolveSession = opts.resolveSession !== false;

  return async (req, ctx) => {
    const startedAt = performance.now();
    const requestId =
      req?.headers?.get?.("x-request-id") ?? crypto.randomUUID();
    let route = "unknown";
    try {
      route = req?.url ? new URL(req.url).pathname : "unknown";
    } catch {
      // non-URL request (tests) — keep placeholder
    }
    let session: Session | null = null;
    let status = 500;

    try {
      if (resolveSession) {
        try {
          session = await auth();
        } catch (err) {
          withRequestId(requestId).debug(
            { err },
            "session resolution failed; request logged as anonymous",
          );
        }
      }
      const res = await handler(req, ctx, session);
      status = res.status;
      res.headers.set("X-Request-Id", requestId);
      return res;
    } finally {
      const userId = session?.user?.id;
      withRequestId(requestId).info(
        {
          route,
          status,
          durationMs: Math.round(performance.now() - startedAt),
          ...(userId ? { userId } : {}),
        },
        "api request",
      );
    }
  };
}
