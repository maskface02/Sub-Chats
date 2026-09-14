import { apiFetch, ApiError } from "./base";
import type {
  ApiErrorBody,
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

export interface DeleteChatResponse {
  deletedIds: string[];
  deletedCount: number;
}

export interface RestoreChatResponse {
  restoredCount: number;
}

export type ExportFormat = "md" | "json";

export interface ExportResult {
  blob: Blob;
  filename: string;
}

/** Soft-deletes the conversation and its subtree (US-401). */
export async function deleteChat(id: string): Promise<DeleteChatResponse> {
  return apiFetch<DeleteChatResponse>(`/api/chats/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Reverses one delete batch (US-401 AC.7). */
export async function restoreChat(id: string): Promise<RestoreChatResponse> {
  return apiFetch<RestoreChatResponse>(`/api/chats/${encodeURIComponent(id)}`, {
    method: "POST",
    body: {},
  });
}

/**
 * Fetches an export file as a blob (US-403 AC.6) so the caller can trigger a
 * download without navigating away. The filename comes from the server's
 * Content-Disposition header.
 */
export async function exportChat(
  id: string,
  format: ExportFormat,
): Promise<ExportResult> {
  const res = await fetch(
    `/api/chats/${encodeURIComponent(id)}/export?format=${encodeURIComponent(format)}`,
  );
  if (!res.ok) {
    let code = "HTTP_ERROR";
    let message = res.statusText;
    try {
      const body = (await res.json()) as ApiErrorBody | null;
      if (body && typeof body === "object" && "error" in body) {
        code = body.error.code;
        message = body.error.message ?? message;
      }
    } catch {
      // non-JSON error body — fall through with status defaults
    }
    throw new ApiError(res.status, { error: { code, message } });
  }
  const blob = await res.blob();
  return {
    blob,
    filename:
      parseContentDispositionFilename(
        res.headers.get("content-disposition"),
      ) ?? `conversation.${format}`,
  };
}

function parseContentDispositionFilename(
  disposition: string | null,
): string | null {
  if (!disposition) return null;
  const ext = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (ext) {
    try {
      return decodeURIComponent(ext[1]!.trim());
    } catch {
      return ext[1]!.trim();
    }
  }
  const plain = /filename="?([^";]+)"?/.exec(disposition);
  return plain ? plain[1]!.trim() : null;
}
