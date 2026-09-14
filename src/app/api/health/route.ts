import { auth } from "@/lib/auth";
import { jsonRaw } from "@/lib/types/api";
import { getActiveProviderFor, isOllamaReachable } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const provider = await getActiveProviderFor(session?.user?.id ?? null);
  const ollamaReachable = await isOllamaReachable();

  return jsonRaw(
    {
      status: "ok",
      provider: provider
        ? {
            type: provider.type,
            model: provider.modelId,
            baseUrl: provider.baseUrl ?? null,
            source: provider.source,
          }
        : { type: null, model: null, baseUrl: null, source: null },
      ollamaReachable,
    },
    200,
  );
}
