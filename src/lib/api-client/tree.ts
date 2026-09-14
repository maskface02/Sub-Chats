import { apiFetch } from "./base";
import type { TreeResponse } from "./types";

export async function getConversationTree(id: string): Promise<TreeResponse> {
  return apiFetch<TreeResponse>(
    `/api/chats/${encodeURIComponent(id)}/tree`,
  );
}
