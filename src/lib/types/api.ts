import { z } from "zod";

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "EMAIL_TAKEN",
  "INVALID_INPUT",
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "NOT_FOUND",
  "NO_PROVIDER",
  "PROVIDER_FAILED",
  "INVALID_SELECTION",
  "ANCESTOR_UNAVAILABLE",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiError = {
  error: {
    code: ErrorCode;
    message?: string;
    fields?: Record<string, string>;
  };
};

export type ApiOk<T> = { data: T };

export const ApiErrorSchema: z.ZodType<ApiError> = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string().optional(),
    fields: z.record(z.string()).optional(),
  }),
});

// ---------- auth ----------

export const SignUpRequestSchema = z.object({
  email: z.string().email("Enter a valid email").max(254),
  password: z
    .string()
    .min(8, "Use at least 8 characters")
    .max(256),
  name: z.string().min(1).max(64).optional(),
});

export type SignUpRequest = z.infer<typeof SignUpRequestSchema>;

export type SignUpResponse = {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
};

export const SignInRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  callbackUrl: z.string().optional(),
});

export type SignInRequest = z.infer<typeof SignInRequestSchema>;

export type SignInResponse = { ok: true };

export const SignOutResponseSchema = z.object({ ok: z.literal(true) });
export type SignOutResponse = z.infer<typeof SignOutResponseSchema>;

// ---------- chats ----------

export const ChatListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  preview: z.string().nullable(),
});

export type ChatListItem = z.infer<typeof ChatListItemSchema>;

export const ChatListQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ChatListQuery = z.infer<typeof ChatListQuerySchema>;

export const ChatListResponseSchema = z.object({
  items: z.array(ChatListItemSchema),
  nextCursor: z.string().nullable(),
});

export type ChatListResponse = z.infer<typeof ChatListResponseSchema>;

export const CreateChatResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  parentId: z.string().nullable(),
  rootConversationId: z.string(),
  depth: z.number().int().min(0),
  createdAt: z.string(),
});

export type CreateChatResponse = z.infer<typeof CreateChatResponseSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  model: z.string().nullable().optional(),
  providerId: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type ApiMessage = z.infer<typeof MessageSchema>;

export const ChatWithMessagesResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  parentId: z.string().nullable(),
  rootConversationId: z.string(),
  depth: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(MessageSchema),
});

export type ChatWithMessagesResponse = z.infer<
  typeof ChatWithMessagesResponseSchema
>;

// ---------- branch (sub-chat) ----------

export const BranchRequestSchema = z
  .object({
    messageId: z.string().min(1, "messageId is required"),
    selectedText: z.string().min(1).max(2000),
    charStart: z.number().int().min(0),
    charEnd: z.number().int().min(1),
    clientHighlightContext: z.string().max(500).optional(),
  })
  .strict()
  .refine((d) => d.charStart < d.charEnd, {
    message: "charEnd must be greater than charStart",
    path: ["charEnd"],
  });

export type BranchRequest = z.infer<typeof BranchRequestSchema>;

export const BranchResponseSchema = z.object({
  id: z.string(),
  parentId: z.string(),
  rootConversationId: z.string(),
  depth: z.number().int().min(1),
  highlightText: z.string(),
  highlightContext: z.string(),
  title: z.string(),
  createdAt: z.string(),
});

export type BranchResponse = z.infer<typeof BranchResponseSchema>;

export const SendMessageRequestSchema = z.object({
  content: z
    .string()
    .min(1, "Message must not be empty")
    .max(8000, "Message too long (max 8000 chars)"),
  clientMessageId: z.string().min(1).max(128).optional(),
});

export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

// ---------- health ----------

export const HealthProviderSchema = z.object({
  type: z.enum(["openai", "ollama"]).nullable(),
  model: z.string().nullable(),
  baseUrl: z.string().nullable(),
});

export type HealthProvider = z.infer<typeof HealthProviderSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  provider: HealthProviderSchema,
  ollamaReachable: z.boolean(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---------- helpers ----------

export function jsonError(
  status: number,
  code: ErrorCode,
  message?: string,
  fields?: Record<string, string>,
): Response {
  const body: ApiError = {
    error: { code, ...(message ? { message } : {}), ...(fields ? { fields } : {}) },
  };
  return Response.json(body, { status });
}

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json({ data } satisfies ApiOk<T>, { status });
}

export function jsonRaw<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}