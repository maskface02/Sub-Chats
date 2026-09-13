import { jsonRaw } from "@/lib/types/api";
import { getActiveProvider, isOllamaReachable } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const provider = await getActiveProvider();
  const ollamaReachable = await isOllamaReachable();

  return jsonRaw(
    {
      status: "ok",
      provider: provider
        ? {
            type: provider.type,
            model: provider.modelId,
            baseUrl: provider.baseUrl ?? null,
          }
        : { type: null, model: null, baseUrl: null },
      ollamaReachable,
    },
    200,
  );
}