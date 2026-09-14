---
handoff_id: HOFF-003
date: 2026-09-14
from_role: backend
to_role: frontend
phase: 2
priority: high
---

## what was produced (phase 2 — APPEND-ONLY entry)

### New API route
- `src/app/api/chats/[id]/tree/route.ts` — `GET /api/chats/:id/tree` (US-201). Returns the full conversation subtree rooted at the ROOT of conversation `:id`, fetched with a SINGLE query on `(rootConversationId, userId)` (existing `rootConversationId` index; no migration).

### Type extensions (`src/lib/types/api.ts`)
- `TreeNodeDto` — `{ id, title, depth, highlightText: string | null, createdAt: string, children: TreeNodeDto[] }`. `highlightText` is ALWAYS present (null when absent — US-201 AC.6, no key omission).
- `TreeResponse` — `{ root: TreeNodeDto, currentId: string, totalNodes: number, truncated: boolean }`.

### Tests (Vitest, all pass)
- `tests/unit/tree-endpoint.test.ts` — 7 cases: 401 no-session; 404 missing conversation; 404 foreign-owned conversation; 404 foreign-owned ROOT (sub-chat of another user's tree); depth-2 tree shape with `children` ordered `createdAt ASC` (root → child → grandchild, DFS pre-order verified); 600 nodes → `truncated: true`, first 500 in DFS pre-order, `totalNodes: 600`, no partial subtrees; exactly 500 nodes → `truncated: false`.

Full suite: **53/53 vitest unit tests pass** (46 existing + 7 new). `tsc --noEmit`: zero errors in backend-owned files (remaining errors are in `src/components/tree/TreeMapSidebar.tsx`, Frontend-owned).

---

## API surface for Frontend — `GET /api/chats/:id/tree` (NEW)

**Auth:** required → `401 { error: { code: "UNAUTHENTICATED" } }`.

**Behavior:**
1. Loads conversation `:id` with ownership check → `404 { error: { code: "NOT_FOUND" } }` on missing OR foreign-owned (never 403 — US-207; byte-identical bodies).
2. Resolves the ROOT: `rootId = conv.rootConversationId ?? conv.id`. If the root row is missing/foreign-owned → 404.
3. Single subtree query: `WHERE rootConversationId = <rootId> AND userId = <session>` ordered `createdAt ASC`. Foreign-owned nodes cannot enter the response (US-207 AC.2).
4. Assembles tree in memory; children ordered `createdAt ASC`; `depth` = stored `conversations.depth` (root = 0, US-201 AC.7).
5. Cap: > 500 nodes → keeps the FIRST 500 in DFS pre-order (node, then children in `createdAt ASC`, recursively), sets `truncated: true`, and strips omitted nodes from their parents' `children` arrays so no partial subtree appears without its parent link (US-201 AC.4). `totalNodes` = FULL pre-truncation count (OQ-4) — render "Showing 500 of <totalNodes>" from it (US-202 AC.6).

**Response 200 (`TreeResponse`):**
```json
{
  "root": {
    "id": "uuid",
    "title": "How to build a RAG system",
    "depth": 0,
    "highlightText": null,
    "createdAt": "2026-09-13T10:00:00.000Z",
    "children": [
      {
        "id": "uuid",
        "title": "Ask about vector database",
        "depth": 1,
        "highlightText": "vector database",
        "createdAt": "2026-09-13T10:05:00.000Z",
        "children": []
      }
    ]
  },
  "currentId": "uuid-of-requested-conversation",
  "totalNodes": 2,
  "truncated": false
}
```

**Error responses:** `401 UNAUTHENTICATED` · `404 NOT_FOUND` · `500 INTERNAL`. No other status codes. Malformed/non-UUID `:id` → 404 (row simply won't match).

**Minimal payload (US-207 AC.4):** response contains NO user ids, emails, `parentId`, or `rootConversationId` — only the node fields above plus `currentId`/`totalNodes`/`truncated`.

---

## consumer notes

- Import types from `@/lib/types/api`: `TreeNodeDto`, `TreeResponse`. Do NOT redefine.
- `currentId` equals the `:id` you requested — use it for the "current" node highlight (`node.id === currentId`), even when `:id` is a deep descendant and `root` is a different conversation.
- `createdAt` is a full ISO string (`2026-09-13T10:05:00.000Z`) — feed it to your locale formatter for the hover tooltip (US-203 AC.2).
- `highlightText` is `string | null`, always present — `📌` marker renders iff non-null.
- `truncated: true` → show the static notice "Showing 500 of <totalNodes> conversations"; omitted nodes are NOT in the payload at all (their parent's `children` array skips them) — no dead links possible.
- The endpoint never returns a forest — `root` is always the tree's single root; a root conversation with no sub-chats returns `root.children: []`, `totalNodes: 1`, `truncated: false`.
- Route exports `runtime = "nodejs"` — do not mark `edge`.

## curl example

```bash
curl http://localhost:3000/api/chats/<any-node-id>/tree -b cookies.txt
# 200 → { root: {...}, currentId: "<any-node-id>", totalNodes: N, truncated: false }
# 401 → { error: { code: "UNAUTHENTICATED" } }
# 404 → { error: { code: "NOT_FOUND", message: "Conversation not found" } }
```

## cross-role notes

- **Security:** ownership is enforced on the `:id` row, on the root row (if distinct), and inside the subtree query (`userId` filter) — foreign nodes cannot enter the response even with inconsistent `rootConversationId` data. 404 bodies for missing vs foreign are byte-identical (US-207 AC.3).
- **DevOps/TechWriter:** no DB migration, no new deps, no env vars.
- **Frontend:** this is the only new backend surface in phase 2; existing routes unchanged.

## open changes requested
(none)

## blockers
(none — Frontend can build TreeMapSidebar + split picker against this contract immediately.)
