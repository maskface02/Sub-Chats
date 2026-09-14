import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  logError: vi.fn(),
  selectQueue: [] as Array<() => unknown>,
  selectCalls: 0,
}));

function nextRows(): unknown[] {
  const behavior = m.selectQueue.shift();
  if (behavior) return behavior();
  throw new Error("unexpected select call — queue empty");
}

vi.mock("@/lib/auth", () => ({ auth: m.auth }));

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: m.logError, debug: vi.fn(), child: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () =>
          ({
            orderBy: async () => nextRows(),
            limit: async () => nextRows(),
            then: (resolve: (v: unknown[]) => void) => resolve(nextRows()),
          }) as never,
      }),
    }),
  },
}));

const USER_A = "user-A";

function session(userId: string | null) {
  m.auth.mockImplementation(async () =>
    userId ? { user: { id: userId } } : null,
  );
}

function convRow(over: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    userId: USER_A,
    title: over.title ?? "Deploying with Docker",
    parentId: null,
    rootConversationId: "conv-1",
    depth: 0,
    highlightText: null,
    highlightContext: null,
    createdAt: new Date("2026-09-13T10:00:00Z"),
    updatedAt: new Date("2026-09-13T10:05:00Z"),
    deletedAt: null,
    deletedBatchId: null,
    ...over,
  };
}

function msgRow(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    conversationId: "conv-1",
    role: "user",
    content: "hi",
    model: null,
    providerId: null,
    createdAt: new Date("2026-09-13T10:01:00Z"),
    ...over,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  m.selectQueue = [];
});

describe("renderMessageBody md escaping (US-403 AC.3)", () => {
  let mod: typeof import("@/app/api/chats/[id]/export/route");
  beforeAll(async () => {
    mod = await import("@/app/api/chats/[id]/export/route");
  });

  it("plain content emitted raw", () => {
    expect(mod.renderMessageBody("Hello, world")).toBe("Hello, world");
  });

  it("content starting with # is fence-wrapped", () => {
    const out = mod.renderMessageBody("# Not a heading really");
    expect(out).toBe("```text\n# Not a heading really\n```");
  });

  it("--- leading line triggers wrap", () => {
    expect(mod.renderMessageBody("---")).toBe("```text\n---\n```");
  });

  it("adversarial fixture: # heading + nested fences lengthened, outer longer than inner", () => {
    const content = "# Deploy script\n\n```\nrun --all\n```\n";
    const out = mod.renderMessageBody(content);
    const outer = /^(`+)text/.exec(out)![1]!;
    expect(outer.length).toBeGreaterThanOrEqual(4);
    // inner fences lengthened by one relative to original run (3)
    expect(out).toContain("````");
    // outer closes AFTER the (lengthened) inner fences
    const closing = /(`+)\s*$/.exec(out)![1]!;
    expect(closing.length).toBe(outer.length);
    expect(closing.length).toBeGreaterThan(4);
  });
});

describe("sanitizeTitleSlug + Content-Disposition (US-403 AC.2)", () => {
  let mod: typeof import("@/app/api/chats/[id]/export/route");
  beforeAll(async () => {
    mod = await import("@/app/api/chats/[id]/export/route");
  });

  it("strips CR/LF, quotes, backslash and C0/C1 control chars", () => {
    expect(
      mod.sanitizeTitleSlug('A\r\nB\n"quote"\\back\\slash\u0007\u0085x'),
    ).toBe("a-b-quotebackslashx");
    expect(mod.sanitizeTitleSlug("bad\u0001\u0002 bell\u0007ctl")).toBe(
      "bad-bellctl",
    );
    expect(mod.sanitizeTitleSlug("\u0085 c1\u009f")).toContain("c1");
  });

  it("ASCII slug → simple filename header", () => {
    const h = mod.contentDisposition("deploying-with-docker.md");
    expect(h).toBe('attachment; filename="deploying-with-docker.md"');
  });

  it("non-ASCII slug adds RFC 5987 filename*", () => {
    const h = mod.contentDisposition("日本の-chat.json");
    expect(h).toContain("filename*=");
    expect(h).toContain("UTF-8");
    expect(h).not.toMatch(/filename="[^"]*日/);
  });
});

describe("buildMarkdownExport structure (US-403 AC.3)", () => {
  let mod: Awaited<ReturnType<typeof importExport>>;
  beforeAll(async () => {
    mod = await importExport();
  });

  it("root chat: title, divider, sections — no context block", () => {
    const md = mod.buildMarkdownExport({
      title: "Deploying with Docker",
      isRoot: true,
      highlightText: null,
      highlightContext: null,
      messages: [
        { role: "user", content: "Why did my container exit?" },
        { role: "assistant", content: "Containers exit when…" },
      ],
    });
    expect(md).toBe(
      [
        "# Deploying with Docker",
        "",
        "---",
        "",
        "## You",
        "",
        "Why did my container exit?",
        "",
        "## Assistant",
        "",
        "Containers exit when…",
        "",
      ].join("\n"),
    );
  });

  it("sub-chat: breadcrumb + Highlight (+ Context)", () => {
    const md = mod.buildMarkdownExport({
      title: "Why did my container exit?",
      isRoot: false,
      ancestorTitles: ["Deploying with Docker"],
      highlightText: "the restart policy only applies to exit code 1",
      highlightContext: "Docker docs say restart policies trigger on failure exits…",
      messages: [
        { role: "user", content: "Why did my container exit?" },
      ],
    });
    expect(md).toContain("# Why did my container exit?\n");
    expect(md).toContain(
      "> Path: Deploying with Docker › Why did my container exit?\n",
    );
    expect(md).toContain('> Highlight: "the restart policy only applies to exit code 1"\n');
    expect(md).toContain("> Context: Docker docs say restart policies trigger on failure exits…\n");
    expect(md).toContain("\n---\n");
    expect(md).toContain("## You\n");
    expect(md).not.toContain("## Assistant");
  });
});

describe("GET /api/chats/:id/export", () => {
  it("401 without session", async () => {
    session(null);
    const route = await import("@/app/api/chats/[id]/export/route");
    const res = await route.GET(makeReq("?format=md"), {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("400 for missing/bad format", async () => {
    session(USER_A);
    const route = await import("@/app/api/chats/[id]/export/route");
    const res = await route.GET(makeReq(""), {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: { code: "INVALID_INPUT", message: "format must be md or json" },
    });
    const res2 = await route.GET(makeReq("?format=pdf"), {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res2.status).toBe(400);
  });

  it("404 for missing/soft-deleted conversations", async () => {
    session(USER_A);
    const route = await import("@/app/api/chats/[id]/export/route");
    m.selectQueue.push(() => []); // deleted → filtered → empty
    const res = await route.GET(makeReq("?format=md"), {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("md export: headers, structure, filename", async () => {
    session(USER_A);
    m.selectQueue.push(
      () => [convRow({})],
      () => [
        msgRow({ content: "Why did my container exit?" }),
        msgRow({
          id: "m2",
          role: "assistant",
          content: "Containers exit when the main process terminates.",
          model: "gpt-4o-mini",
          providerId: "env:openai",
        }),
      ],
    );
    const route = await import("@/app/api/chats/[id]/export/route");
    const res = await route.GET(makeReq("?format=md"), {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="deploying-with-docker-20260913.md"',
    );
    const text = await res.text();
    expect(text).toContain("# Deploying with Docker");
    expect(text).toContain("## You\n\nWhy did my container exit?");
    expect(text).toContain("## Assistant\n\nContainers exit when the main process terminates.");
    expect(text).toContain("\n---\n");
    // no model metadata in md readability-first
    expect(text).not.toContain("gpt-4o-mini");
    expect(text).not.toContain("env:openai");
  });

  it("json export: exact shape, no key material", async () => {
    session(USER_A);
    m.selectQueue.push(
      () => [
        convRow({
          parentId: "conv-root",
          rootConversationId: "conv-root",
          depth: 1,
          highlightText: "the restart policy",
          highlightContext: "ctx",
        }),
      ],
      () => [
        msgRow({
          role: "user",
          content: "Why did my container exit?",
        }),
      ],
      () => [
        convRow({
          id: "conv-root",
          title: "Deploying with Docker",
          parentId: null,
        }),
      ],
    );
    const route = await import("@/app/api/chats/[id]/export/route");
    const res = await route.GET(makeReq("?format=json"), {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type")!;
    expect(ct).toContain("application/json");
    expect(res.headers.get("Content-Disposition")).toContain(".json");
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["conversation", "messages"]);
    expect(body.conversation).toEqual({
      id: "conv-1",
      title: "Deploying with Docker",
      parentId: "conv-root",
      rootConversationId: "conv-root",
      depth: 1,
      highlightText: "the restart policy",
      highlightContext: "ctx",
      createdAt: "2026-09-13T10:00:00.000Z",
      updatedAt: "2026-09-13T10:05:00.000Z",
    });
    expect(body.messages[0]).toEqual({
      id: "m1",
      role: "user",
      content: "Why did my container exit?",
      model: null,
      providerId: null,
      createdAt: "2026-09-13T10:01:00.000Z",
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/apiKey|cipher|Authorization/i);
  });

  it("empty conversation still 200 with title + no message sections", async () => {
    session(USER_A);
    m.selectQueue.push(
      () => [convRow({})],
      () => [],
    );
    const route = await import("@/app/api/chats/[id]/export/route");
    const res = await route.GET(makeReq("?format=md"), {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.startsWith("# Deploying with Docker")).toBe(true);
    expect(text).not.toContain("## ");
  });
});

function importExport() {
  return import("@/app/api/chats/[id]/export/route");
}

type ExportMod = Awaited<ReturnType<typeof importExport>>;

function makeReq(search: string): Parameters<ExportMod["GET"]>[0] {
  return {
    nextUrl: new URL(`https://app.test/api/chats/conv-1/export${search}`),
  } as never;
}
