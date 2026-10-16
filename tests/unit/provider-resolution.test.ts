import { describe, it, expect, beforeEach, vi } from "vitest";

const m = vi.hoisted(() => ({
  createOpenAI: vi.fn(),
  createAnthropic: vi.fn(),
  openaiDefault: vi.fn(),
  decrypt: vi.fn(),
  assertSendTimeAllowed: vi.fn(),
  selectRows: [] as unknown[],
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
  SsrfBlockedError: class SsrfBlockedError extends Error {
    name = "SsrfBlockedError";
  },
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (cfg: unknown) => {
    m.createOpenAI(cfg);
    return (modelId: string) => ({ factory: "createOpenAI", cfg, modelId });
  },
  openai: (modelId: string) => ({ factory: "openai-default", modelId }),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: (cfg: unknown) => {
    m.createAnthropic(cfg);
    return (modelId: string) => ({ factory: "createAnthropic", cfg, modelId });
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => m.selectRows,
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/log", () => ({
  withRequestId: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() })),
  log: {
    info: m.logInfo,
    warn: m.logWarn,
    error: m.logError,
    debug: m.logDebug,
    child: () => m.logInfo,
  },
}));

vi.mock("@/lib/crypto/encrypt", () => ({
  decrypt: m.decrypt,
  encrypt: vi.fn(),
  CryptoError: class CryptoError extends Error {},
}));

vi.mock("@/lib/ai/ssrf-guard", () => ({
  assertSendTimeAllowed: m.assertSendTimeAllowed,
  validateProviderBaseUrl: vi.fn(),
  SsrfBlockedError: m.SsrfBlockedError,
  ssrfSafeFetch: vi.fn(() => vi.fn()),
}));

const ENV_KEYS = [
  "NVIDIA_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OLLAMA_BASE_URL",
  "ENCRYPTION_KEY",
  "AUTH_SECRET",
];

function setEnv(values: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) process.env[k] = v;
  }
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "row-1",
    userId: "user-1",
    type: "anthropic",
    baseUrl: null,
    apiKeyCiphertext: "v1:iv:blob",
    defaultModel: null,
    isDefault: true,
    createdAt: new Date(),
    ...overrides,
  };
}

async function freshImport() {
  vi.resetModules();
  return import("@/lib/ai/provider");
}

function mockFetchOk(models: string[] = []) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), {
      status: 200,
    }),
  ) as unknown as typeof fetch;
}

function mockFetchFail() {
  globalThis.fetch = vi.fn(async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  setEnv({});
  m.selectRows = [];
  m.decrypt.mockReset();
  m.createOpenAI.mockClear();
  m.createAnthropic.mockClear();
  m.openaiDefault.mockClear();
  m.assertSendTimeAllowed.mockReset();
  m.assertSendTimeAllowed.mockResolvedValue(undefined);
  m.logError.mockClear();
  m.logWarn.mockClear();
  mockFetchFail();
});

describe("provider resolution — user default precedence (US-304)", () => {
  it("resolves NVIDIA through encrypted custom providers with the requested generation settings", async () => {
    m.selectRows = [makeRow({
      type: "custom",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      defaultModel: "meta/muse-glimmer-30b",
    })];
    m.decrypt.mockReturnValue("nvapi-test-placeholder");
    const mod = await freshImport();
    const provider = await mod.getActiveProviderFor("user-1");
    expect(provider?.modelId).toBe("meta/muse-glimmer-30b");
    expect(provider?.generationSettings).toEqual({ temperature: 1, topP: 0.95, maxTokens: 8192 });
    expect(m.assertSendTimeAllowed).toHaveBeenCalledWith("https://integrate.api.nvidia.com/v1", "custom");
    expect(m.createOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: "nvapi-test-placeholder",
      fetch: expect.any(Function),
    }));
  });

  it("user default row wins over a fully-populated env chain", async () => {
    setEnv({ OPENAI_API_KEY: "sk-env", ANTHROPIC_API_KEY: "sk-ant-env" });
    m.selectRows = [makeRow({ type: "anthropic" })];
    m.decrypt.mockReturnValue("sk-user-key");
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(p).not.toBeNull();
    expect(p!.source).toBe("user");
    expect(p!.id).toBe("row-1");
    expect(p!.type).toBe("anthropic");
    expect(m.createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-user-key" });
    // env openai must NOT be used
    expect(m.openaiDefault).not.toHaveBeenCalled();
  });

  it("no user row → env chain (openai first)", async () => {
    setEnv({ OPENAI_API_KEY: "sk-env", ANTHROPIC_API_KEY: "sk-ant-env" });
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(p!.source).toBe("env");
    expect(p!.id).toBe("env:openai");
    expect(p!.type).toBe("openai");
    expect(p!.modelId).toBe("gpt-4o-mini");
  });

  it("unauthenticated (null userId) → env chain", async () => {
    setEnv({ OPENAI_API_KEY: "sk-env" });
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor(null);
    expect(p!.source).toBe("env");
    expect(p!.id).toBe("env:openai");
  });
});

describe("provider resolution — env chain order (US-305 AC.2/AC.5)", () => {
  it("uses the NVIDIA env key with the configured model and generation settings", async () => {
    setEnv({ NVIDIA_API_KEY: "nvapi-test-placeholder" });
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(p).toMatchObject({
      type: "custom",
      id: "env:nvidia",
      source: "env",
      modelId: "meta/muse-glimmer-30b",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      generationSettings: { temperature: 1, topP: 0.95, maxTokens: 8192 },
    });
    expect(m.createOpenAI).toHaveBeenCalledWith({
      name: "nvidia",
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: "nvapi-test-placeholder",
    });
  });

  it("uses NVIDIA before other environment providers", async () => {
    setEnv({ NVIDIA_API_KEY: "nvapi-test-placeholder", OPENAI_API_KEY: "sk-env" });
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(p?.id).toBe("env:nvidia");
  });

  it("openai beats anthropic when both env keys are set", async () => {
    setEnv({ OPENAI_API_KEY: "sk-env", ANTHROPIC_API_KEY: "sk-ant-env" });
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(p!.type).toBe("openai");
  });

  it("anthropic used when only ANTHROPIC_API_KEY is set", async () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-ant-env" });
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(p!.type).toBe("anthropic");
    expect(p!.id).toBe("env:anthropic");
    expect(p!.modelId).toBe("claude-3-5-haiku-latest");
  });

  it("ollama used when no env keys but server reachable", async () => {
    setEnv({ OLLAMA_BASE_URL: "http://localhost:11434/v1" });
    mockFetchOk(["llama3.2:latest"]);
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(p!.type).toBe("ollama");
    expect(p!.id).toBe("env:ollama");
    expect(p!.modelId).toBe("llama3.2:latest");
  });

  it("null when nothing is configured (caller → 503 NO_PROVIDER)", async () => {
    setEnv({});
    mockFetchFail();
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(p).toBeNull();
  });
});

describe("provider resolution — corrupt user row fallthrough (US-304 AC.4)", () => {
  it("decrypt failure → error log + env fallback, no crash", async () => {
    setEnv({ OPENAI_API_KEY: "sk-env" });
    m.selectRows = [makeRow({ type: "anthropic" })];
    m.decrypt.mockImplementation(() => {
      throw new Error("auth failed");
    });
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(m.logError).toHaveBeenCalled();
    expect(p!.source).toBe("env");
    expect(p!.type).toBe("openai");
  });

  it("keyed row type with no stored ciphertext → env fallback", async () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-ant-env" });
    m.selectRows = [makeRow({ type: "openai", apiKeyCiphertext: null })];
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(p!.source).toBe("env");
    expect(p!.type).toBe("anthropic");
  });

  it("custom row without defaultModel → env fallback", async () => {
    setEnv({ OPENAI_API_KEY: "sk-env" });
    m.selectRows = [
      makeRow({
        type: "custom",
        baseUrl: "https://api.example.com/v1",
        apiKeyCiphertext: null,
        defaultModel: null,
      }),
    ];
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(p!.source).toBe("env");
    expect(p!.type).toBe("openai");
  });
});

describe("provider resolution — per-type client construction (US-304 AC.3)", () => {
  it("openai row → createOpenAI({ apiKey: decrypted })", async () => {
    m.selectRows = [
      makeRow({
        type: "openai",
        defaultModel: "gpt-4o",
      }),
    ];
    m.decrypt.mockReturnValue("sk-user");
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(m.createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-user" });
    expect(p!.modelId).toBe("gpt-4o");
    expect((p!.model as { factory: string }).factory).toBe("createOpenAI");
  });

  it("anthropic row → createAnthropic({ apiKey: decrypted })", async () => {
    m.selectRows = [makeRow({ type: "anthropic" })];
    m.decrypt.mockReturnValue("sk-ant-user");
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(m.createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-user" });
    expect(p!.modelId).toBe("claude-3-5-haiku-latest");
  });

  it("ollama row → openai-compatible client at row baseUrl", async () => {
    process.env.ADMIN_ALLOW_OLLAMA_USERS = "true";
    m.selectRows = [
      makeRow({
        type: "ollama",
        baseUrl: "http://localhost:11434/v1",
        apiKeyCiphertext: null,
      }),
    ];
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(m.createOpenAI).toHaveBeenCalledWith({
      name: "ollama",
      baseURL: "http://localhost:11434/v1",
      apiKey: "not-needed",
      fetch: expect.any(Function),
    });
    expect(p!.baseUrl).toBe("http://localhost:11434/v1");
    expect(p!.modelId).toBe("llama3.2");
    delete process.env.ADMIN_ALLOW_OLLAMA_USERS;
  });

  it("custom row → openai-compatible client, keyless allowed", async () => {
    m.selectRows = [
      makeRow({
        type: "custom",
        baseUrl: "https://api.example.com/v1",
        apiKeyCiphertext: null,
        defaultModel: "my-model",
      }),
    ];
    const mod = await freshImport();
    const p = await mod.getActiveProviderFor("user-1");
    expect(m.createOpenAI).toHaveBeenCalledWith({
      name: "custom",
      baseURL: "https://api.example.com/v1",
      apiKey: "not-needed",
      fetch: expect.any(Function),
    });
    expect(p!.modelId).toBe("my-model");
  });
});

describe("provider resolution — send-time SSRF re-validation", () => {
  it("propagates the block for ollama/custom rows (caller → 502)", async () => {
    m.selectRows = [
      makeRow({
        type: "custom",
        baseUrl: "http://rebind.example.com/v1",
        defaultModel: "m",
      }),
    ];
    m.assertSendTimeAllowed.mockRejectedValue(
      new m.SsrfBlockedError("baseUrl must not point to a private address"),
    );
    const mod = await freshImport();
    await expect(mod.getActiveProviderFor("user-1")).rejects.toThrow(
      m.SsrfBlockedError,
    );
    expect(m.assertSendTimeAllowed).toHaveBeenCalledWith(
      "http://rebind.example.com/v1",
      "custom",
    );
  });

  it("does not run for openai/anthropic rows", async () => {
    m.selectRows = [makeRow({ type: "anthropic" })];
    m.decrypt.mockReturnValue("k");
    const mod = await freshImport();
    await mod.getActiveProviderFor("user-1");
    expect(m.assertSendTimeAllowed).not.toHaveBeenCalled();
  });
});

describe("provider resolution — env-only wrapper (backward compat)", () => {
  it("getActiveProvider resolves the env chain only", async () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-ant-env" });
    const mod = await freshImport();
    const p = await mod.getActiveProvider();
    expect(p!.source).toBe("env");
    expect(p!.type).toBe("anthropic");
  });
});
