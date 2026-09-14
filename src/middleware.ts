import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers + request-id middleware.
 *
 * CSP uses the official Next.js nonce pattern: the nonce is set on the
 * REQUEST headers (Next reads it and stamps its own inline bootstrap
 * scripts), and the same CSP is echoed on the RESPONSE. Without the nonce,
 * `script-src 'self'` blocks Next's inline hydration bootstrap → the page
 * paints server HTML then goes blank (no hydration). 'strict-dynamic' lets
 * the nonce'd bootstrap load the chunk scripts. Dev additionally needs
 * 'unsafe-eval' (React Refresh / HMR).
 */
export function middleware(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const isDev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    "connect-src 'self' https://api.openai.com http://localhost:11434",
    "img-src 'self' data: blob:",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isDev ? " 'unsafe-eval'" : ""
    }`,
    "style-src 'self' 'unsafe-inline'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  // Stash the id for downstream consumers (API handlers read it to correlate
  // logs; the wrapper echoes it back on the response) and the nonce+CSP for
  // Next to stamp its own scripts.
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("X-Request-Id", requestId);
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // HSTS is a production-only gate (phase-5 US-509 AC.15 / Security C3):
  // dev runs on http://localhost where the header would poison the browser's
  // view of localhost. VERCEL_ENV is set by Vercel; NODE_ENV=production covers
  // other hosts.
  const isProd =
    process.env.VERCEL_ENV === "production" ||
    (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV);
  if (isProd) {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
