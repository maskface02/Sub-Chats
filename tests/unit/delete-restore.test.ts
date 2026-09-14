import { describe, it, expect, beforeEach, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  logError: vi.fn(),
  selectQueue: [] as Array<() => unknown>,
  inserted: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<{ set: Record<string, unknown> }>,
  updateReturning: [] as Array<unknown[]>,
  deleteCalls: [] as Array<{ where: unknown }>,
}));

function nextRows(): unknown[] {
  const behavior = m.selectQueue.shift();
  if (behavior) return behavior();
  throw new Error("unexpected select call — queue empty");
}

vi.mock("@/lib/auth", () => ({
  auth: m.auth,
}));

vi.mock("@/lib/log", () => ({
  withRequestId: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() })),
  log: { info: vi.fn(), warn: vi.fn(), error: m.logError, debug: vi.fn(), child: vi.fn() },
}));

const txUpdated: Array<{ set: Record<string, unknown> }> = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () =>
          ({
            limit: async () => nextRows(),
            orderBy: async () => nextRows(),
            then: (resolve: (v: unknown[]) => void) => resolve(nextRows()),
          }) as never,
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        update: () => ({
          set: (s: Record<string, unknown>) => ({
            where: async () => {
              m.updateCalls.push({ set: s });
              return undefined;
            },
          }),
        }),
      }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: () => ({
          returning: async (p: unknown) => {
            m.updateCalls.push({ set: s });
            m.updateReturning.push([p]);
            return [{ id: "row-1" }, { id: "row-2" }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        m.inserted.push(v);
        return v;
      },
    }),
    delete: () => ({
      where: async (w: unknown) => {
        m.deleteCalls.push({ where: w });
        return undefined;
      },
    }),
  },
}));

import { resetMutationRateLimit } from "@/lib/auth/rate-limit";
import { _internalInFlightMap } from "@/lib/ai/stream";
import { collectLiveSubtreeIds } from "@/app/api/chats/[id]/route";

const USER_A = "user-A";

function session(userId: string | null) {
  m.auth.mockImplementation(async () =>
    userId ? { user: { id: userId } } : null,
  );
}

function convRow(over: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    userId: USER_A,
    title: "Root",
    parentId: null,
    rootConversationId: "conv-1",
    depth: 0,
    highlightText: null,
    highlightContext: null,
    createdAt: new Date("2026-09-13T10:00:00Z"),
    updatedAt: new Date("2026-09-13T10:05:00Z"),
    deletedAt: null,
    deletedBatchId: null,
    ...over,
  };
}

async function importRoutes() {
  vi.resetModules();
  return await import("@/app/api/chats/[id]/route");
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetMutationRateLimit(USER_A);
  _internalInFlightMap().clear();
  m.selectQueue = [];
  m.inserted = [];
  m.updateCalls = [];
  m.updateReturning = [];
  m.deleteCalls = [];
  txUpdated.length = 0;
});

describe("DELETE /api/chats/:id (soft-delete)", () => {
  it("401 without a session", async () => {
    session(null);
    const { DELETE } = await import("@/app/api/chats/[id]/route");
    const res = await DELETE({} as never, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: { code: "UNAUTHENTICATED", message: "Sign in required" },
    });
  });

  it("404 byte-identical for missing/foreign ids", async () => {
    session(USER_A);
    m.selectQueue.push(() => []);
    const { DELETE } = await import("@/app/api/chats/[id]/route");
    const res = await DELETE({} as never, {
      params: Promise.resolve({ id: "conv-x" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "NOT_FOUND", message: "Conversation not found" },
    });

    // soft-deleted id → same 404
    session(USER_A);
    m.selectQueue = [() => []];
    const res2 = await DELETE({} as never, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res2.status).toBe(404);
    expect(await res2.json()).toEqual(body);
  });

  it("409 STREAM_ACTIVE when a descendant is streaming", async () => {
    session(USER_A);
    const controller = new AbortController();
    _internalInFlightMap().set("child-1", controller);
    m.selectQueue.push(
      () => [convRow({})],
      () => [
        { id: "conv-1", parentId: null, deletedAt: null },
        { id: "child-1", parentId: "conv-1", deletedAt: null },
      ],
    );
    const { DELETE } = await import("@/app/api/chats/[id]/route");
    const res = await DELETE({} as never, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "STREAM_ACTIVE",
        message: "Stop the current response before deleting",
      },
    });
    // nothing soft-deleted
    expect(m.updateCalls.length).toBe(0);
  });

  it("200 soft-deletes target + live descendants, returns batchId", async () => {
    session(USER_A);
    m.selectQueue.push(
      () => [convRow({})],
      () => [
        { id: "conv-1", parentId: null, deletedAt: null },
        { id: "child-1", parentId: "conv-1", deletedAt: null },
        { id: "child-2", parentId: "conv-1", deletedAt: null },
      ],
    );
    const { DELETE } = await import("@/app/api/chats/[id]/route");
    const res = await DELETE({} as never, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deletedIds).toEqual(["conv-1", "child-1", "child-2"]);
    expect(body.deletedCount).toBe(3);
    expect(typeof body.batchId).toBe("string");
    expect(body.deletedIds.length).toBe(body.deletedCount);
    // cascade sets deletedAt + live-only filter; delete is soft (no DELETE)
    expect(m.updateCalls.length).toBe(1);
    expect(m.updateCalls[0]!.set.deletedAt).toBeInstanceOf(Date);
    expect(m.updateCalls[0]!.set.deletedBatchId).toBe(body.batchId);
    expect(m.deleteCalls.length).toBe(0);
  });
});

describe("collectLiveSubtreeIds (nested-delete batch integrity, US-403 AC.2b)", () => {
  const rows = [
    { id: "root", parentId: null, deletedAt: null },
    { id: "child", parentId: "root", deletedAt: null },
    { id: "leaf", parentId: "child", deletedAt: new Date(100) },
    { id: "leaf2", parentId: "child", deletedAt: null },
  ];

  it("only live descendants join the batch; separately deleted keep their batch", () => {
    const ids = collectLiveSubtreeIds(rows, "root");
    expect(ids).toEqual(["root", "child", "leaf2"]);
  });

  it("deleting an already-deleted leaf yields an empty set", () => {
    expect(collectLiveSubtreeIds(rows, "leaf")).toEqual([]);
  });
});

describe("POST /api/chats/:id/restore", () => {
  it("404 for missing/foreign conversations", async () => {
    session(USER_A);
    m.selectQueue.push(() => []);
    const route = await import("@/app/api/chats/[id]/route");
    const res = await route.POST({} as never, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("idempotent: live conversation → 200 { restoredCount: 0 }", async () => {
    session(USER_A);
    m.selectQueue.push(() => [convRow({ deletedAt: null })]);
    const route = await import("@/app/api/chats/[id]/route");
    const res = await route.POST({} as never, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restoredCount: 0 });
    expect(m.updateCalls.length).toBe(0);
  });

  it("restores the target row's OWN deletedBatchId (not the client's)", async () => {
    session(USER_A);
    m.selectQueue.push(() => [
      convRow({ deletedAt: new Date(1), deletedBatchId: "batch-A" }),
    ]);
    const route = await import("@/app/api/chats/[id]/route");
    const res = await route.POST({} as never, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restoredCount: 2 });
    expect(m.updateCalls[0]!.set).toEqual({
      deletedAt: null,
      deletedBatchId: null,
    });
  });
});

describe("branch on a soft-deleted conversation → 404", () => {
  it("404 NOT_FOUND", async () => {
    session(USER_A);
    m.selectQueue.push(() => []); // deleted row filtered out
    const branch = await import("@/app/api/chats/[id]/branch/route");
    const req = {
      json: async () => ({
        messageId: "m1",
        selectedText: "sel",
        charStart: 0,
        charEnd: 3,
      }),
    } as never;
    const res = await branch.POST(req, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
