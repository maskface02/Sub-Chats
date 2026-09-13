export type Role = "user" | "assistant" | "system";

export interface User {
  id: string;
  email: string;
  name: string | null;
  image?: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image?: string | null;
}

export interface ChatListItem {
  id: string;
  title: string;
  updatedAt: string;
  preview: string | null;
}

export interface ChatListResponse {
  items: ChatListItem[];
  nextCursor: string | null;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  model?: string | null;
  providerId?: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  parentId: string | null;
  rootConversationId: string;
  depth: number;
  highlightText: string | null;
  highlightContext: string | null;
  parentTitle?: string | null;
  rootTitle?: string | null;
  parentMessageContent?: string | null;
  parentMessageId?: string | null;
  ancestorTitles?: Array<{ id: string; title: string | null; depth: number }>;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface BranchResponse {
  id: string;
  parentId: string;
  rootConversationId: string;
  depth: number;
  highlightText: string;
  highlightContext: string | null;
  title: string;
  createdAt: string;
}

export interface CreateChatResponse {
  id: string;
  title: string;
  parentId: string | null;
  rootConversationId: string;
  depth: number;
  createdAt: string;
}

export type ProviderType = "openai" | "ollama" | null;

export interface ProviderInfo {
  type: ProviderType;
  model: string | null;
  baseUrl?: string | null;
}

export interface HealthResponse {
  status: "ok";
  provider: ProviderInfo;
  ollamaReachable: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message?: string;
    fields?: Record<string, string>;
  };
}

export type AuthActionResult =
  | { ok: true }
  | {
      ok: false;
      formError?: string;
      fieldErrors?: Partial<Record<"email" | "password" | "confirmPassword" | "name", string>>;
    };
