import "server-only";
import { decrypt } from "@/lib/crypto/encrypt";
import { log } from "@/lib/log";
import type { ProviderDto } from "@/lib/types/api";
import type { ProviderRow } from "@/lib/db/schema";

/**
 * Map a provider row to its API DTO. The hint is computed server-side by
 * decrypting (US-302 AC.3): only "…" + last 4 chars of plaintext ever leaves
 * the server. Decrypt failure → hint null + warn log; the row is still
 * listed and the endpoint does not 500.
 */
export function toProviderDto(row: ProviderRow): ProviderDto {
  let apiKeyHint: string | null = null;
  if (row.apiKeyCiphertext) {
    try {
      apiKeyHint = "…" + decrypt(row.apiKeyCiphertext).slice(-4);
    } catch (err) {
      log.warn(
        { err, providerId: row.id, userId: row.userId },
        "provider key decrypt failed; apiKeyHint set to null",
      );
    }
  }
  return {
    id: row.id,
    type: row.type,
    baseUrl: row.baseUrl ?? null,
    defaultModel: row.defaultModel ?? null,
    isDefault: row.isDefault,
    apiKeyHint,
    createdAt: row.createdAt.toISOString(),
  };
}
