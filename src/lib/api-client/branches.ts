import { apiFetch } from "./base";
import type { BranchResponse } from "./types";

export interface CreateBranchPayload {
  messageId: string;
  selectedText: string;
  charStart: number;
  charEnd: number;
  clientHighlightContext?: string;
}

export async function createBranch(
  sourceConversationId: string,
  payload: CreateBranchPayload,
): Promise<BranchResponse> {
  return apiFetch<BranchResponse>(
    `/api/chats/${encodeURIComponent(sourceConversationId)}/branch`,
    {
      method: "POST",
      body: {
        messageId: payload.messageId,
        selectedText: payload.selectedText,
        charStart: payload.charStart,
        charEnd: payload.charEnd,
        ...(payload.clientHighlightContext !== undefined
          ? { clientHighlightContext: payload.clientHighlightContext }
          : {}),
      },
    },
  );
}
