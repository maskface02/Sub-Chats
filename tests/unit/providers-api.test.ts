import { describe, it, expect, beforeEach, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  validateProviderBaseUrl: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  selectBehaviors: [] as Array<() => unknown[]>,
  defaultSelect: (() => []) as () => unknown[],
  inserted: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<{ set: Record<string, unknown> }>,
  deleteCalled: vi.fn(),
}));

function nextRows(): unknown[] {
  const behavior = m.selectBehaviors.shift();
  if (behavior) return behavior();
  return m.defaultSelect();
}

vi.mock("@/lib/auth", () => ({
  auth: m.auth,
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          // thenable: supports `await db.select()...where(...)` with no chain
          then: (resolve: (v: unknown[]) => void) => resolve(nextRows()),
          orderBy: async () => nextRows(),
          limit: async () => nextRows(),
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        insert: () => ({
          values: (v: Record<string, unknown>) => ({
            returning: async () => {
              m.inserted.push(v);
              m.rows.push(v);
              return [v];
            },
          }),
        }),
        update: () => ({
          set: (s: Record<string, unknown>) => ({
            where: async () => {
              m.updateCalls.push({ set: s });
              return undefined;
            },
          }),
        }),
      }),
    delete: () => ({
      where: async () => {
        m.deleteCalled();
        return undefined;
      },
    }),
  },
}));

vi.mock("@/lib/ai/ssrf-guard", () => ({
  validateProviderBaseUrl: m.validateProviderBaseUrl,
  assertSendTimeAllowed: vi.fn(),
  SsrfBlockedError: class SsrfBlockedError extends Error {},
}));

vi.mock("@/lib/log", () => ({
  log: {
    info: vi.fn(),
    warn: m.logWarn,
    error: m.logError,
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

import { resetProviderRateLimit } from "@/lib/auth/rate-limit";

type NextRequest = import("next/server").NextRequest;

const USER_A = "user-A";

function session(userId: string | null) {
  m.auth.mockImplementation(async () =>
    userId ? { user: { id: userId } } : null,
  );
}

function rowFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "row-1",
    userId: USER_A,
    type: "openai",
    baseUrl: null,
    apiKeyCiphertext: null,
    defaultModel: "gpt-4o-mini",
    isDefault: true,
    createdAt: new Date("2026-09-14T10:00:00Z"),
    ...overrides,
  };
}

async function importRoutes() {
  vi.resetModules();
  return {
    list: await import("@/app/api/providers/route"),
    item: await import("@/app/api/providers/[id]/route"),
  };
}

beforeEach(async () => {
  m.auth.mockReset();
  m.validateProviderBaseUrl.mockReset();
  m.validateProviderBaseUrl.mockResolvedValue({ ok: true });
  m.rows = [];
  m.selectBehaviors = [];
  m.defaultSelect = () => [];
  m.inserted = [];
  m.updateCalls = [];
  m.deleteCalled.mockReset();
  m.logWarn.mockClear();
  m.logError.mockClear();
  resetProviderRateLimit(USER_A);
  process.env.ENCRYPTION_KEY = Buffer.from(
    "0123456789abcdef0123456789abcdef",
    "utf8",
  ).toString("base64");
});

describe("provider routes — auth (US-301)", () => {
  it("GET /api/providers → 401 when no session", async () => {
    session(null);
    const { list } = await importRoutes();
    const res = await list.GET();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("POST /api/providers → 401 when no session", async () => {
    session(null);
    const { list } = await importRoutes();
    const req = new Request("http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({ type: "openai", apiKey: "sk-x" }),
    });
    const res = await list.POST(req as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  it("PUT /api/providers/:id → 401 when no session", async () => {
    session(null);
    const { item } = await importRoutes();
    const req = new Request("http://localhost/api/providers/row-1", {
      method: "PUT",
      body: JSON.stringify({}),
    });
    const res = await item.PUT(req as unknown as NextRequest, {
      params: Promise.resolve({ id: "row-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /api/providers/:id → 401 when no session", async () => {
    session(null);
    const { item } = await importRoutes();
    const res = await item.DELETE(new Request("http://localhost/x") as NextRequest, {
      params: Promise.resolve({ id: "row-1" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/providers — masked hints only (US-302 AC.3)", () => {
  it("returns items with hint from decrypt, null for no key, null + warn on corrupt", async () => {
    session(USER_A);
    const { encrypt } = await import("@/lib/crypto/encrypt");
    const good = encrypt("sk-test-1234");
    m.defaultSelect = () => [
      rowFixture({ id: "row-good", apiKeyCiphertext: good }),
      rowFixture({ id: "row-none", apiKeyCiphertext: null, isDefault: false }),
      rowFixture({ id: "row-corrupt", apiKeyCiphertext: "v1:bm90LWF0YWc=:bm90LWRhdGE=", isDefault: false }),
    ];
    const { list } = await importRoutes();
    const res = await list.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(3);
    expect(body.items[0].apiKeyHint).toBe("…1234");
    expect(body.items[1].apiKeyHint).toBeNull();
    expect(body.items[2].apiKeyHint).toBeNull();
    expect(m.logWarn).toHaveBeenCalled();
    // no key material anywhere in the response
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("sk-test-1234");
    expect(raw).not.toContain(good);
    expect(raw).not.toContain("apiKeyCiphertext");
  });
});

describe("POST /api/providers — create (US-301)", () => {
  it("creates the first provider, auto-default, encrypted key, masked hint", async () => {
    session(USER_A);
    const { list } = await importRoutes();
    const req = new Request("http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({ type: "openai", apiKey: "sk-live-abcd1234" }),
    });
    const res = await list.POST(req as unknown as NextRequest);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.isDefault).toBe(true);
    expect(body.apiKeyHint).toBe("…1234");
    expect(body.type).toBe("openai");
    expect(m.inserted).toHaveLength(1);
    expect(m.inserted[0]!.apiKeyCiphertext).toMatch(/^v1:/);
    expect(JSON.stringify(body)).not.toContain("sk-live-abcd1234");
  });

  it("respects submitted isDefault on non-first providers and clears the old default", async () => {
    session(USER_A);
    m.defaultSelect = () => [rowFixture({ id: "old-default", isDefault: true })];
    const { list } = await importRoutes();
    const req = new Request("http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({
        type: "anthropic",
        apiKey: "sk-ant-9999",
        isDefault: true,
      }),
    });
    const res = await list.POST(req as unknown as NextRequest);
    expect(res.status).toBe(201);
    expect(m.updateCalls).toContainEqual({ set: { isDefault: false } });
  });

  it("422 INVALID_INPUT on unknown fields (strict)", async () => {
    session(USER_A);
    const { list } = await importRoutes();
    const req = new Request("http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({ type: "openai", apiKey: "sk-x", Evil: 1 }),
    });
    const res = await list.POST(req as unknown as NextRequest);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("enforces per-type field rules (AC.3)", async () => {
    session(USER_A);
    const { list } = await importRoutes();

    const post = async (payload: Record<string, unknown>) => {
      const req = new Request("http://localhost/api/providers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return list.POST(req as unknown as NextRequest);
    };

    const openaiWithBaseUrl = await post({
      type: "openai",
      apiKey: "sk-x",
      baseUrl: "https://api.openai.com",
    });
    expect(openaiWithBaseUrl.status).toBe(422);
    expect((await openaiWithBaseUrl.json()).error.fields.baseUrl).toBeTruthy();

    const openaiNoKey = await post({ type: "openai" });
    expect(openaiNoKey.status).toBe(422);
    expect((await openaiNoKey.json()).error.fields.apiKey).toBeTruthy();

    const ollamaNoBaseUrl = await post({ type: "ollama" });
    expect(ollamaNoBaseUrl.status).toBe(422);
    expect((await ollamaNoBaseUrl.json()).error.fields.baseUrl).toBeTruthy();

    const ollamaWithKey = await post({
      type: "ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "sk-x",
    });
    expect(ollamaWithKey.status).toBe(422);
    expect((await ollamaWithKey.json()).error.fields.apiKey).toBeTruthy();

    const customNoBaseUrl = await post({ type: "custom" });
    expect(customNoBaseUrl.status).toBe(422);
    expect((await customNoBaseUrl.json()).error.fields.baseUrl).toBeTruthy();
  });

  it("422 PROVIDER_LIMIT at the 11th provider (AC.5)", async () => {
    session(USER_A);
    m.defaultSelect = () =>
      Array.from({ length: 10 }, (_, i) => rowFixture({ id: `row-${i}` }));
    const { list } = await importRoutes();
    const req = new Request("http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({ type: "openai", apiKey: "sk-x" }),
    });
    const res = await list.POST(req as unknown as NextRequest);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("PROVIDER_LIMIT");
    expect(body.error.message).toBe("You can store up to 10 providers");
  });

  it("422 with fields.baseUrl when the SSRF guard blocks (AC.3b)", async () => {
    session(USER_A);
    m.validateProviderBaseUrl.mockResolvedValue({
      ok: false,
      reason: "baseUrl must not point to a private address",
    });
    const { list } = await importRoutes();
    const req = new Request("http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({
        type: "custom",
        baseUrl: "http://internal.example.com",
        defaultModel: "m",
      }),
    });
    const res = await list.POST(req as unknown as NextRequest);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.fields.baseUrl).toBe(
      "baseUrl must not point to a private address",
    );
  });

  it("429 RATE_LIMITED with phase-1 headers after 30 mutations/10min (AC.11)", async () => {
    session(USER_A);
    const { list } = await importRoutes();
    let last: Response | undefined;
    for (let i = 0; i < 30; i++) {
      const req = new Request("http://localhost/api/providers", {
        method: "POST",
        body: JSON.stringify({ type: "openai", apiKey: `sk-${i}` }),
      });
      last = await list.POST(req as unknown as NextRequest);
      expect(last.status).toBe(201);
    }
    const req31 = new Request("http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({ type: "openai", apiKey: "sk-31" }),
    });
    const res = await list.POST(req31 as unknown as NextRequest);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Limit")).toBe("30");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("500 INTERNAL when encryption key material is missing, never plaintext (US-302 AC.5)", async () => {
    session(USER_A);
    delete process.env.ENCRYPTION_KEY;
    delete process.env.AUTH_SECRET;
    const { list } = await importRoutes();
    const req = new Request("http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({ type: "openai", apiKey: "sk-plain-fallback" }),
    });
    const res = await list.POST(req as unknown as NextRequest);
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL");
    expect(m.inserted).toHaveLength(0);
    expect(JSON.stringify(m.logError.mock.calls)).not.toContain("sk-plain-fallback");
  });
});

describe("PUT /api/providers/:id (US-301 AC.8, AC.10)", () => {
  it("updates fields, keeps ciphertext when apiKey omitted, clears previous default", async () => {
    session(USER_A);
    m.defaultSelect = () => [rowFixture({ apiKeyCiphertext: "v1:old:old" })];
    const { item } = await importRoutes();
    const req = new Request("http://localhost/api/providers/row-1", {
      method: "PUT",
      body: JSON.stringify({ defaultModel: "gpt-4o", isDefault: true }),
    });
    const res = await item.PUT(req as unknown as NextRequest, {
      params: Promise.resolve({ id: "row-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaultModel).toBe("gpt-4o");
    expect(body.isDefault).toBe(true);
    expect(body.apiKeyHint).toBeNull();
    expect(m.updateCalls).toContainEqual({
      set: { defaultModel: "gpt-4o", isDefault: true },
    });
    expect(m.updateCalls).toContainEqual({ set: { isDefault: false } });
    for (const call of m.updateCalls) {
      expect(call.set.apiKeyCiphertext).toBeUndefined();
    }
  });

  it("re-encrypts and replaces the key when apiKey is supplied", async () => {
    session(USER_A);
    m.defaultSelect = () => [rowFixture({ apiKeyCiphertext: "v1:old:old" })];
    const { item } = await importRoutes();
    const req = new Request("http://localhost/api/providers/row-1", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "sk-new-7777" }),
    });
    const res = await item.PUT(req as unknown as NextRequest, {
      params: Promise.resolve({ id: "row-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiKeyHint).toBe("…7777");
    const setCalls = m.updateCalls.map((c) => c.set);
    expect(
      setCalls.some((s) => typeof s.apiKeyCiphertext === "string" && s.apiKeyCiphertext.startsWith("v1:")),
    ).toBe(true);
  });

  it("422 when type is supplied (immutable, strict unknown field)", async () => {
    session(USER_A);
    const { item } = await importRoutes();
    const req = new Request("http://localhost/api/providers/row-1", {
      method: "PUT",
      body: JSON.stringify({ type: "ollama" }),
    });
    const res = await item.PUT(req as unknown as NextRequest, {
      params: Promise.resolve({ id: "row-1" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("re-validates baseUrl through the SSRF guard", async () => {
    session(USER_A);
    m.defaultSelect = () => [rowFixture({ type: "custom", baseUrl: "https://old.example.com" })];
    m.validateProviderBaseUrl.mockResolvedValue({
      ok: false,
      reason: "baseUrl must not point to a private address",
    });
    const { item } = await importRoutes();
    const req = new Request("http://localhost/api/providers/row-1", {
      method: "PUT",
      body: JSON.stringify({ baseUrl: "http://internal.example.com" }),
    });
    const res = await item.PUT(req as unknown as NextRequest, {
      params: Promise.resolve({ id: "row-1" }),
    });
    expect(res.status).toBe(422);
    expect(m.validateProviderBaseUrl).toHaveBeenCalledWith(
      "http://internal.example.com",
      "custom",
    );
  });

  it("404 body is byte-identical for missing id and foreign-owned id (AC.10)", async () => {
    session(USER_A);
    const { item } = await importRoutes();
    m.defaultSelect = () => []; // missing id
    const resMissing = await item.PUT(
      new Request("http://localhost/api/providers/nope", {
        method: "PUT",
        body: JSON.stringify({}),
      }) as unknown as NextRequest,
      { params: Promise.resolve({ id: "nope" }) },
    );
    // foreign-owned row is filtered out by the userId-scoped query → same path
    m.defaultSelect = () => [];
    const resForeign = await item.PUT(
      new Request("http://localhost/api/providers/foreign", {
        method: "PUT",
        body: JSON.stringify({}),
      }) as unknown as NextRequest,
      { params: Promise.resolve({ id: "foreign" }) },
    );
    expect(resMissing.status).toBe(404);
    expect(resForeign.status).toBe(404);
    expect(await resMissing.text()).toBe(await resForeign.text());
  });
});

describe("DELETE /api/providers/:id (US-301 AC.9, AC.10)", () => {
  it("204 with empty body, no auto-promotion call", async () => {
    session(USER_A);
    m.defaultSelect = () => [rowFixture({ isDefault: true })];
    const { item } = await importRoutes();
    const res = await item.DELETE(new Request("http://localhost/x") as NextRequest, {
      params: Promise.resolve({ id: "row-1" }),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(m.deleteCalled).toHaveBeenCalled();
    // no update call → no auto-promotion
    expect(m.updateCalls).toHaveLength(0);
  });

  it("404 for missing or foreign-owned id", async () => {
    session(USER_A);
    m.defaultSelect = () => [];
    const { item } = await importRoutes();
    const res = await item.DELETE(new Request("http://localhost/x") as NextRequest, {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });
});
