import "server-only";
import { getActiveProvider } from "@/lib/ai/provider";
import { listProviders } from "./providers";
import type { ProviderInfo } from "./types";
export async function getWorkspaceProvider(): Promise<ProviderInfo> {
  const custom = await listProviders().catch(() => null);
  const selected = custom?.items.find((provider) => provider.isDefault);
  if (selected)
    return {
      type: selected.type,
      model: selected.defaultModel,
      baseUrl: selected.baseUrl,
    };
  return getActiveProvider()
    .then((provider) => ({
      type: provider?.type ?? null,
      model: provider?.modelId ?? null,
      baseUrl: provider?.baseUrl ?? null,
    }))
    .catch(() => ({ type: null, model: null, baseUrl: null }));
}
