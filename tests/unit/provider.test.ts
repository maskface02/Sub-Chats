import { describe, it, expect, beforeEach, vi } from "vitest";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OLLAMA_BASE_URL",
  "ANTHROPIC_API_KEY",
  "NODE_ENV",
];

function setEnv(values: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) process.env[k] = v;
  }
}

function mockFetchOk() {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ models: [] }), { status: 200 }),
  ) as unknown as typeof fetch;
}

function mockFetchFail() {
  globalThis.fetch = vi.fn(async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
}

async function freshImport() {
  vi.resetModules();
  return import("@/lib/ai/provider");
}

describe("ai/provider resolution", () => {
  beforeEach(() => {
    setEnv({});
  });

  it("returns null when no provider is configured", async () => {
    setEnv({});
    mockFetchFail();
    const mod = await freshImport();
    const p = await mod.getActiveProvider();
    expect(p).toBeNull();
    expect(mod.noProvider().code).toBe("NO_PROVIDER");
  });

  it("resolves openai when OPENAI_API_KEY is set", async () => {
    setEnv({ OPENAI_API_KEY: "sk-test" });
    mockFetchFail();
    const mod = await freshImport();
    const p = await mod.getActiveProvider();
    expect(p).not.toBeNull();
    expect(p!.type).toBe("openai");
    expect(p!.modelId).toBe("gpt-4o-mini");
    expect(p!.id).toBe("openai");
  });

  it("resolves ollama when OPENAI_API_KEY is absent and ollama reachable", async () => {
    setEnv({ OLLAMA_BASE_URL: "http://localhost:11434/v1" });
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ models: [{ name: "llama3.2:latest" }] }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const mod = await freshImport();
    const p = await mod.getActiveProvider();
    expect(p).not.toBeNull();
    expect(p!.type).toBe("ollama");
    expect(p!.modelId).toBe("llama3.2:latest");
    expect(p!.id).toBe("ollama:llama3.2:latest");
    expect(p!.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("falls back to llama3.2 default when ollama returns empty model list", async () => {
    setEnv({ OLLAMA_BASE_URL: "http://localhost:11434/v1" });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const mod = await freshImport();
    const p = await mod.getActiveProvider();
    expect(p).not.toBeNull();
    expect(p!.type).toBe("ollama");
    expect(p!.modelId).toBe("llama3.2");
  });

  it("prefers openai over ollama when both are available", async () => {
    setEnv({
      OPENAI_API_KEY: "sk-test",
      OLLAMA_BASE_URL: "http://localhost:11434/v1",
    });
    mockFetchOk();
    const mod = await freshImport();
    const p = await mod.getActiveProvider();
    expect(p!.type).toBe("openai");
  });
});

describe("ollama reachability check", () => {
  beforeEach(() => setEnv({}));

  it("returns false when fetch throws", async () => {
    setEnv({});
    mockFetchFail();
    const mod = await freshImport();
    const reachable = await mod.isOllamaReachable();
    expect(reachable).toBe(false);
  });

  it("returns true when /api/tags returns 2xx", async () => {
    setEnv({ OLLAMA_BASE_URL: "http://localhost:11434/v1" });
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const mod = await freshImport();
    const reachable = await mod.isOllamaReachable();
    expect(reachable).toBe(true);
  });
});