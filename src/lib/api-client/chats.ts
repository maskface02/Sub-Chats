import { apiFetch } from "./base";
import type {
  ChatListResponse,
  Conversation,
  CreateChatResponse,
  HealthResponse,
  ProviderInfo,
} from "./types";

export async function listChats(
  cursor?: string,
  opts?: { limit?: number },
): Promise<ChatListResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return apiFetch<ChatListResponse>(`/api/chats${qs ? `?${qs}` : ""}`, {
    next: { tags: ["chats"] },
  });
}

export async function getChat(id: string): Promise<Conversation> {
  return apiFetch<Conversation>(`/api/chats/${encodeURIComponent(id)}`, {
    next: { tags: [`chat:${id}`, "chats"] },
  });
}

export async function createChat(): Promise<CreateChatResponse> {
  return apiFetch<CreateChatResponse>(`/api/chats`, {
    method: "POST",
    body: {},
  });
}

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>(`/api/health`, {
    next: { revalidate: 30, tags: ["health"] },
  });
}

export async function getProviderInfo(): Promise<ProviderInfo> {
  const h = await getHealth();
  return h.provider;
}
