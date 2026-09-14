import { describe, it, expect, beforeEach, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  logError: vi.fn(),
  selectQueue: [] as Array<() => unknown>,
  inserted: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<Record<string, unknown>>,
  updateSetCalls: [] as Array<{ set: Record<string, unknown> }>,
  deleteCalls: [] as Array<{ where: unknown }>,
  txDeleteCalls: [] as Array<{ where: unknown }>,
  txUpdateCalls: [] as Array<{ set: Record<string, unknown> }>,
  streamChatResponse: vi.fn(),
  isStreamActive: vi.fn(),
  streamText: vi.fn(),
  getActiveProviderFor: vi.fn(),
  realStreamChatResponse: null as unknown as
    | typeof import("@/lib/ai/stream").streamChatResponse
    | null,
}));

function nextRows(): unknown[] {
  const behavior = m.selectQueue.shift();
  if (behavior) return behavior();
  throw new Error("unexpected select call — queue empty");
}

vi.mock("@/lib/auth", () => ({ auth: m.auth }));

vi.mock("@/lib/log", () => ({
  withRequestId: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() })),
  log: { info: vi.fn(), warn: vi.fn(), error: m.logError, debug: vi.fn(), child: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () =>
          ({
            limit: async () => nextRows(),
            orderBy: () =>
              ({
                limit: async () => nextRows(),
                then: (resolve: (v: unknown[]) => void) => resolve(nextRows()),
              }) as never,
            then: (resolve: (v: unknown[]) => void) => resolve(nextRows()),
          }) as never,
      }),
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        m.inserted.push(v);
        return v;
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: async () => {
          m.updateCalls.push(s);
          return undefined;
        },
      }),
    }),
    delete: () => ({
      where: async (w: unknown) => {
        m.deleteCalls.push({ where: w });
        return undefined;
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        update: () => ({
          set: (s: Record<string, unknown>) => ({
            where: async () => {
              m.txUpdateCalls.push({ set: s });
              return undefined;
            },
          }),
        }),
        delete: () => ({
          where: async (w: unknown) => {
            m.txDeleteCalls.push({ where: w });
            return undefined;
          },
        }),
      }),
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  getActiveProviderFor: m.getActiveProviderFor,
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

vi.mock("@/lib/ai/stream", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/ai/stream")
  >();
  m.realStreamChatResponse = actual.streamChatResponse;
  return {
    ...actual,
    streamChatResponse: m.streamChatResponse,
    isStreamActive: m.isStreamActive,
  };
});

vi.mock("ai", () => ({
  streamText: m.streamText,
}));

import { resetMutationRateLimit, checkMutationRateLimit } from "@/lib/auth/rate-limit";
import { _internalInFlightMap, walkAncestors } from "@/lib/ai/stream";

const USER_A = "user-A";
const PID = "provider-1";

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

function msgRow(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    conversationId: "conv-1",
    role: "user",
    content: "original question",
    model: null,
    providerId: null,
    createdAt: new Date("2026-09-13T10:01:00Z"),
    ...over,
  };
}

async function importEdit() {
  return await import(
    "@/app/api/chats/[id]/messages/[messageId]/edit/route"
  );
}

async function importRegen() {
  return await import(
    "@/app/api/chats/[id]/messages/[messageId]/regenerate/route"
  );
}

function editReq(_ctx: unknown, body: unknown) {
  return {
    json: async () => body,
  } as never;
}

function editReqBody(body: unknown) {
  return {
    json: async () => body,
  } as never;
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetMutationRateLimit(USER_A);
  m.selectQueue = [];
  m.inserted = [];
  m.updateCalls = [];
  m.updateSetCalls = [];
  m.deleteCalls = [];
  m.txDeleteCalls = [];
  m.txUpdateCalls = [];
  m.isStreamActive.mockReturnValue(false);
  m.streamChatResponse.mockResolvedValue({
    ok: true,
    response: new Response("data: ok\n\n", {
      headers: { "content-type": "text/event-stream" },
    }),
  });
});

function queueEditRows(targetRow: unknown[] | null) {
  m.selectQueue.push(() => targetRow ?? [], () =>
    targetRow === null ? [] : [targetRow],
  );
}

describe("POST .../edit", () => {
  it("401 without session", async () => {
    session(null);
    const route = await importEdit();
    const res = await route.POST(editReqBody({ content: "edited" }), {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(401);
  });

  it("404 for missing/foreign conversation", async () => {
    session(USER_A);
    m.selectQueue.push(() => []);
    const route = await importEdit();
    const res = await route.POST(editReqBody({ content: "edited" }), {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Conversation not found" },
    });
  });

  it("404 for message not in THIS conversation (enumeration guard)", async () => {
    session(USER_A);
    m.selectQueue.push(() => [convRow({})], () => []);
    const route = await importEdit();
    const res = await route.POST(editReqBody({ content: "edited" }), {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Message not found" },
    });
  });

  it("422 NOT_EDITABLE for an assistant target", async () => {
    session(USER_A);
    m.selectQueue.push(
      () => [convRow({})],
      () => [msgRow({ role: "assistant" })],
    );
    const route = await importEdit();
    const res = await route.POST(editReqBody({ content: "nope" }), {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_EDITABLE");
    expect(body.error.message).toBe("Only your own messages can be edited");
  });

  it("422 INVALID_INPUT for empty/oversized content (fields.content)", async () => {
    session(USER_A);
    for (const bad of ["", "x".repeat(8001)]) {
      m.selectQueue.push(() => [convRow({})], () => [msgRow({})]);
      const route = await importEdit();
      const res = await route.POST(editReqBody({ content: bad }), {
        params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_INPUT");
      expect(body.error.fields?.content).toBeTruthy();
    }
  });

  it("strict body: unknown fields rejected", async () => {
    session(USER_A);
    m.selectQueue.push(() => [convRow({})], () => [msgRow({})]);
    const route = await importEdit();
    const res = await route.POST(editReqBody({ content: "hi", x: 1 }), {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(422);
  });

  it("409 STREAM_ACTIVE when the conversation is streaming", async () => {
    session(USER_A);
    m.isStreamActive.mockReturnValue(true);
    m.selectQueue.push(
      () => [convRow({})],
      () => [msgRow({})],
    );
    const route = await importEdit();
    const res = await route.POST(editReqBody({ content: "edited" }), {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: { code: "STREAM_ACTIVE", message: "Stop the current response first" },
    });
    expect(m.txDeleteCalls.length).toBe(0);
  });

  it("truncate-in-place then re-stream with skipUserPersist (US-407 AC.4/AC.9)", async () => {
    session(USER_A);
    const target = msgRow({ id: "m2", content: "original question" });
    m.selectQueue.push(() => [convRow({ depth: 0 })], () => [target]);
    const route = await importEdit();
    const res = await route.POST(editReqBody({ content: "EDITED QUESTION" }), {
      params: Promise.resolve({
        id: "conv-1",
        messageId: "m1",
      }),
    });
    expect(res.status).toBe(200);
    // (a) content updated, (b) tail deleted — both inside one transaction
    expect(m.txUpdateCalls.length).toBe(1);
    expect(m.txUpdateCalls[0]!.set.content).toBe("EDITED QUESTION");
    expect(m.txDeleteCalls.length).toBe(1);
    // (c) re-stream via the existing path, no duplicate user row
    expect(m.streamChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        userMessage: "EDITED QUESTION",
        skipUserPersist: true,
        depth: 0,
      }),
    );
  });

  it("429 after the mutation bucket is exhausted (30/10min shared)", async () => {
    session(USER_A);
    for (let i = 0; i < 30; i++) {
      expect(checkMutationRateLimit(USER_A).allowed).toBe(true);
    }
    m.selectQueue.push(() => [convRow({})]); // not reached; RL preempts by default? no — RL checked first
    const route = await importEdit();
    const res = await route.POST(editReqBody({ content: "late" }), {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Limit")).toBe("30");
  });
});

describe("POST .../regenerate", () => {
  it("404 for missing/foreign conversation", async () => {
    session(USER_A);
    m.selectQueue.push(() => []);
    const route = await importRegen();
    const res = await route.POST({} as never, {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(404);
  });

  it("404 for message not in this conversation", async () => {
    session(USER_A);
    m.selectQueue.push(() => [convRow({})], () => []);
    const route = await importRegen();
    const res = await route.POST({} as never, {
      params: Promise.resolve({ id: "conv-1", messageId: "m9" }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Message not found" },
    });
  });

  it("422 NOT_REGENERABLE for a user-role target", async () => {
    session(USER_A);
    m.selectQueue.push(
      () => [convRow({})],
      () => [msgRow({ id: "m1", role: "user" })],
    );
    const route = await importRegen();
    const res = await route.POST({} as never, {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_REGENERABLE");
  });

  it("422 NOT_REGENERABLE for a non-last assistant message", async () => {
    session(USER_A);
    // target m1 is assistant but the latest assistant row is m9
    m.selectQueue.push(
      () => [convRow({})],
      () => [msgRow({ id: "m1", role: "assistant" })],
      () => [{ id: "m9" }],
    );
    const route = await importRegen();
    const res = await route.POST({} as never, {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_REGENERABLE");
    // last-assistant lookup runs before the stream; m1 not deleted
    expect(m.txDeleteCalls.length).toBe(0);
  });

  it("409 STREAM_ACTIVE when streaming", async () => {
    session(USER_A);
    m.isStreamActive.mockReturnValue(true);
    m.selectQueue.push(
      () => [convRow({})],
      () => [msgRow({ id: "m1", role: "assistant" })],
      () => [{ id: "m1" }],
    );
    const route = await importRegen();
    const res = await route.POST({} as never, {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(409);
    expect(m.txDeleteCalls.length).toBe(0);
  });

  it("deletes the last assistant row, re-streams same history, no user row", async () => {
    session(USER_A);
    m.selectQueue.push(
      () => [convRow({ depth: 0 })],
      () => [msgRow({ id: "m1", role: "assistant" })],
      () => [{ id: "m1" }],
    );
    const route = await importRegen();
    const res = await route.POST({} as never, {
      params: Promise.resolve({ id: "conv-1", messageId: "m1" }),
    });
    expect(res.status).toBe(200);
    expect(m.txDeleteCalls.length).toBe(1);
    expect(m.streamChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        skipUserPersist: true,
      }),
    );
    expect(m.streamChatResponse.mock.calls[0]![0]).toMatchObject({
      skipUserPersist: true,
    });
  });
});

describe("abort-time partial persistence (US-405 AC.2)", () => {
  it("persists the accumulated partial assistant row + releases the lock on abort", async () => {
    session(USER_A);
    m.getActiveProviderFor.mockResolvedValue({
      id: "p1",
      modelId: "m1",
      model: {},
    });
    // assertOwnership → [row]; loadHistory → []
    m.selectQueue.push(() => [convRow({})], () => []);
    let captured: any;
    m.streamText.mockImplementation((opts: any) => {
      captured = opts;
      return {
        toDataStreamResponse: () => new Response("data: stub\n\n"),
      };
    });
    const res = await m.realStreamChatResponse!({
      conversationId: "conv-1",
      userId: USER_A,
      userMessage: "tell me something",
      depth: 0,
    });
    expect(res.ok).toBe(true);

    // simulate provider token arrival, then a client-disconnect abort
    const opts = captured;
    opts.onChunk({ chunk: { type: "text-delta", textDelta: "PARTIAL ANSWER" } });
    if (typeof opts.abortSignal.abort === "function") {
      opts.abortSignal.abort();
    } else {
      // older Node realm: trigger listeners directly
      opts.abortSignal.dispatchEvent?.(new Event("abort"));
    }

    await new Promise((r) => setTimeout(r, 50));

    const assistantRow = m.inserted.find((r) => r.role === "assistant");
    expect(assistantRow).toMatchObject({
      conversationId: "conv-1",
      role: "assistant",
      content: "PARTIAL ANSWER",
      model: "m1",
      providerId: "p1",
    });
    expect(_internalInFlightMap().has("conv-1")).toBe(false);
  });
});

describe("ancestor walk sees the edited content (US-407 AC.9)", () => {
  it("constructed history contains the edited string", async () => {
    const target = {
      id: "conv-1",
      userId: USER_A,
      parentId: null,
      rootConversationId: "conv-1",
      depth: 0,
      title: "Root",
      highlightText: null,
    };
    const history = await walkAncestors({
      target,
      sessionUserId: USER_A,
      fetcher: {
        fetchConvById: async () => null,
        fetchMessagesByConvIds: async () => [
          msgRow({ id: "m1", content: "EDITED QUESTION", createdAt: new Date(10) }),
        ],
      },
      newUserMessage: "carry on",
    });
    const joined = JSON.stringify(history);
    expect(joined).toContain("EDITED QUESTION");
    expect(joined).not.toContain("original question");
  });
});
