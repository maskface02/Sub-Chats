import "server-only";
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import { log } from "@/lib/log";

export type ProviderType = "openai" | "ollama";

export type Provider = {
  type: ProviderType;
  id: string;
  modelId: string;
  model: LanguageModelV1;
  baseUrl?: string;
};

const OLLAMA_TIMEOUT_MS = 2000;
const DEFAULT_OLLAMA_MODEL = "llama3.2";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

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

async function resolveProvider(): Promise<Provider | null> {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 0) {
    const modelId = "gpt-4o-mini";
    const provider: Provider = {
      type: "openai",
      id: "openai",
      modelId,
      model: openai(modelId),
    };
    log.info(
      { provider: "openai", model: modelId },
      "AI provider resolved",
    );
    return provider;
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
    const provider: Provider = {
      type: "ollama",
      id: `ollama:${modelId}`,
      modelId,
      baseUrl,
      model: ollama(modelId),
    };
    log.info(
      { provider: "ollama", model: modelId, baseUrl },
      "AI provider resolved",
    );
    return provider;
  }

  log.warn(
    { hasOpenAI: Boolean(process.env.OPENAI_API_KEY), baseUrl },
    "no AI provider available",
  );
  return null;
}

const providerPromise: Promise<Provider | null> = resolveProvider();

export function getActiveProvider(): Promise<Provider | null> {
  return providerPromise;
}

export function noProvider(): { code: "NO_PROVIDER"; message: string } {
  return {
    code: "NO_PROVIDER",
    message:
      "No AI provider configured. Set OPENAI_API_KEY or run Ollama locally.",
  };
}

export async function isOllamaReachable(): Promise<boolean> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  return ollamaReachable(baseUrl);
}