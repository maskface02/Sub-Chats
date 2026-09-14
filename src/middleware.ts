import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  // Stash the id for downstream consumers (API handlers read it to correlate
  // logs; AC.9 echoes it back on the response).
  requestHeaders.set("x-request-id", requestId);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("X-Request-Id", requestId);
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "connect-src 'self' https://api.openai.com http://localhost:11434",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
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
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
