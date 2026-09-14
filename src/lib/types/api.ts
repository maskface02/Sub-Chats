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
  "PROVIDER_LIMIT",
  "STREAM_ACTIVE",
  "NOT_EDITABLE",
  "NOT_REGENERABLE",
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

// ---------- delete / restore (phase 4 US-401) ----------

export const DeleteResponseSchema = z.object({
  deletedIds: z.array(z.string()),
  deletedCount: z.number().int().min(0),
  batchId: z.string(),
});

export type DeleteResponse = z.infer<typeof DeleteResponseSchema>;

export const RestoreResponseSchema = z.object({
  restoredCount: z.number().int().min(0),
});

export type RestoreResponse = z.infer<typeof RestoreResponseSchema>;

// ---------- export (phase 4 US-403) ----------

export const ExportQuerySchema = z.object({
  format: z.enum(["md", "json"]),
});

export type ExportQuery = z.infer<typeof ExportQuerySchema>;

export const ExportedMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  model: z.string().nullable(),
  providerId: z.string().nullable(),
  createdAt: z.string(),
});

export type ExportedMessage = z.infer<typeof ExportedMessageSchema>;

export const ExportJsonResponseSchema = z.object({
  conversation: z.object({
    id: z.string(),
    title: z.string(),
    parentId: z.string().nullable(),
    rootConversationId: z.string(),
    depth: z.number().int().min(0),
    highlightText: z.string().nullable(),
    highlightContext: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  messages: z.array(ExportedMessageSchema),
});

export type ExportJsonResponse = z.infer<typeof ExportJsonResponseSchema>;

// ---------- edit / regenerate (phase 4 US-407/US-408) ----------

export const EditMessageRequestSchema = z
  .object({
    content: z
      .string()
      .min(1, "Message must not be empty")
      .max(8000, "Message too long (max 8000 chars)"),
  })
  .strict();

export type EditMessageRequest = z.infer<typeof EditMessageRequestSchema>;

export const RegenerateRequestSchema = z.object({}).strict();

export type RegenerateRequest = z.infer<typeof RegenerateRequestSchema>;

// ---------- tree (phase 2) ----------

export interface TreeNodeDto {
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

// ---------- providers (phase 3) ----------

export const PROVIDER_TYPES = [
  "openai",
  "anthropic",
  "ollama",
  "custom",
] as const;

export type ProviderTypeDto = (typeof PROVIDER_TYPES)[number];

export const ProviderDtoSchema = z.object({
  id: z.string(),
  type: z.enum(PROVIDER_TYPES),
  baseUrl: z.string().nullable(),
  defaultModel: z.string().nullable(),
  isDefault: z.boolean(),
  apiKeyHint: z.string().nullable(),
  createdAt: z.string(),
});

export type ProviderDto = z.infer<typeof ProviderDtoSchema>;

export const ProviderListResponseSchema = z.object({
  items: z.array(ProviderDtoSchema),
});

export type ProviderListResponse = z.infer<typeof ProviderListResponseSchema>;

const providerBaseUrlSchema = z
  .string()
  .min(1)
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "baseUrl must be a valid http(s) URL" },
  );

const providerApiKeySchema = z.string().min(1).max(4096);
const providerDefaultModelSchema = z.string().min(1).max(200);

export const CreateProviderRequestSchema = z
  .object({
    type: z.enum(PROVIDER_TYPES),
    baseUrl: providerBaseUrlSchema.optional(),
    apiKey: providerApiKeySchema.optional(),
    defaultModel: providerDefaultModelSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.type === "openai" || data.type === "anthropic") {
      if (!data.apiKey) {
        ctx.addIssue({
          code: "custom",
          path: ["apiKey"],
          message: `apiKey is required for type ${data.type}`,
        });
      }
      if (data.baseUrl !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["baseUrl"],
          message: `baseUrl is not allowed for type ${data.type}`,
        });
      }
    }
    if (data.type === "ollama") {
      if (!data.baseUrl) {
        ctx.addIssue({
          code: "custom",
          path: ["baseUrl"],
          message: "baseUrl is required for type ollama",
        });
      }
      if (data.apiKey !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["apiKey"],
          message: "apiKey is not allowed for type ollama",
        });
      }
    }
    if (data.type === "custom" && !data.baseUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "baseUrl is required for type custom",
      });
    }
  });

export type CreateProviderRequest = z.infer<typeof CreateProviderRequestSchema>;

export const UpdateProviderRequestSchema = z
  .object({
    baseUrl: providerBaseUrlSchema.optional(),
    apiKey: providerApiKeySchema.optional(),
    defaultModel: providerDefaultModelSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export type UpdateProviderRequest = z.infer<typeof UpdateProviderRequestSchema>;

// ---------- health ----------

export const HealthProviderSchema = z.object({
  type: z.enum(["openai", "anthropic", "ollama", "custom"]).nullable(),
  model: z.string().nullable(),
  baseUrl: z.string().nullable(),
  source: z.enum(["user", "env"]).nullable(),
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