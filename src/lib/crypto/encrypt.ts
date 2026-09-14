import "server-only";
import crypto from "node:crypto";

const HKDF_SALT = "subchats-providers-v1";
const HKDF_INFO = "providers:apikey";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const FORMAT_PREFIX = "v1";

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

function loadEnvKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length === 0) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new CryptoError(
      "ENCRYPTION_KEY must decode to exactly 32 bytes (base64)",
    );
  }
  return key;
}

function deriveKeyFromAuthSecret(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length === 0) {
    throw new CryptoError(
      "No encryption key material: set ENCRYPTION_KEY or AUTH_SECRET",
    );
  }
  const derived = crypto.hkdfSync(
    "sha256",
    secret,
    HKDF_SALT,
    HKDF_INFO,
    32,
  );
  return Buffer.from(derived);
}

function getKey(): Buffer {
  const envKey = loadEnvKey();
  return envKey ?? deriveKeyFromAuthSecret();
}

/**
 * Encrypt to `v1:<iv-b64>:<ciphertext-b64>` where ciphertext-b64 is the GCM
 * ciphertext with the 16-byte auth tag appended (spec phase-3 §7).
 * Throws CryptoError when no key material is configured — callers must not
 * fall back to storing plaintext (US-302 AC.5).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([ciphertext, tag]);
  return `${FORMAT_PREFIX}:${iv.toString("base64")}:${blob.toString("base64")}`;
}

/**
 * Decrypt a `v1:<iv-b64>:<ciphertext-b64>` blob. Any tamper, wrong key, or
 * malformed input throws CryptoError — never returns partial plaintext.
 */
export function decrypt(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== FORMAT_PREFIX) {
    throw new CryptoError("Unrecognized ciphertext format");
  }
  let iv: Buffer;
  let blob: Buffer;
  try {
    iv = Buffer.from(parts[1]!, "base64");
    blob = Buffer.from(parts[2]!, "base64");
  } catch {
    throw new CryptoError("Ciphertext is not valid base64");
  }
  if (iv.length !== IV_LENGTH) {
    throw new CryptoError("Invalid IV length");
  }
  if (blob.length <= TAG_LENGTH) {
    throw new CryptoError("Ciphertext too short to contain an auth tag");
  }
  const tag = blob.subarray(blob.length - TAG_LENGTH);
  const ciphertext = blob.subarray(0, blob.length - TAG_LENGTH);
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CryptoError(
      "Ciphertext authentication failed (tampered or wrong key)",
    );
  }
}
