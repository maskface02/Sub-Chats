# Security Handoff — Phase 1

**from:** security (GLM 5.3 Flash tier)
**to:** Backend, Frontend, DevOps, PM (spec hardening requests)
**phase:** 1 — Sub-Chat Core
**date:** 2026-09-13
**full docs:**
- threat model: `.orchestrator/security/threat-models/phase-1.md`
- audit placeholder: `.orchestrator/security/audits/phase-1.md`
- checklist: `.orchestrator/security/checklist.md`

---

## threat model summary

Phase 1 introduces the branching primitive: any assistant-message selection → `POST /api/chats/:id/branch` → new sub-chat created with `parentId`. Sending a message in a sub-chat walks the ancestor chain and prepends a system note to the model context only (NOT persisted, NOT rendered). The chain can be arbitrarily deep (Q3: uncapped). Cross-user access is 404 on the source conversation and `503 ANCESTOR_UNAVAILABLE` for any foreign-owned ancestor link. Existing routes `GET /api/chats/:id` and `POST /api/chats/:id/messages` gain additive behavior (parentTitle/rootTitle in response; ancestor walk on depth ≥ 1).

**Threats identified:** 54 across STRIDE categories
- Spoofing (T-S): 5
- Tampering (T-T): 13
- Repudiation (T-R): 4
- Information Disclosure (T-I): 11
- Denial of Service (T-D): 10
- Elevation of Privilege (T-E): 11
- **Severity tier:** high (critical/high impact): 10; medium: 16; low: 28
- **Critical impact:** T-S-1, T-T-1, T-E-1, T-E-2, T-E-3, T-E-4, T-E-6, T-E-7 (all mitigated by spec controls)

OWASP Top 10 (2025) coverage:
- A01 Broken Access Control → primary concern; mitigated by `requireConversationOwnership` + cross-user 404 + ancestor-walk ownership loop + Zod `.strict()` on branch body
- A02 Cryptographic Failures → inherited from phase 0 (bcrypt cost 12, AUTH_SECRET); no new crypto
- A03 Injection → Drizzle parameterized; React text rendering for highlightText/parentTitle/rootTitle (no `dangerouslySetInnerHTML`); Zod int validation on charStart/charEnd
- A04 Insecure Design → branch rate limit (30/10min/user); ancestor walk ownership loop; **3 spec hardening items recommended**
- A05 Security Misconfiguration → secureHeaders middleware covers new routes; pino redact extended
- A07 Identification & Auth Failures → slice validation + messageId belongs-to-conv filter
- A08 Software & Data Integrity Failures → FK constraint (Q7) prevents orphan rows; title auto-derive truncation
- A09 Logging & Monitoring → **spec hardening**: pino redact must include selection/highlight content

No `critical` findings block implementation as long as the items below are honored. All `critical` controls have proposed mitigations.

---

## top 5 risks Backend/Frontend MUST address

Ranked by impact × likelihood:

### 1. IDOR + ancestor ownership loop violation (OWASP A01)

**Risk:** user A reads/writes user B's conversation via branch creation, OR ancestor walk includes foreign-owned link → LLM context includes B's content → data exfil via streamed tokens.

**Required:**
- Backend: single `requireConversationOwnership(id)` helper used by all 3 conversation routes (GET, POST messages, POST branch); returns 404 (NOT 403) on miss.
- Query shape: `SELECT ... WHERE id = ? AND userId = ?` — ownership filter on the same query, not post-filter.
- **Ancestor walk: ownership check on EVERY iteration, NOT just direct parent.** First foreign-owned OR missing link returns same code `503 ANCESTOR_UNAVAILABLE` (no distinction = no enumeration).
- Frontend: treat 403 and 404 identically on `/c/[id]` — show "Conversation not found" + link to `/`.
- Vitest test cases:
  - cross-user `POST /api/chats/:id/branch` → 404
  - foreign-owned ancestor → 503 ANCESTOR_UNAVAILABLE
  - missing ancestor → 503 ANCESTOR_UNAVAILABLE (same code, verified)
- Frontend: render foreign-owned ancestor crumb as "Private" (no link); render unknown crumb as "Unknown" (no link).

**Spec reference:** US-103 AC.7, US-107 AC.1/AC.2/AC.3, US-108 AC.2.

### 2. Client-supplied `parentId` / `userId` / `rootConversationId` / `depth` in branch body (OWASP A01)

**Risk:** if Backend reads `parentId`, `userId`, `rootConversationId`, `depth`, or `createdAt` from the branch request body, attacker creates sub-chats with arbitrary tree placement, fakes ownership, or skips the ancestor walk entirely.

**Required:**
- Backend: Zod schema with `.strict()` and EXACTLY 5 fields:
  ```ts
  const BranchBodySchema = z.object({
    messageId: z.string().uuid(),
    selectedText: z.string().min(1).max(2000).refine(s => s.trim().length > 0),
    charStart: z.number().int().nonnegative(),
    charEnd: z.number().int().positive(),
    clientHighlightContext: z.string().max(500).optional(),
  }).strict();
  ```
- Server-side derivation (NEVER from body):
  - `parentId = :id` (from route param)
  - `userId = session.user.id` (from session)
  - `rootConversationId = source.rootConversationId ?? source.id` (derived from source row)
  - `depth = source.depth + 1` (derived)
  - `title = 'New chat'`
- Code review: grep for `body.parentId`, `body.userId`, `body.depth` in branch route — must be ZERO occurrences.
- Vitest test: branch body with extra fields returns 422.

**Spec reference:** US-103 AC.2/AC.3, US-105 AC.4, US-107 AC.1.

### 3. XSS via React text rendering bypass (OWASP A03)

**Risk:** phase 1 introduces 3 new surfaces that render user/LLM-controlled content as text: the parent-context banner's source message with `<mark>highlight</mark>` highlight, the breadcrumb's `parentTitle`/`rootTitle`, and the breadcrumb's full ancestor chain titles. If Frontend uses `dangerouslySetInnerHTML`, `innerHTML`, or a markdown lib in any of these surfaces, attacker controls a DOM node → XSS.

**Required:**
- Frontend: render `highlightText`, `parentTitle`, `rootTitle`, breadcrumb crumbs, banner source message — all via React text child (`{value}`). NEVER `dangerouslySetInnerHTML` anywhere in `src/components/chat/**`.
- Highlight rendering: split source message into THREE text segments (before / `<mark>{highlightText}</mark>` / after) and render each as React text child — DO NOT inject `highlightText` into the source message HTML string.
- Code review grep: `dangerouslySetInnerHTML` must return zero matches in `src/components/chat/**`.
- Frontend: never read AI provider env vars from client code (`process.env.OPENAI_API_KEY`, etc.); only `NEXT_PUBLIC_*` is safe.

**Spec reference:** US-104 AC.2, US-106 AC.1, threat model T-T-2/T-T-3/T-T-4.

### 4. No rate limit on branch → LLM cost amplification (OWASP A04)

**Risk:** trivial to script → 1 account = unlimited sub-chat creation → on each sub-chat, sending a message triggers an LLM call with full ancestor context. With uncapped depth (Q3), each message in a deep sub-chat multiplies cost.

**Required (spec-mandated, must-have for implementation):**
- Backend: in-memory token bucket, **30 branches / 10 min / user** on `POST /api/chats/:id/branch`.
- Return 429 with `{error: {code: 'RATE_LIMITED', message: 'Too many sub-chats — try again in 10 minutes'}}`.
- Mirror phase 0 signin pattern for headers:
  ```
  X-RateLimit-Limit: 30
  X-RateLimit-Remaining: <n>
  X-RateLimit-Reset: <unix-ts>
  Retry-After: <seconds>      // on 429
  ```
- Phase 0 message rate limit (60/min/user + 500/hr/user) applies to sub-chat conversations too.
- Spec hardening recommendation (top-3): implement ancestor walk as **batched fetch or recursive CTE** (not sequential `db.conversations.get(parentId)`) to avoid O(d) round-trips in deep trees — see threat model T-D-2.

**Spec reference:** US-107 AC.4, US-108 AC.2.

### 5. Pino log leaks user selection content (OWASP A02 + A09)

**Risk:** `console.log(branchRequest)` or unpinned pino logger echoes `selectedText`, `highlightContext`, or `clientHighlightContext` to log aggregator. These contain private thoughts — same PII posture as message content (phase 0 T-I-6).

**Required:**
- Backend: extend pino `redact` list to include phase 1 content fields:
  ```ts
  redact: [
    '*.email', '*.passwordHash', '*.OPENAI_API_KEY',
    '*.selectedText', '*.highlightText', '*.highlightContext', '*.clientHighlightContext',
    'req.headers.cookie', 'req.headers.authorization', 'res.headers',
  ]
  ```
- Backend: log branch events with metadata ONLY (never content):
  - `info` on 201: `{userId, sourceConvId, newConvId, depth, messageId, charStart, charEnd, requestId}`
  - `warn` on 404 (cross-user): `{userId, attemptedConvId, ip, requestId}`
  - `warn` on 503 (ancestor unavailable): `{userId, subConvId, ancestorId, reason, requestId}`
  - `info` on 422: `{userId, convId, messageId, reason, requestId}`
- Frontend: never read AI keys from `process.env.*` on the client.
- DevOps: log aggregation access restricted; verify pino redact actually redacts in production logs.

**Spec reference:** threat model T-I-8, T-R-1/T-R-2/T-R-3/T-R-4.

---

## specific things to add to code

### Backend (`src/app/api/**`, `src/lib/auth.ts`, `src/lib/db/**`, `src/lib/log.ts`)

1. **`requireConversationOwnership(id, userId)`** helper (re-use from phase 0 if it exists):
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

2. **Branch route Zod schema** (exact):
   ```ts
   const BranchBodySchema = z.object({
     messageId: z.string().uuid(),
     selectedText: z.string().min(1).max(2000).refine(s => s.trim().length > 0, { message: 'must not be empty or whitespace' }),
     charStart: z.number().int().nonnegative(),
     charEnd: z.number().int().positive(),
     clientHighlightContext: z.string().max(500).optional(),
   }).strict();
   ```

3. **Branch route validation flow** (sketch):
   ```ts
   // 1. Auth
   const session = await requireAuth();
   // 2. Rate limit (30/10min/user)
   if (!branchRateLimit.consume(session.user.id)) return new Response(..., { status: 429 });
   // 3. Body parse
   const body = BranchBodySchema.parse(await req.json());
   // 4. Ownership of source conversation
   const source = await requireConversationOwnership(params.id, session.user.id); // throws 404
   // 5. Load + validate message
   const message = await db.select().from(messages)
     .where(and(eq(messages.id, body.messageId),
                eq(messages.conversationId, params.id),
                eq(messages.role, 'assistant')))
     .limit(1);
   if (message.length === 0) throw new HttpError(422, { code: 'INVALID_SELECTION', fields: { messageId: 'must be an assistant message in this conversation' } });
   // 6. Slice validation
   const expected = message[0].content.slice(body.charStart, body.charEnd).trim();
   if (expected !== body.selectedText.trim()) throw new HttpError(422, { code: 'INVALID_SELECTION', fields: { selectedText: 'selection does not match message content' } });
   if (body.charEnd > message[0].content.length) throw new HttpError(422, { code: 'INVALID_SELECTION', fields: { charEnd: 'must be ≤ message length' } });
   // 7. Compute highlightContext
   const highlightContext = body.clientHighlightContext ?? computeHighlightContext(message[0].content, body.charStart);
   // 8. Insert new conversation (SERVER-SET fields only)
   const newConv = await db.insert(conversations).values({
     id: crypto.randomUUID(),
     userId: session.user.id,             // FROM SESSION
     parentId: params.id,                 // FROM ROUTE PARAM
     rootConversationId: source.rootConversationId ?? source.id,  // DERIVED
     depth: source.depth + 1,             // DERIVED
     title: 'New chat',
     highlightText: body.selectedText,
     highlightContext: highlightContext.slice(0, 500),
     createdAt: Date.now(),
     updatedAt: Date.now(),
   }).returning();
   ```

4. **Ancestor walk** (spec §7 algorithm with batched fetch — spec hardening #1):
   ```ts
   async function loadAncestors(targetId: string, sessionUserId: string): Promise<Conversation[]> {
     // Single recursive CTE or batched fetch — NOT sequential .get(parentId)
     const ancestors = await db.execute(sql`
       WITH RECURSIVE chain AS (
         SELECT * FROM conversations WHERE id = ${targetId}
         UNION ALL
         SELECT c.* FROM conversations c
         JOIN chain ON c.id = (SELECT parent_id FROM chain ORDER BY depth DESC LIMIT 1)
       )
       SELECT * FROM chain WHERE user_id = ${sessionUserId} AND id != ${targetId}
     `);
     // Verify all ancestors in chain are user-owned; throw on first miss
     for (const anc of ancestors) {
       if (anc.userId !== sessionUserId) throw new HttpError(503, { code: 'ANCESTOR_UNAVAILABLE' });
     }
     return ancestors;
   }
   ```
   Alternative (without CTE, in SQLite-friendly form): batched fetch using `WHERE id = ANY($ids)` then client-side tree walk.

5. **Title auto-derivation** on first user message:
   ```ts
   function deriveTitle(firstUserContent: string): string {
     const tokens = firstUserContent.trim().split(/\s+/).slice(0, 6);
     const title = tokens.join(' ').slice(0, 60);
     return title || 'New chat';
   }
   ```

6. **System note** with env-var override (Q11):
   ```ts
   function buildSubChatSystemNote(parentTitle: string | null, highlightText: string | null): string {
     const template = process.env.SUBSCHAT_SYSTEM_PROMPT
       ?? 'You are answering a follow-up question in a sub-chat. The user branched from {parentTitle} at the phrase: "{highlightText}". The following conversation history provides context; respond to the latest user message.';
     return template
       .replace('{parentTitle}', parentTitle ?? 'a parent chat')
       .replace('{highlightText}', highlightText ?? 'a highlighted passage');
   }
   ```

7. **GET /api/chats/:id — additive response with `ancestorTitles`** (spec hardening #2 — top-3):
   ```ts
   // On the conversation response, when depth >= 1, load all ancestors in chain
   const ancestorTitles = depth >= 1
     ? await db.select({ id: conversations.id, title: conversations.title, depth: conversations.depth })
              .from(conversations)
              .where(eq(conversations.userId, session.user.id))   // defense-in-depth
              .where(/* ancestor chain filter */)
              .orderBy(asc(conversations.depth))
     : [];
   return { ...existingFields, ancestorTitles };
   ```

8. **GET /api/chats/:id — defense-in-depth on parentTitle/rootTitle** (T-I-5/T-E-10):
   ```ts
   const parent = await db.select({ title: conversations.title })
     .from(conversations)
     .where(and(eq(conversations.id, conv.parentId), eq(conversations.userId, session.user.id)))
     .limit(1);
   const parentTitle = parent[0]?.title ?? null;   // null on miss, never foreign title
   ```

9. **`parentId` FK constraint** (Q7) — Drizzle schema:
   ```ts
   // src/lib/db/schema.ts — phase 1 change
   export const conversations = sqliteTable('conversations', {
     // ... existing fields ...
     parentId: text('parent_id').references((): AnySQLiteColumn => conversations.id),  // NEW: FK
     // ... rest ...
   });
   ```
   Verify pglite accepts FK; verify migration applies cleanly (NULL allowed, no orphan rows).

10. **Pino redact extended** (`src/lib/log.ts`):
    ```ts
    const redact = [
      '*.email', '*.passwordHash', '*.OPENAI_API_KEY',
      '*.selectedText', '*.highlightText', '*.highlightContext', '*.clientHighlightContext',
      'req.headers.cookie', 'req.headers.authorization', 'res.headers',
    ];
    ```

11. **Branch rate-limit headers** (mirror phase 0 signin):
    ```ts
    res.headers.set('X-RateLimit-Limit', '30');
    res.headers.set('X-RateLimit-Remaining', String(remaining));
    res.headers.set('X-RateLimit-Reset', String(resetUnix));
    if (rateLimited) res.headers.set('Retry-After', String(retrySeconds));
    ```

12. **Highlight context computation** (spec §5):
    ```ts
    function computeHighlightContext(content: string, charStart: number): string {
      const sentencePattern = /[^.!?]+[.!?]+/g;
      const sentences = content.match(sentencePattern) ?? [];
      if (sentences.length === 0) return content.slice(0, 500);
      // Find sentence containing charStart; include 1 before + 1 after
      const targetIdx = sentences.findIndex(s => content.indexOf(s) <= charStart && content.indexOf(s) + s.length >= charStart);
      if (targetIdx < 0) return content.slice(0, 500);
      const start = Math.max(0, targetIdx - 1);
      const end = Math.min(sentences.length, targetIdx + 2);
      const ctx = sentences.slice(start, end).join('').trim();
      return ctx.length > 500 ? ctx.slice(0, 500).replace(/\s+\S*$/, '') + '…' : ctx;
    }
    ```

13. **Title auto-derivation triggers**: in `POST /api/chats/:id/messages`, if the conversation's `title === 'New chat'` and this is the first user message, run deriveTitle and update the row.

14. **No client reads of `process.env.OPENAI_API_KEY`** anywhere in `src/app/api/**` (it must remain server-only).

### Frontend (`src/components/chat/**`, `src/lib/api/**`)

1. **No `dangerouslySetInnerHTML`** anywhere in chat components. Render `{value}` for all text. Grep for `dangerouslySetInnerHTML` in `src/components/chat/**` must return zero matches.

2. **Highlight rendering pattern** (US-104 AC.2):
   ```tsx
   // Source message split into three text segments — no HTML injection
   const before = sourceMessage.content.slice(0, highlightStart);
   const highlight = sourceMessage.content.slice(highlightStart, highlightEnd);
   const after = sourceMessage.content.slice(highlightEnd);
   return (
     <p>
       {before}<mark className="bg-yellow-100 dark:bg-yellow-900/30 underline decoration-yellow-500 decoration-2">{highlight}</mark>{after}
     </p>
   );
   ```

3. **Breadcrumb with full ancestor chain** (US-108 AC.3 + spec hardening #2):
   ```tsx
   const crumbs = [
     { id: null, label: 'Home', href: '/' },
     ...(conversation.ancestorTitles ?? []).map(a => ({ id: a.id, label: a.title, href: `/c/${a.id}` })),
     { id: conversation.id, label: conversation.title, href: null /* current */ },
   ];
   return <nav aria-label="Conversation path"><ol>{crumbs.map(...)}</ol></nav>;
   ```

4. **Floating pill** (US-101):
   - 50ms debounce on `selectionchange` listener (Q10)
   - `useEffect` cleanup removes listener on unmount
   - Position with `requestAnimationFrame` on scroll
   - Hide immediately when `selection.isCollapsed === true`
   - Render only when `selection.rangeCount > 0` AND range lies within single assistant message bubble AND `selection.toString().trim().length > 0`

5. **Right-click menu** (US-102):
   - `preventDefault()` only when selection is valid + within assistant bubble
   - Position with viewport-edge flip (compute `event.clientX/Y`; if `clientX + menuWidth > viewport.width`, flip to `clientX - menuWidth`; clamp `clientY` similarly)
   - At least 8px padding from viewport edge

6. **Branch body construction** (US-103 AC.1):
   ```ts
   const body = {
     messageId,                // from selected assistant message
     selectedText,             // from window.getSelection().toString()
     charStart, charEnd,       // from Range offsets within message bubble
     clientHighlightContext,   // optional, ≤500 chars, server computes if absent
   };
   // NEVER include: userId, parentId, rootConversationId, depth, createdAt, id
   ```

7. **Composer placeholder** (US-105 AC): derive first 3 words of `highlightText` server-side or from `GET /api/chats/:id` response; render as plain text.

8. **404 vs 403 handling**: treat identically — show "Conversation not found" + link to `/`.

9. **Error rendering**: only `error.message` from API responses. Never render the full `error` object (avoid leaking `selectedText` if present in `fields`).

10. **Ancestor unavailable banner** (US-105 AC.6): on 503 ANCESTOR_UNAVAILABLE from `POST /api/chats/:id/messages`, render inline banner "Sub-chat parent is unavailable — start a new chat" + "New chat" button. The user message IS persisted on the sub-chat per spec — show it in the UI, but with the error banner above.

11. **Foreign-owned crumb rendering** (US-107 AC.3): render as `<li>Private</li>` (no `<a>`, no `href`); do not include any foreign-owned title.

12. **Pill disable while in-flight** (US-103 AC.5): set `aria-busy="true"` + disabled; show spinner + "Creating sub-chat…".

13. **Focus management** (spec §9): on `router.push('/c/<id>')`, move focus to `<h1 tabindex="-1">` of conversation header.

14. **No client reads of `process.env.OPENAI_API_KEY`** or any AI key — only `NEXT_PUBLIC_*` is safe.

### DevOps

1. **`.env` in `.gitignore`** (verify before first commit; carries over from phase 0).
2. **`.env.example` documents `SUBSCHAT_SYSTEM_PROMPT`** with safe default value matching spec US-105 AC.3 (Q11).
3. **`npm audit` in CI** — add to GitHub Actions or pre-commit hook (carries over from phase 0 D-5).
4. **Vercel function timeout ≥ 60s** on `/api/chats/:id/messages` route segment (carries over; same route, deeper work).
5. **No real AI keys in any non-production env** (carries over).
6. **HTTPS-only + HSTS in prod** (carries over; phase 1 deploy target).
7. **FK migration safety** (Q7): verify Drizzle migration generates cleanly; verify pglite accepts FK; in prod, verify no orphan rows before applying FK (NULL allowed, so any existing rows are safe; but migration script should include a backfill step).
8. **Log aggregation access restricted**; verify pino redact actually redacts in production logs (carries over; phase 1 extends the redact list).

---

## spec hardening requests for PM (non-blocking; top-3 recommended for sign-off)

Recommend PM add to spec §5, §7, §9, or §11:

1. **Ancestor walk should use batched fetch or recursive CTE** (T-D-2). Spec §7 pseudocode shows O(d) sequential round-trips for conversations. Recommend either recursive CTE (`WITH RECURSIVE ancestors AS …`) or batched fetch (`WHERE id = ANY($ancestorIds)`) with client-side ordering.

2. **GET /api/chats/:id must return full ancestor title chain for breadcrumb** (T-D-5). Spec §5 lists `parentTitle`/`rootTitle` only; US-108 AC.3 requires full chain for depth ≥ 3. Recommend additive `ancestorTitles: Array<{id: string; title: string; depth: number}>` field.

3. **Pino redact list must extend to phase 1 fields** (T-I-8). Spec doesn't mention redact updates; recommend adding `*.selectedText`, `*.highlightText`, `*.highlightContext`, `*.clientHighlightContext` to the redact list documented in spec §11 or §7.

Secondary (recommended as additions, not blockers):

4. **422 INVALID_SELECTION should not echo user-supplied content** (T-I-3). Recommend: `fields` contains only field name + static message — never the user-supplied value.

5. **Add Vitest cases** (in addition to spec §11 DoD):
   - cross-user 404 (not 403) on `POST /api/chats/:id/branch`
   - foreign-owned ancestor returns SAME 503 as missing ancestor (no distinction)
   - `messageId` from different conversation returns 422
   - `selectedText` whitespace-only returns 422
   - charStart/charEnd out-of-bounds returns 422
   - slice mismatch returns 422
   - highlightContext fallback for no-terminator message
   - title auto-derive (6 words max, 60 chars max)
   - branch body `.strict()` rejects unknown fields

6. **Add Playwright e2e cases**:
   - breadcrumb renders full chain at depth ≥ 3 (validates T-D-5)
   - foreign-owned ancestor shows "Private" crumb
   - cross-user branch returns 404 in UI

7. **Document in spec §9/§10**: Frontend MUST NOT use `dangerouslySetInnerHTML` for any phase-1 surface (highlightText, parentTitle, rootTitle, source message content, breadcrumb crumbs, banner text). Phase 0 had this; phase 1 should repeat.

8. **Migration note for FK** (Q7): add to spec §6 that NULL is allowed, no orphan rows are possible in phase 0 dev (since no sub-chats exist yet), and prod must verify before applying.

9. **Branch rate-limit headers** — recommend explicit values in spec §5: `X-RateLimit-Limit: 30`, `X-RateLimit-Remaining: <n>`, `X-RateLimit-Reset: <unix-ts>`, `Retry-After: <seconds>` (on 429).

10. **Operator-facing note in `.env.example`**: `SUBSCHAT_SYSTEM_PROMPT` must NOT contain secrets or BYOK data (Q11). The system note may be logged by provider SDKs.

11. **Spec clarification (low priority)**: US-103 AC.2 should explicitly say "the source conversation is owned by the current user AND the message at `messageId` is owned by that conversation" (defense in depth).

12. **Spec clarification (low priority)**: US-105 AC.6 says "the user message is still persisted (so no data loss)". Recommend clarifying that the message is persisted to the sub-chat's `messages` table with `conversationId = sub-chat.id` — never to an ancestor.

These are not blockers; items #1, #2, #3 are **recommended for phase 1 sign-off**; items #4–#12 are recommended as spec updates that can be folded into revision 3 if Orchestrator agrees.

---

## what I will check in code audit (next pass)

When Backend and Frontend deliver, I will:

1. Grep `src/` for `dangerouslySetInnerHTML` → must be ZERO in `src/components/chat/**`.
2. Grep `src/lib/db/` for `sql\`` template literals → must be ZERO outside `drizzle/` migrations.
3. Grep branch route for `body.parentId`, `body.userId`, `body.rootConversationId`, `body.depth` → must be ZERO occurrences.
4. Verify branch body Zod schema uses `.strict()` and enumerates EXACTLY 5 fields.
5. Verify `parentId`, `rootConversationId`, `depth`, `userId` are set server-side from `:id` + session + source row — never from body.
6. Verify ancestor walk ownership check on EVERY iteration; verify single code `ANCESTOR_UNAVAILABLE` for both foreign-owned and missing.
7. Verify `requireConversationOwnership(:id)` helper returns 404 on cross-user, never 403.
8. Verify ancestor walk uses batched fetch or recursive CTE — NOT sequential `db.conversations.get(parentId)`.
9. Verify `messageId` query filters both `conversationId = :id AND role = 'assistant'`.
10. Verify slice validation `content.slice(charStart, charEnd).trim() === selectedText.trim()` is enforced server-side.
11. Verify charStart/charEnd parsed as `z.number().int().nonnegative()`; range check `0 ≤ charStart < charEnd ≤ message.content.length`.
12. Verify `selectedText` length 1-2000, trimmed non-empty.
13. Verify `clientHighlightContext` ≤ 500 chars.
14. Verify 422 response `fields` does NOT echo user-supplied content.
15. Verify branch rate limit: 30/10min/user with `X-RateLimit-*` and `Retry-After` headers.
16. Verify pino redact list includes `selectedText`, `highlightText`, `highlightContext`, `clientHighlightContext`.
17. Verify `GET /api/chats/:id` includes `ancestorTitles` array (spec hardening #2).
18. Verify `parentTitle`/`rootTitle` in GET response filtered by `userId === session.user.id`.
19. Verify `parentId` FK constraint in Drizzle schema (Q7); verify pglite accepts; verify migration applies cleanly.
20. Verify Vitest cases exist for all 9 phase-1 additions listed in spec hardening #5.
21. Verify Playwright e2e covers depth ≥ 3 breadcrumb + foreign-owned crumb "Private".
22. Run `npm audit` (DevOps) and copy output into audit doc.
23. Manual test: signup → branch from sub-chat → cross-user 404; depth-3 ancestor walk → batched single query; deep sub-chat sends message → message count is single round-trip.
24. Verify `Content-Length` cap (16KB) from phase 0 hardening covers `/api/chats/:id/branch`.
25. Verify `GET /api/chats` (list) still filters `parentId IS NULL` (root only) — sub-chats not in list.

---

## open issues

- `npm audit` blocked on `node_modules` (DevOps).
- `next-auth@5.0.0-beta.25` is pre-release — accept risk and document pin (PM/Backend).
- Spec hardening requests #1, #2, #3 — pending Orchestrator decision (recommended for phase 1 sign-off).
- Spec hardening requests #4–#12 — pending code-review-time decisions.
- Production HTTPS / HSTS — phase 1 deploy (carry-over).
- FK migration in prod — verify no orphan rows before apply (DevOps).

---

## handoff

Please confirm receipt and flag any disagreement with the top-5 risks, the proposed middleware, or the spec hardening requests. I will re-audit when code lands.

— security
