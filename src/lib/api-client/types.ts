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
  childrenCount: number;
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

export interface TreeNodeDto {
  sourceMessageId?: string | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
  id: string;
  title: string;
  depth: number;
  highlightText: string | null;
  createdAt: string;
  children: TreeNodeDto[];
}

export interface TreeResponse {
  root: TreeNodeDto;
  currentId: string;
  totalNodes: number;
  truncated: boolean;
}

export type ProviderType = "openai" | "anthropic" | "ollama" | "custom" | null;

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

export type ProviderTypeDto = "openai" | "anthropic" | "ollama" | "custom";

export interface ProviderDto {
  id: string;
  type: ProviderTypeDto;
  baseUrl: string | null;
  defaultModel: string | null;
  isDefault: boolean;
  apiKeyHint: string | null;
  createdAt: string;
}

export interface ProvidersResponse {
  items: ProviderDto[];
}

export interface ProviderCreateBody {
  type: ProviderTypeDto;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  isDefault?: boolean;
}

export interface ProviderUpdateBody {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  isDefault?: boolean;
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
