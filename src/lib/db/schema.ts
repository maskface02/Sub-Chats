import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

const ts = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull();
const tsNullable = (name: string) =>
  integer(name, { mode: "timestamp_ms" });

export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  emailVerified: tsNullable("emailVerified"),
  name: text("name"),
  image: text("image"),
  passwordHash: text("passwordHash"),
  createdAt: ts("createdAt").$defaultFn(() => new Date()),
  updatedAt: ts("updatedAt").$defaultFn(() => new Date()),
});

export const accounts = sqliteTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
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

export const sessions = sqliteTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: ts("expires"),
});

export const verificationTokens = sqliteTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: ts("expires"),
  },
  (vt) => ({
    pk: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    parentId: text("parentId"),
    rootConversationId: text("rootConversationId").notNull(),
    depth: integer("depth").notNull().default(0),
    highlightText: text("highlightText"),
    highlightContext: text("highlightContext"),
    createdAt: ts("createdAt").$defaultFn(() => new Date()),
    updatedAt: ts("updatedAt").$defaultFn(() => new Date()),
  },
  (c) => ({
    userUpdatedIdx: index("conversations_user_updated_idx").on(
      c.userId,
      c.updatedAt,
    ),
    parentIdx: index("conversations_parent_idx").on(c.parentId),
    rootIdx: index("conversations_root_idx").on(c.rootConversationId),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    model: text("model"),
    providerId: text("providerId"),
    createdAt: ts("createdAt").$defaultFn(() => new Date()),
  },
  (m) => ({
    convCreatedIdx: index("messages_conversation_created_idx").on(
      m.conversationId,
      m.createdAt,
    ),
  }),
);

export const providers = sqliteTable("providers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["openai", "anthropic", "ollama", "custom"],
  }).notNull(),
  baseUrl: text("baseUrl"),
  apiKeyCiphertext: text("apiKeyCiphertext"),
  defaultModel: text("defaultModel"),
  isDefault: integer("isDefault").notNull().default(0),
  createdAt: ts("createdAt").$defaultFn(() => new Date()),
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