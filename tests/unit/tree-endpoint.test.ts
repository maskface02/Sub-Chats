import { describe, it, expect, beforeEach, vi } from "vitest";
import { conversations } from "@/lib/db/schema";

// --- mock db state (set per test) ---
let convLookupResult: unknown[] = [];
let rootLookupResult: unknown[] = [];
let subtreeResult: unknown[] = [];
let lookupCalls = 0;

function makeProxyDb() {
  return {
    db: new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === "select") {
            return () => ({
              from: (table: unknown) => {
                if (table !== conversations) {
                  throw new Error(`unexpected table in query: ${String(table)}`);
                }
                return {
                  where: () => ({
                    orderBy: () => ({
                      limit: async () => subtreeResult,
                      then: (resolve: (v: unknown[]) => void) =>
                        resolve(subtreeResult),
                    }),
                    limit: async () => {
                      lookupCalls += 1;
                      return lookupCalls === 1
                        ? convLookupResult
                        : rootLookupResult;
                    },
                  }),
                };
              },
            });
          }
          return () => Promise.resolve(undefined);
        },
      },
    ),
  };
}

let currentSession: { user: { id: string } } | null = null;

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => currentSession),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

vi.mock("@/lib/db", () => makeProxyDb());

type Row = {
  id: string;
  title: string;
  depth: number;
  parentId: string | null;
  highlightText: string | null;
  createdAt: Date;
};

function row(
  id: string,
  opts: Partial<Omit<Row, "id">> = {},
): Row {
  return {
    id,
    title: `title-${id}`,
    depth: 0,
    parentId: null,
    highlightText: null,
    createdAt: new Date(Date.parse("2026-09-13T10:00:00Z")),
    ...opts,
  };
}

// Full conversation row for the ownership lookups (select * shape).
function convRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "user-A",
    title: `title-${id}`,
    parentId: null,
    rootConversationId: id,
    depth: 0,
    highlightText: null,
    highlightContext: null,
    createdAt: new Date(Date.parse("2026-09-13T10:00:00Z")),
    updatedAt: new Date(Date.parse("2026-09-13T10:00:00Z")),
    ...overrides,
  };
}

function collectIds(node: {
  id: string;
  children: { id: string; children: unknown[] }[];
}): string[] {
  return [
    node.id,
    ...node.children.flatMap((c) => collectIds(c as never)),
  ];
}

describe("GET /api/chats/[id]/tree", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-A" } };
    convLookupResult = [];
    rootLookupResult = [];
    subtreeResult = [];
    lookupCalls = 0;
  });

  it("401 when no session", async () => {
    currentSession = null;
    const { GET } = await import("@/app/api/chats/[id]/tree/route");
    const res = await GET(new Request("http://localhost/api/chats/x/tree") as never, {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("404 when conversation missing", async () => {
    convLookupResult = [];
    const { GET } = await import("@/app/api/chats/[id]/tree/route");
    const res = await GET(new Request("http://localhost/api/chats/missing/tree") as never, {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("404 when conversation foreign-owned", async () => {
    // Cross-user rows never pass the userId filter → empty lookup result
    convLookupResult = [];
    const { GET } = await import("@/app/api/chats/[id]/tree/route");
    const res = await GET(new Request("http://localhost/api/chats/conv-B/tree") as never, {
      params: Promise.resolve({ id: "conv-B" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("404 when ROOT is foreign-owned (sub-chat of another user's tree)", async () => {
    convLookupResult = [
      convRow("my-sub", {
        userId: "user-A",
        parentId: "foreign-parent",
        rootConversationId: "foreign-root",
        depth: 1,
      }),
    ];
    rootLookupResult = []; // root row fails the userId filter
    const { GET } = await import("@/app/api/chats/[id]/tree/route");
    const res = await GET(new Request("http://localhost/api/chats/my-sub/tree") as never, {
      params: Promise.resolve({ id: "my-sub" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("correct tree shape for depth-2 subtree, children ordered createdAt ASC", async () => {
    const t = (min: number) => new Date(Date.parse("2026-09-13T10:00:00Z") + min * 60_000);
    convLookupResult = [
      convRow("gc-1", {
        parentId: "child-1",
        rootConversationId: "root-1",
        depth: 2,
      }),
    ];
    rootLookupResult = [convRow("root-1")];
    subtreeResult = [
      // DB returns createdAt ASC (out of id order on purpose)
      row("root-1", { depth: 0, parentId: null, createdAt: t(0) }),
      row("child-1", { depth: 1, parentId: "root-1", createdAt: t(1) }),
      row("child-2", { depth: 1, parentId: "root-1", createdAt: t(2), highlightText: "vector db" }),
      row("gc-1", { depth: 2, parentId: "child-1", createdAt: t(3) }),
     ];
    const { GET } = await import("@/app/api/chats/[id]/tree/route");
    const res = await GET(new Request("http://localhost/api/chats/gc-1/tree") as never, {
      params: Promise.resolve({ id: "gc-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentId).toBe("gc-1");
    expect(body.totalNodes).toBe(4);
    expect(body.truncated).toBe(false);

    const root = body.root;
    expect(root.id).toBe("root-1");
    expect(root.depth).toBe(0);
    expect(root.highlightText).toBeNull();
    expect(root.createdAt).toBe("2026-09-13T10:00:00.000Z");
    expect(root.children.map((c: { id: string }) => c.id)).toEqual([
      "child-1",
      "child-2",
    ]);
    expect(root.children[1].highlightText).toBe("vector db");
    expect(root.children[0].children.map((c: { id: string }) => c.id)).toEqual(["gc-1"]);
    expect(root.children[0].children[0].depth).toBe(2);
    // full DFS pre-order
    expect(collectIds(root)).toEqual(["root-1", "child-1", "gc-1", "child-2"]);
  });

  it("600 nodes → truncated=true, first 500 in DFS pre-order, totalNodes=600", async () => {
    const t0 = Date.parse("2026-09-13T10:00:00Z");
    const N = 600;
    convLookupResult = [convRow("root-1")]; // conv IS the root → no root lookup
    const rows: Row[] = [
      row("root-1", {
        depth: 0,
        parentId: null,
        createdAt: new Date(t0),
      }),
    ];
    for (let i = 1; i < N; i++) {
      rows.push(
        row(`node-${i}`, {
          depth: 1,
          parentId: "root-1",
          createdAt: new Date(t0 + i),
        }),
      );
    }
    subtreeResult = rows;

    const { GET } = await import("@/app/api/chats/[id]/tree/route");
    const res = await GET(new Request("http://localhost/api/chats/root-1/tree") as never, {
      params: Promise.resolve({ id: "root-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.totalNodes).toBe(600);
    // DFS pre-order: root first, then children in createdAt ASC order
    expect(collectIds(body.root)).toEqual([
      "root-1",
      ...Array.from({ length: 499 }, (_, i) => `node-${i + 1}`),
    ]);
    // no partial subtrees: root keeps exactly the 499 included children
    expect(body.root.children.length).toBe(499);
    for (const c of body.root.children) {
      expect(c.children).toEqual([]);
    }
  });

  it("exactly 500 nodes → truncated=false, all returned", async () => {
    const t0 = Date.parse("2026-09-13T10:00:00Z");
    const N = 500;
    convLookupResult = [convRow("root-1")];
    const rows: Row[] = [
      row("root-1", { depth: 0, parentId: null, createdAt: new Date(t0) }),
    ];
    for (let i = 1; i < N; i++) {
      rows.push(
        row(`node-${i}`, {
          depth: 1,
          parentId: "root-1",
          createdAt: new Date(t0 + i),
        }),
      );
    }
    subtreeResult = rows;

    const { GET } = await import("@/app/api/chats/[id]/tree/route");
    const res = await GET(new Request("http://localhost/api/chats/root-1/tree") as never, {
      params: Promise.resolve({ id: "root-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(false);
    expect(body.totalNodes).toBe(500);
    expect(collectIds(body.root).length).toBe(500);
    expect(body.root.children.length).toBe(499);
  });
});
