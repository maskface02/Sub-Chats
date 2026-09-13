import { describe, it, expect, beforeEach, vi } from "vitest";

const selectResult: unknown[] = [];
const insertCalls: unknown[] = [];

function makeProxyDb() {
  return {
    db: new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === "select") {
            return () => ({
              from: () => ({
                leftJoin: () => ({
                  where: () => ({
                    orderBy: () => ({
                      limit: async () => selectResult,
                    }),
                    limit: async () => selectResult,
                  }),
                }),
                where: () => ({
                  orderBy: () => ({
                    limit: async () => selectResult,
                  }),
                  limit: async () => selectResult,
                }),
              }),
            });
          }
          if (prop === "insert") {
            return () => ({
              values: async (v: unknown) => {
                insertCalls.push(v);
                return undefined;
              },
            });
          }
          if (prop === "update") {
            return () => ({
              set: () => ({
                where: async () => undefined,
              }),
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
vi.mock("@/lib/ai/provider", () => ({
  getActiveProvider: vi.fn(async () => null),
  isOllamaReachable: vi.fn(async () => false),
  noProvider: () => ({ code: "NO_PROVIDER", message: "No AI provider" }),
}));

describe("route handlers — auth + ownership", () => {
  beforeEach(() => {
    currentSession = null;
    selectResult.length = 0;
    insertCalls.length = 0;
    vi.resetModules();
  });

  it("GET /api/chats → 401 when no session", async () => {
    currentSession = null;
    const { GET } = await import("@/app/api/chats/route");
    const req = new Request("http://localhost/api/chats");
    const res = await GET(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("POST /api/chats → 401 when no session", async () => {
    currentSession = null;
    const { POST } = await import("@/app/api/chats/route");
    const req = new Request("http://localhost/api/chats", { method: "POST" });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(401);
  });

  it("GET /api/chats/[id] → 401 when no session", async () => {
    currentSession = null;
    const { GET } = await import("@/app/api/chats/[id]/route");
    const req = new Request("http://localhost/api/chats/abc");
    const res = await GET(req as unknown as import("next/server").NextRequest, {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/chats/[id] → 404 (not 403) when conversation belongs to another user", async () => {
    currentSession = { user: { id: "user-A" } };
    // mock db returns no rows for conversation lookup → cross-user
    selectResult.length = 0;
    const { GET } = await import("@/app/api/chats/[id]/route");
    const req = new Request("http://localhost/api/chats/conv-B");
    const res = await GET(req as unknown as import("next/server").NextRequest, {
      params: Promise.resolve({ id: "conv-B" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("POST /api/chats/[id]/messages → 401 when no session", async () => {
    currentSession = null;
    const { POST } = await import(
      "@/app/api/chats/[id]/messages/route"
    );
    const req = new Request("http://localhost/api/chats/x/messages", {
      method: "POST",
      body: JSON.stringify({ content: "hi" }),
    });
    const res = await POST(
      req as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/chats/[id]/messages → 422 on empty content", async () => {
    currentSession = { user: { id: "user-A" } };
    selectResult.length = 0; // conversation not found
    const { POST } = await import(
      "@/app/api/chats/[id]/messages/route"
    );
    const req = new Request("http://localhost/api/chats/x/messages", {
      method: "POST",
      body: JSON.stringify({ content: "" }),
    });
    const res = await POST(
      req as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.fields?.content).toBeTruthy();
  });
});