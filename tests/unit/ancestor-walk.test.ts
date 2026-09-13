import { describe, it, expect } from "vitest";
import {
  walkAncestors,
  HttpError,
  type ConversationRow,
  type MessageRow,
} from "@/lib/ai/stream";

function makeConv(over: Partial<ConversationRow>): ConversationRow {
  return {
    id: "x",
    userId: "user-A",
    parentId: null,
    rootConversationId: "x",
    depth: 0,
    title: "Untitled",
    highlightText: null,
    ...over,
  };
}

function makeMsg(over: Partial<MessageRow>): MessageRow {
  return {
    id: over.id ?? "m",
    conversationId: over.conversationId ?? "x",
    role: over.role ?? "user",
    content: over.content ?? "",
    createdAt: over.createdAt ?? new Date(0),
    ...over,
  };
}

describe("walkAncestors", () => {
  it("returns current only for a root conversation (depth 0, no parent)", async () => {
    const root = makeConv({
      id: "root-1",
      rootConversationId: "root-1",
      depth: 0,
      title: "Root Title",
    });
    const convs = new Map<string, ConversationRow>([[root.id, root]]);
    const msgs = new Map<string, MessageRow[]>([
      [
        root.id,
        [
          makeMsg({ id: "m1", conversationId: root.id, role: "user", content: "hi", createdAt: new Date(1) }),
          makeMsg({
            id: "m2",
            conversationId: root.id,
            role: "assistant",
            content: "hello",
            createdAt: new Date(2),
          }),
        ],
      ],
    ]);

    const result = await walkAncestors({
      target: root,
      sessionUserId: "user-A",
      fetcher: {
        fetchConvById: async (id) => convs.get(id) ?? null,
        fetchMessagesByConvIds: async (ids) =>
          ids.flatMap((id) => msgs.get(id) ?? []),
      },
      newUserMessage: "followup",
    });

    // system + 2 history + 1 new = 4 messages
    expect(result).toHaveLength(4);
    expect(result[0]?.role).toBe("system");
    expect(result[0]?.content).toContain("a parent chat");
    expect(result[1]).toEqual({ role: "user", content: "hi" });
    expect(result[2]).toEqual({ role: "assistant", content: "hello" });
    expect(result[3]).toEqual({ role: "user", content: "followup" });
  });

  it("returns root + parent + current in order for depth 2", async () => {
    const root = makeConv({
      id: "root",
      rootConversationId: "root",
      depth: 0,
      title: "Root Title",
    });
    const parent = makeConv({
      id: "parent",
      parentId: "root",
      rootConversationId: "root",
      depth: 1,
      title: "Parent Title",
      highlightText: "outer highlight",
    });
    const current = makeConv({
      id: "current",
      parentId: "parent",
      rootConversationId: "root",
      depth: 2,
      title: "Current Title",
      highlightText: "inner phrase",
    });

    const convs = new Map<string, ConversationRow>([
      [root.id, root],
      [parent.id, parent],
      [current.id, current],
    ]);
    const msgs = new Map<string, MessageRow[]>([
      [
        root.id,
        [
          makeMsg({ id: "r1", conversationId: root.id, role: "user", content: "root-q", createdAt: new Date(1) }),
          makeMsg({
            id: "r2",
            conversationId: root.id,
            role: "assistant",
            content: "root-a",
            createdAt: new Date(2),
          }),
        ],
      ],
      [
        parent.id,
        [
          makeMsg({ id: "p1", conversationId: parent.id, role: "user", content: "parent-q", createdAt: new Date(3) }),
        ],
      ],
      [current.id, []],
    ]);

    const result = await walkAncestors({
      target: current,
      sessionUserId: "user-A",
      fetcher: {
        fetchConvById: async (id) => convs.get(id) ?? null,
        fetchMessagesByConvIds: async (ids) =>
          ids.flatMap((id) => msgs.get(id) ?? []),
      },
      newUserMessage: "deep-q",
    });

    // system + root(2) + parent(1) + current(0) + new(1) = 5
    expect(result).toHaveLength(5);
    expect(result[0]?.role).toBe("system");
    expect(result[0]?.content).toContain("Parent Title");
    expect(result[0]?.content).toContain("inner phrase");
    expect(result[1]).toEqual({ role: "user", content: "root-q" });
    expect(result[2]).toEqual({ role: "assistant", content: "root-a" });
    expect(result[3]).toEqual({ role: "user", content: "parent-q" });
    expect(result[4]).toEqual({ role: "user", content: "deep-q" });
  });

  it("throws HttpError(503, ANCESTOR_UNAVAILABLE) when an ancestor is foreign-owned", async () => {
    const foreign = makeConv({
      id: "foreign-parent",
      userId: "user-B",
      rootConversationId: "foreign-parent",
      depth: 0,
      title: "Foreign",
    });
    const current = makeConv({
      id: "current",
      userId: "user-A",
      parentId: "foreign-parent",
      rootConversationId: "foreign-parent",
      depth: 1,
      title: "Current",
      highlightText: "highlighted",
    });
    const convs = new Map<string, ConversationRow>([
      [foreign.id, foreign],
      [current.id, current],
    ]);

    await expect(
      walkAncestors({
        target: current,
        sessionUserId: "user-A",
        fetcher: {
          fetchConvById: async (id) => convs.get(id) ?? null,
          fetchMessagesByConvIds: async () => [],
        },
        newUserMessage: "x",
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "ANCESTOR_UNAVAILABLE",
    });
  });

  it("throws HttpError(503, ANCESTOR_UNAVAILABLE) when an ancestor is missing", async () => {
    const current = makeConv({
      id: "current",
      parentId: "ghost-parent",
      rootConversationId: "ghost-parent",
      depth: 1,
      title: "Current",
    });
    const convs = new Map<string, ConversationRow>([[current.id, current]]);

    await expect(
      walkAncestors({
        target: current,
        sessionUserId: "user-A",
        fetcher: {
          fetchConvById: async (id) => convs.get(id) ?? null,
          fetchMessagesByConvIds: async () => [],
        },
        newUserMessage: "x",
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("throws HttpError(404, NOT_FOUND) when the target itself is foreign-owned", async () => {
    const foreign = makeConv({
      id: "other",
      userId: "user-B",
      rootConversationId: "other",
      depth: 0,
      title: "Other",
    });

    await expect(
      walkAncestors({
        target: foreign,
        sessionUserId: "user-A",
        fetcher: {
          fetchConvById: async () => null,
          fetchMessagesByConvIds: async () => [],
        },
        newUserMessage: "x",
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });
});
