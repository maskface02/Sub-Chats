import { describe, it, expect, beforeEach, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
  default: { lookup: lookupMock },
}));

import {
  validateProviderBaseUrl,
  assertSendTimeAllowed,
  SsrfBlockedError,
} from "@/lib/ai/ssrf-guard";

function resolvesTo(addresses: Array<{ address: string; family: number }>) {
  lookupMock.mockImplementation(
    async (
      _hostname: string,
      _options: { all: boolean },
    ): Promise<Array<{ address: string; family: number }>> => addresses,
  );
}

describe("ssrf-guard — validateProviderBaseUrl (AC-P3-12)", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("rejects a custom baseUrl resolving to a private IPv4", async () => {
    resolvesTo([{ address: "10.1.2.3", family: 4 }]);
    const result = await validateProviderBaseUrl(
      "http://internal.example.com/v1",
      "custom",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(
        "baseUrl must not point to a private address",
      );
    }
  });

  it("rejects loopback, link-local, 172.16/12 and 192.168/16 for custom", async () => {
    for (const ip of ["127.0.0.1", "169.254.1.1", "172.16.0.9", "192.168.5.5"]) {
      resolvesTo([{ address: ip, family: 4 }]);
      const result = await validateProviderBaseUrl("http://x.example.com", "custom");
      expect(result.ok).toBe(false);
    }
  });

  it("rejects IPv6 loopback and ULA/link-local for custom", async () => {
    for (const ip of ["::1", "fc00::1", "fe80::1"]) {
      resolvesTo([{ address: ip, family: 6 }]);
      const result = await validateProviderBaseUrl("http://x.example.com", "custom");
      expect(result.ok).toBe(false);
    }
  });

  it("rejects an IP-literal private custom baseUrl without a DNS call", async () => {
    const result = await validateProviderBaseUrl("http://192.168.1.50:8080", "custom");
    expect(result.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("accepts a public custom baseUrl", async () => {
    resolvesTo([{ address: "93.184.216.34", family: 4 }]);
    const result = await validateProviderBaseUrl(
      "https://api.example.com/v1",
      "custom",
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects custom when dns.lookup fails", async () => {
    lookupMock.mockImplementation(async () => {
      throw new Error("NXDOMAIN");
    });
    const result = await validateProviderBaseUrl("http://nope.example.com", "custom");
    expect(result.ok).toBe(false);
  });

  it("rejects custom when every resolved address is checked (all records)", async () => {
    resolvesTo([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    const result = await validateProviderBaseUrl("http://mixed.example.com", "custom");
    expect(result.ok).toBe(false);
  });

  it("accepts ollama-localhost (exempt from private denylist)", async () => {
    const result = await validateProviderBaseUrl(
      "http://localhost:11434/v1",
      "ollama",
    );
    expect(result).toEqual({ ok: true });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("accepts ollama pointing at a private-range host (documented accept-risk)", async () => {
    const result = await validateProviderBaseUrl(
      "http://192.168.1.10:11434/v1",
      "ollama",
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects non-http(s) schemes", async () => {
    for (const url of [
      "ftp://example.com/file",
      "file:///etc/passwd",
      "gopher://example.com",
    ]) {
      const custom = await validateProviderBaseUrl(url, "custom");
      expect(custom.ok).toBe(false);
      const ollama = await validateProviderBaseUrl(url, "ollama");
      expect(ollama.ok).toBe(false);
    }
  });

  it("rejects malformed URLs", async () => {
    for (const url of ["not a url", "http://", "://missing"]) {
      const result = await validateProviderBaseUrl(url, "custom");
      expect(result.ok).toBe(false);
    }
  });
});

describe("ssrf-guard — assertSendTimeAllowed (send-time re-validation)", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("resolves for an allowed URL", async () => {
    resolvesTo([{ address: "93.184.216.34", family: 4 }]);
    await expect(
      assertSendTimeAllowed("https://api.example.com/v1", "custom"),
    ).resolves.toBeUndefined();
  });

  it("throws SsrfBlockedError when the host now resolves private (rebinding)", async () => {
    resolvesTo([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      assertSendTimeAllowed("http://rebind.example.com/v1", "custom"),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("passes ollama through without DNS", async () => {
    await expect(
      assertSendTimeAllowed("http://localhost:11434/v1", "ollama"),
    ).resolves.toBeUndefined();
    expect(lookupMock).not.toHaveBeenCalled();
  });
});
