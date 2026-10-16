import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const ts = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();
const tsNullable = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  emailVerified: tsNullable("email_verified"),
  name: text("name"),
  image: text("image"),
  passwordHash: text("password_hash"),
  createdAt: ts("created_at").$defaultFn(() => new Date()),
  updatedAt: ts("updated_at").$defaultFn(() => new Date()),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    pk: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: ts("expires").notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: ts("expires").notNull(),
  },
  (vt) => ({
    pk: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    parentId: text("parent_id").references(
      (): AnyPgColumn => conversations.id,
      { onDelete: "cascade" },
    ),
    rootConversationId: text("root_conversation_id")
      .notNull()
      .references((): AnyPgColumn => conversations.id, { onDelete: "cascade" }),
    depth: integer("depth").notNull().default(0),
    highlightText: text("highlight_text"),
    sourceMessageId: text("source_message_id"),
    sourceStart: integer("source_start"),
    sourceEnd: integer("source_end"),
    highlightContext: text("highlight_context"),
    createdAt: ts("created_at").$defaultFn(() => new Date()),
    updatedAt: ts("updated_at").$defaultFn(() => new Date()),
    deletedAt: tsNullable("deleted_at"),
    deletedBatchId: text("deleted_batch_id"),
  },
  // Partial index: the hot list query scans live rows only (US-401).
  (c) => ({
    userUpdatedLiveIdx: index("conversations_user_updated_live_idx")
      .on(c.userId, c.updatedAt)
      .where(sql`deleted_at IS NULL`),
    parentIdx: index("conversations_parent_idx").on(c.parentId),
    rootIdx: index("conversations_root_idx").on(c.rootConversationId),
    deletedBatchIdx: index("conversations_deleted_batch_idx").on(
      c.deletedBatchId,
    ),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    model: text("model"),
    providerId: text("provider_id"),
    createdAt: ts("created_at").$defaultFn(() => new Date()),
  },
  (m) => ({
    convCreatedIdx: index("messages_conversation_created_idx").on(
      m.conversationId,
      m.createdAt,
    ),
  }),
);

export const providers = pgTable("providers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["openai", "anthropic", "ollama", "custom"],
  }).notNull(),
  baseUrl: text("base_url"),
  apiKeyCiphertext: text("api_key_ciphertext"),
  defaultModel: text("default_model"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: ts("created_at").$defaultFn(() => new Date()),
});

export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  providers: many(providers),
  accounts: many(accounts),
  sessions: many(sessions),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  parent: one(conversations, {
    fields: [conversations.parentId],
    references: [conversations.id],
    relationName: "conversation_parent",
  }),
  root: one(conversations, {
    fields: [conversations.rootConversationId],
    references: [conversations.id],
    relationName: "conversation_root",
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const providersRelations = relations(providers, ({ one }) => ({
  user: one(users, {
    fields: [providers.userId],
    references: [users.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ProviderRow = typeof providers.$inferSelect;

export const schema = {
  users,
  accounts,
  sessions,
  verificationTokens,
  conversations,
  messages,
  providers,
};
