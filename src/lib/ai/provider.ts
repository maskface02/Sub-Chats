import "server-only";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { and, eq } from "drizzle-orm";
import type { LanguageModelV1 } from "ai";
import { db } from "@/lib/db";
import { providers } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto/encrypt";
import { assertSendTimeAllowed, SsrfBlockedError, ssrfSafeFetch } from "./ssrf-guard";
import { log } from "@/lib/log";

export type ProviderType = "openai" | "anthropic" | "ollama" | "custom";
export type ProviderSource = "user" | "env";

export type Provider = {
  type: ProviderType;
  /** provider row id (user-resolved) or `env:*` sentinel (US-304 AC.6) */
  id: string;
  modelId: string;
  model: LanguageModelV1;
  baseUrl?: string;
  source: ProviderSource;
};

export { SsrfBlockedError };

const OLLAMA_TIMEOUT_MS = 2000;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-haiku-latest";
const DEFAULT_OLLAMA_MODEL = "llama3.2";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

const TYPE_DEFAULT_MODEL: Partial<Record<ProviderType, string>> = {
  openai: DEFAULT_OPENAI_MODEL,
  anthropic: DEFAULT_ANTHROPIC_MODEL,
  ollama: DEFAULT_OLLAMA_MODEL,
  // custom requires an explicit defaultModel on the row (US-301 AC.12)
};

async function ollamaReachable(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: controller.signal,
      method: "GET",
    });
    return res.ok;
  } catch (err) {
    log.debug({ err, baseUrl }, "ollama unreachable");
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function listOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

async function resolveFromEnv(): Promise<Provider | null> {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 0) {
    const modelId = DEFAULT_OPENAI_MODEL;
    log.info({ provider: "openai", model: modelId, source: "env" }, "AI provider resolved");
    return {
      type: "openai",
      id: "env:openai",
      modelId,
      model: openai(modelId),
      source: "env",
    };
  }

  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 0) {
    const modelId = DEFAULT_ANTHROPIC_MODEL;
    log.info({ provider: "anthropic", model: modelId, source: "env" }, "AI provider resolved");
    return {
      type: "anthropic",
      id: "env:anthropic",
      modelId,
      model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId),
      source: "env",
    };
  }

  const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  if (await ollamaReachable(baseUrl)) {
    const models = await listOllamaModels(baseUrl);
    const modelId = models[0] ?? DEFAULT_OLLAMA_MODEL;
    const ollama = createOpenAI({
      name: "ollama",
      baseURL: baseUrl,
      apiKey: "ollama",
    });
    log.info({ provider: "ollama", model: modelId, baseUrl, source: "env" }, "AI provider resolved");
    return {
      type: "ollama",
      id: "env:ollama",
      modelId,
      baseUrl,
      model: ollama(modelId),
      source: "env",
    };
  }

  log.warn(
    {
      hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
      hasAnthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      baseUrl,
    },
    "no AI provider available",
  );
  return null;
}

type ProviderRowLike = {
  id: string;
  type: ProviderType;
  baseUrl: string | null;
  apiKeyCiphertext: string | null;
  defaultModel: string | null;
};

function buildFromRow(row: ProviderRowLike, key: string | null): Provider {
  const modelId = row.defaultModel ?? TYPE_DEFAULT_MODEL[row.type];
  if (!modelId) {
    throw new Error(`provider row ${row.id} (custom) has no defaultModel`);
  }
  if (row.type === "openai") {
    if (!key) throw new Error(`provider row ${row.id} (openai) has no stored key`);
    return {
      type: row.type,
      id: row.id,
      modelId,
      model: createOpenAI({ apiKey: key })(modelId),
      source: "user",
    };
  }
  if (row.type === "anthropic") {
    if (!key) throw new Error(`provider row ${row.id} (anthropic) has no stored key`);
    return {
      type: row.type,
      id: row.id,
      modelId,
      model: createAnthropic({ apiKey: key })(modelId),
      source: "user",
    };
  }
  // ollama / custom → openai-compatible client at the row's baseUrl,
  // using the SSRF-safe fetch (validates every redirect hop — Security
  // phase-3 hardening #1)
  if (!row.baseUrl) {
    throw new Error(`provider row ${row.id} (${row.type}) has no baseUrl`);
  }
  return {
    type: row.type,
    id: row.id,
    modelId,
    baseUrl: row.baseUrl,
    model: createOpenAI({
      name: row.type,
      baseURL: row.baseUrl,
      apiKey: key ?? "not-needed",
      fetch: ssrfSafeFetch(row.type),
    })(modelId),
    source: "user",
  };
}

/**
 * Per-request provider resolution (US-304). Order:
 * 1. the user's isDefault provider row (single indexed query)
 * 2. env chain: OPENAI_API_KEY → ANTHROPIC_API_KEY → reachable OLLAMA_BASE_URL → null
 *
 * Corrupt user-row state (decrypt failure, missing key/baseUrl/model) logs at
 * error level and falls through to the env chain (US-304 AC.4).
 * Throws SsrfBlockedError when a user ollama/custom row fails send-time
 * re-validation — callers map that to 502 PROVIDER_FAILED (no silent env
 * failover, US-304 out-of-scope note).
 */
export async function getActiveProviderFor(
  userId: string | null,
): Promise<Provider | null> {
  if (!userId) return resolveFromEnv();

  const rows = await db
    .select()
    .from(providers)
    .where(and(eq(providers.userId, userId), eq(providers.isDefault, true)))
    .limit(1);
  const row = rows[0] as ProviderRowLike | undefined;
  if (!row) return resolveFromEnv();

  try {
    if (row.type === "ollama" || row.type === "custom") {
      // send-time SSRF re-validation (DNS rebinding mitigation, US-301 AC.3b)
      if (!row.baseUrl) {
        throw new Error(`provider row ${row.id} (${row.type}) has no baseUrl`);
      }
      await assertSendTimeAllowed(row.baseUrl, row.type);
    }
    const key = row.apiKeyCiphertext ? decrypt(row.apiKeyCiphertext) : null;
    return buildFromRow(row, key);
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err;
    log.error(
      { err, userId, providerId: row.id, providerType: row.type },
      "user default provider failed to build; falling back to env chain",
    );
    return resolveFromEnv();
  }
}

/**
 * Env-chain-only resolution (backward compat; used by health when
 * unauthenticated). Per-request code should use getActiveProviderFor.
 */
export async function getActiveProvider(): Promise<Provider | null> {
  return resolveFromEnv();
}

export function noProvider(): { code: "NO_PROVIDER"; message: string } {
  return {
    code: "NO_PROVIDER",
    message:
      "No AI provider configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or run Ollama locally.",
  };
}

export async function isOllamaReachable(): Promise<boolean> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  return ollamaReachable(baseUrl);
}
