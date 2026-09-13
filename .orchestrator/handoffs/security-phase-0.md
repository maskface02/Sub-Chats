# Security Handoff — Phase 0

**from:** security
**to:** Backend, Frontend, DevOps, PM (spec hardening requests)
**phase:** 0 — Setup + Root Chat End-to-End
**date:** 2026-09-13
**full docs:** `.orchestrator/security/threat-models/phase-0.md`, `.orchestrator/security/audits/phase-0.md`, `.orchestrator/security/checklist.md`

---

## threat model summary

Phase 0 introduces a Next.js 15 chat app with email+password auth (Auth.js v5 + Drizzle adapter), streamed AI replies (Vercel AI SDK), and a 6-table SQLite schema (dev) / Postgres (prod) schema. I modeled the surface across all 8 API routes, the AI provider fallback chain, the auth flow, and DB access.

**Total threats identified:** 40 across STRIDE categories
- high: 12
- medium: 17
- low: 11

OWASP Top 10 (2025) coverage:
- A01 Broken Access Control → primary concern; mitigated by `requireAuth()` + cross-user 404
- A02 Cryptographic Failures → bcrypt cost 12 ✓; `AUTH_SECRET` handling critical
- A03 Injection → Drizzle safe by default; verify no raw `sql\`\``
- A04 Insecure Design → stream lock ✓; **rate limit on messages missing — spec hardening needed**
- A05 Security Misconfiguration → headers + error handler covered below
- A07 Identification & Auth Failures → rate limit ✓; 404 on cross-user ✓
- A09 Logging & Monitoring → pino redact + correlation id; **no current spec — items below**

No `critical` findings block implementation as long as the items below are honored.

---

## top 5 risks Backend/Frontend MUST address

Ranked by impact × likelihood:

### 1. IDOR on `/api/chats/:id` and `/api/chats/:id/messages` (OWASP A01)

**Risk:** user A reads/writes user B's conversation if ownership check missing or uses 403 instead of 404.

**Required:**
- Backend: single `requireConversationOwnership(id)` helper used by both routes; returns 404 (not 403) on miss.
- Query shape: `SELECT ... WHERE id = ? AND userId = ?` — ownership filter on the same query, not post-filter.
- Vitest test: cross-user GET → 404; cross-user POST → 404.
- Frontend: render "Conversation not found" for 404; do not branch on 403 vs 404 differently.

**Spec reference:** §5 GET `/api/chats/:id`, §6 AC.4, §11 DoD cross-user 404.

### 2. No rate limit on `/api/chats/:id/messages` → LLM cost amplification (OWASP A04)

**Risk:** trivial to script → 1 account = unlimited OpenAI spend. Each message = 1 LLM call. Phase 0 has no per-user throttle on this route.

**Required (recommended for spec, must-have for implementation):**
- Backend: in-memory token bucket, 60 messages/min/user + 500/hr/user. Same pattern as the signin rate limit.
- Return 429 with `{error: {code: 'RATE_LIMITED', message: 'Too many messages — slow down'}}`.
- Phase 1 will move this to Upstash when scaling.

**Spec hardening request:** add to spec §5 `POST /api/chats/:id/messages`.

### 3. Secrets in logs (OWASP A02 + A09)

**Risk:** `console.log(providerError)` or unpinned pino logger echoes `OPENAI_API_KEY`, `email`, `passwordHash`, or full message content to log aggregator → leak + cost log volume.

**Required:**
- Backend: pino with explicit `redact: ['*.email', '*.passwordHash', '*.OPENAI_API_KEY', 'req.headers.cookie', 'req.headers.authorization', 'res.headers']`.
- Backend: never log message `content` — only metadata `{conversationId, messageId, role, length}`.
- Frontend: never read AI keys from `process.env.*` on the client (Next.js inlines `NEXT_PUBLIC_*` at build time — verify any `process.env.OPENAI_API_KEY` access is server-only).
- DevOps: `.env` gitignored; verify before first commit.

### 4. XSS via message content rendering (OWASP A03)

**Risk:** phase 0 spec says plain text only. If Frontend reaches for `dangerouslySetInnerHTML`, a markdown lib, or an unescaped `innerHTML`, attacker controls a bubble → session theft.

**Required:**
- Frontend: render messages as `{message.content}` (React auto-escapes). No `dangerouslySetInnerHTML`. No markdown in phase 0 (per spec §9).
- Code review grep: `dangerouslySetInnerHTML` must return zero matches in `src/components/chat/**`.

### 5. Missing `secureHeaders` middleware (OWASP A05)

**Risk:** missing CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` opens clickjacking, MIME sniffing, referrer leaks.

**Required (Backend + DevOps):**
- Apply `secureHeaders` to every response. Suggested middleware (Next.js middleware or wrapper in `src/middleware.ts`):

```ts
// src/middleware.ts — sketch, NOT final code
import { NextResponse } from 'next/server';

export function middleware() {
  const res = NextResponse.next();
  res.headers.set('Content-Security-Policy',
    "default-src 'self'; " +
    "connect-src 'self' https://api.openai.com http://localhost:11434; " +
    "img-src 'self' data: blob:; " +
    "style-src 'self' 'unsafe-inline'; " +  // shadcn/ui requires inline styles
    "script-src 'self'; " +
    "frame-ancestors 'none'"
  );
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- SSE route `/api/chats/:id/messages` additionally sets `Cache-Control: no-store` (inline in the route handler — middleware can't always reach streaming responses).
- CORS: same-origin only. If `Access-Control-Allow-Origin` ever appears, ensure it's not `*` with credentials.

---

## specific things to add to code

### Backend (`src/app/api/**`, `src/lib/auth.ts`, `src/lib/db/**`)

1. **`requireAuth()` helper** in `src/lib/auth.ts`:
```ts
export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new HttpError(401, { code: 'UNAUTHENTICATED', message: 'Sign in required' });
  }
  return session;  // { user: { id, email, name, image }, expires }
}
```

2. **`requireConversationOwnership(id)` helper** in `src/lib/auth.ts` (or `src/lib/db/conversations.ts`):
```ts
export async function requireConversationOwnership(conversationId: string, userId: string) {
  const row = await db.select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  if (row.length === 0) {
    throw new HttpError(404, { code: 'NOT_FOUND', message: 'Conversation not found' });
  }
}
```

3. **`HttpError` class** + global error handler in route layout (catches `HttpError` → JSON response; everything else → 500 generic).

4. **Zod schemas** at every API boundary, all `.strict()`:
```ts
const SignupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  name: z.string().max(80).optional(),
}).strict();
```

5. **`bcrypt.hash(password, 12)`** — explicit cost.

6. **Message route rate limit** (60/min/user + 500/hr/user) using same in-memory bucket pattern as signin.

7. **Provider error catcher:**
```ts
try {
  return result.toDataStreamResponse({ /* ... */ });
} catch (err) {
  logger.error({ err, conversationId }, 'ai provider failed');
  return Response.json({ error: { code: 'PROVIDER_FAILED', message: 'AI provider is unreachable — check configuration' } }, { status: 502 });
}
```

8. **Stream lock** — Promise-based, not race:
```ts
const locks = new Map<string, Promise<void>>();
async function withStreamLock(id: string, fn: () => Promise<void>) {
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(r => { release = r; });
  locks.set(id, prev.then(() => next));
  await prev;
  try { await fn(); } finally { release(); locks.delete(id); }
}
```

9. **Pino setup** with redact + correlation id middleware.

10. **SSE-specific headers** on `POST /api/chats/:id/messages`:
```ts
return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Accel-Buffering': 'no',  // disable nginx buffering if behind proxy
  },
});
```

### Frontend

1. **No `dangerouslySetInnerHTML`** anywhere in `src/components/chat/**`. Render `{message.content}` only.
2. **No client reads of `process.env.OPENAI_API_KEY`** (or any `OPENAI_*`, `ANTHROPIC_*`, `AUTH_SECRET`). Only `NEXT_PUBLIC_*` is safe.
3. **Sign-out via Auth.js built-in** (`signOut()` from `next-auth/react`) — gets CSRF for free.
4. **Error rendering**: only show `error.message` from API responses. Never render the full `error` object.
5. **Disable send button while sending** — prevents client-side duplicate-submit.
6. **404 vs 403 in chat view**: treat identically — show "Conversation not found" for both, link back to `/`.

### DevOps

1. **`.gitignore`** must include `.env`, `.env.local`, `*.db`, `*.sqlite`, `node_modules`. Verify before first commit.
2. **`.env.example`** documents every var with safe defaults (already present — `AUTH_SECRET` rotation hint OK to keep).
3. **`npm audit` in CI** — add to GitHub Actions or pre-commit hook (phase 1+).
4. **Vercel function timeout** — `export const maxDuration = 60;` in `src/app/api/chats/[id]/messages/route.ts` (or longer) so streaming doesn't die at 10s.
5. **No real AI keys in non-prod envs.** Document in `.env.example`.
6. **HTTPS-only in prod** — phase 1; for now document in deployment runbook.

---

## spec hardening requests for PM (non-blocking)

Recommend PM add to spec §5 or §8:

1. **Per-user rate limit on `/api/chats/:id/messages`** (60/min, 500/hr).
2. **`Content-Length` cap** (16KB) at API edge.
3. **Max stream duration cap** (5 min).
4. **`Cache-Control: no-store`** on SSE responses.
5. **Explicit "Frontend MUST NOT use `dangerouslySetInnerHTML`"** note in spec §9.
6. **Explicit pino redact list** in spec §7 or §8.
7. **Vitest: cross-user 404 (not 403)** test case in spec §11 Tests.
8. **Vitest: `callbackUrl` off-origin rejection** test case in spec §11 Tests.

These are not blockers; implementation can proceed and these can be folded into the spec as a revision 3 if Orchestrator agrees.

---

## what I will check in code audit (next pass)

When Backend and Frontend deliver, I will:

1. Grep `src/` for `dangerouslySetInnerHTML` → must be zero in chat components.
2. Grep `src/lib/db/` for `sql\`` template literals → must be zero outside `drizzle/`.
3. Grep route handlers for `auth()` calls → must be at top of every protected handler.
4. Grep for `.select()` on users table → must not select `passwordHash`.
5. Grep for `process.env.OPENAI_API_KEY` → must be server-only.
6. Verify pino redact list.
7. Verify `secureHeaders` middleware exists and runs.
8. Run `npm audit` (DevOps) and copy output into audit doc.
9. Manual test: signup → cross-user 404; signup → signin rate limit triggers; signup → send 100 messages → rate limit triggers.
10. Verify Vitest covers cross-user 404 and `callbackUrl` off-origin.

---

## open issues

- `npm audit` blocked on `node_modules` (DevOps).
- `next-auth@5.0.0-beta.25` is pre-release — accept risk and document pin (PM/Backend).
- Spec hardening requests 1–8 — pending Orchestrator decision.
- Production HTTPS / HSTS — phase 1 (out of scope for phase 0 dev).

---

## handoff

Please confirm receipt and flag any disagreement with the top-5 risks or the proposed middleware. I will re-audit when code lands.

— security
