import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEYS = ["ENCRYPTION_KEY", "AUTH_SECRET"];
const savedEnv: Record<string, string | undefined> = {};

const TEST_KEY_B64 = Buffer.from(
  "0123456789abcdef0123456789abcdef",
  "utf8",
).toString("base64");
const OTHER_KEY_B64 = Buffer.from(
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "utf8",
).toString("base64");

async function freshImport() {
  vi.resetModules();
  return import("@/lib/crypto/encrypt");
}

describe("encryption (AES-256-GCM, spec §7)", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("round-trips plaintext via ENCRYPTION_KEY", async () => {
    process.env.ENCRYPTION_KEY = TEST_KEY_B64;
    const { encrypt, decrypt } = await freshImport();
    const stored = encrypt("sk-ant-secret-value");
    expect(stored).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(decrypt(stored)).toBe("sk-ant-secret-value");
  });

  it("round-trips plaintext via HKDF-derived key from AUTH_SECRET", async () => {
    process.env.AUTH_SECRET = "dev-auth-secret-not-for-prod";
    const { encrypt, decrypt } = await freshImport();
    const stored = encrypt("round-trip-甲");
    expect(decrypt(stored)).toBe("round-trip-甲");
  });

  it("HKDF derivation is deterministic: same secret → same key", async () => {
    process.env.AUTH_SECRET = "same-secret";
    const first = await freshImport();
    const stored = first.encrypt("determinism-check");
    // fresh module instance re-derives the key from the same secret
    const second = await freshImport();
    expect(second.decrypt(stored)).toBe("determinism-check");
  });

  it("different AUTH_SECRET → different derived key → decrypt throws", async () => {
    process.env.AUTH_SECRET = "secret-A";
    const first = await freshImport();
    const stored = first.encrypt("keyed-data");
    process.env.AUTH_SECRET = "secret-B";
    const second = await freshImport();
    expect(() => second.decrypt(stored)).toThrow();
  });

  it("uses a fresh random IV per encryption", async () => {
    process.env.ENCRYPTION_KEY = TEST_KEY_B64;
    const { encrypt } = await freshImport();
    const a = encrypt("same plaintext").split(":")[1];
    const b = encrypt("same plaintext").split(":")[1];
    expect(a).not.toBe(b);
  });

  it("rejects a flipped ciphertext byte (tamper)", async () => {
    process.env.ENCRYPTION_KEY = TEST_KEY_B64;
    const { encrypt, decrypt, CryptoError } = await freshImport();
    const stored = encrypt("tamper-target");
    const [, ivB64, blobB64] = stored.split(":");
    const blob = Buffer.from(blobB64!, "base64");
    blob[0] = blob[0]! ^ 0xff;
    const tampered = `v1:${ivB64}:${blob.toString("base64")}`;
    expect(() => decrypt(tampered)).toThrow(CryptoError);
  });

  it("rejects a wrong key", async () => {
    process.env.ENCRYPTION_KEY = TEST_KEY_B64;
    const { encrypt } = await freshImport();
    const stored = encrypt("wrong-key-target");
    process.env.ENCRYPTION_KEY = OTHER_KEY_B64;
    const { decrypt, CryptoError } = await freshImport();
    expect(() => decrypt(stored)).toThrow(CryptoError);
  });

  it("rejects malformed stored formats", async () => {
    process.env.ENCRYPTION_KEY = TEST_KEY_B64;
    const { decrypt, CryptoError } = await freshImport();
    for (const bad of ["", "v1", "v1:x", "v2:a:b", "plain", "v1:!!!:???"]) {
      expect(() => decrypt(bad)).toThrow(CryptoError);
    }
  });

  it("rejects a non-32-byte ENCRYPTION_KEY instead of degrading", async () => {
    process.env.ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    const { encrypt, CryptoError } = await freshImport();
    expect(() => encrypt("x")).toThrow(CryptoError);
  });

  it("throws when no key material exists (never plaintext fallback)", async () => {
    const { encrypt, decrypt, CryptoError } = await freshImport();
    expect(() => encrypt("no-key")).toThrow(CryptoError);
    expect(() => decrypt("v1:a:b")).toThrow(CryptoError);
  });
});
