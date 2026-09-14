import { type NextRequest } from "next/server";
import { and, eq, asc, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { ExportQuerySchema, jsonError, jsonRaw } from "@/lib/types/api";

export const runtime = "nodejs";

// ---------- markdown helpers (exported, unit-tested) ----------

type Role = "user" | "assistant" | "system";

export function messageRoleLabel(role: Role): string {
  return role === "user" ? "You" : role === "assistant" ? "Assistant" : role;
}

/**
 * Max backtick run length in content, counting runs of 1 char too —
 * lengths >= 3 are fence candidates.
 */
function maxBacktickRun(content: string): number {
  let max = 0;
  for (const run of content.match(/`+/g) ?? []) {
    max = Math.max(max, run.length);
  }
  return max;
}

/**
 * Normative md escaping (US-403 AC.3): content containing lines starting with
 * `#`, `---`, or fence markers is emitted inside a fence whose run is longer
 * than any inner run; inner fence runs are lengthened (+1) first so
 * outer always stays longer than every inner fence. Otherwise raw.
 * (Applies to message bodies only — titles/breadcrumbs are emitted as-is.)
 */
export function renderMessageBody(content: string): string {
  const broken = content
    .split("\n")
    .some((line) => /^\s{0,3}(#{1,6}(?:\s|$)|---|```)/.test(line));
  if (!broken) return content;

  const run = maxBacktickRun(content);
  if (run >= 3) {
    const lengthened = content.replace(/`+/g, (r) =>
      r.length >= 3 ? r + "`" : r,
    );
    return "`".repeat(run + 2) + "text\n" + lengthened + "\n" + "`".repeat(run + 2);
  }
  return "```text\n" + content + "\n```";
}

export function sanitizeTitleSlug(title: string): string {
  // CR/LF, quotes, backslash and all C0/C1 control chars are stripped
  // (normative); CR/LF first so they separate words like spaces would.
  const stripped = title
    .replace(/[\r\n]+/g, " ")
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      if (code <= 31 || code === 127 || (code >= 128 && code <= 159)) {
        return false;
      }
      return ch !== '"' && ch !== "\\";
    })
    .join("");
  const slug = stripped
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "chat";
}

function slugIsAsciiSafe(slug: string): boolean {
  for (const ch of slug) {
    if (ch === "-" || ch === " " || ch === "." || ch === "_") continue;
    if (ch < "!" || ch > "~") return false;
  }
  return true;
}

export function contentDisposition(filename: string): string {
  if (slugIsAsciiSafe(filename.replace(/\.[a-z]+$/, ""))) {
    return `attachment; filename="${filename}"`;
  }
  const encoded = encodeURIComponent(filename)
    .replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, " ");
  const asciiFallback =
    filename.replace(/[^\x21-\x7E]/g, "").replace(/-+/g, "-") || "chat";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function dateStamp(date: Date): string {
  // YYYYMMDD (UTC) appended to every exported filename, per US-403 AC.2.
  return date
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
}

function buildBreadcrumb(
  ancestorTitles: Array<string | null>,
  currentTitle: string,
): string {
  const titles = [
    ...ancestorTitles.map((t) => t ?? "…"),
    currentTitle,
  ];
  return `> Path: ${titles.join(" › ")}`;
}

export function buildMarkdownExport(args: {
  title: string;
  isRoot: boolean;
  ancestorTitles?: string[] | null;
  highlightText: string | null;
  highlightContext: string | null;
  messages: Array<{ role: Role; content: string }>;
}): string {
  const parts: string[] = [`# ${args.title}`];
  if (!args.isRoot) {
    parts.push("");
    parts.push(buildBreadcrumb(args.ancestorTitles ?? [], args.title));
    parts.push(`> Highlight: "${args.highlightText ?? ""}"`);
    if (args.highlightContext !== null) {
      parts.push(`> Context: ${args.highlightContext}`);
    }
  }
  parts.push("", "---");
  for (const m of args.messages) {
    parts.push("", `## ${messageRoleLabel(m.role)}`, "", renderMessageBody(m.content));
  }
  return parts.join("\n") + "\n";
}

// ---------- route ----------

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError(401, "UNAUTHENTICATED", "Sign in required");
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

  const parsed = ExportQuerySchema.safeParse({
    format: req.nextUrl.searchParams.get("format") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "format must be md or json");
  }
  const { format } = parsed.data;

  const convRows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.userId, userId),
        // Soft-deleted conversations export as 404 (US-403 AC.5).
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);
  if (convRows.length === 0) {
    return jsonError(404, "NOT_FOUND", "Conversation not found");
  }
  const conv = convRows[0]!;

  const msgRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  const isRoot = conv.parentId === null;
  let breadcrumb: string[] | null = null;
  if (!isRoot) {
    breadcrumb = [];
    let cursorId: string | null = conv.parentId;
    while (cursorId && cursorId !== conv.id) {
      const rows = await db
        .select({ id: conversations.id, title: conversations.title, parentId: conversations.parentId })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, cursorId),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
          ),
        )
        .limit(1);
      if (rows.length === 0) { breadcrumb = null; break; }
      breadcrumb.unshift(rows[0]!.title);
      cursorId = rows[0]!.parentId;
    }
  }

  const slug = sanitizeTitleSlug(conv.title);
  const filenameBase = `${slug}-${dateStamp(conv.updatedAt)}`;

  if (format === "json") {
    const body = {
      conversation: {
        id: conv.id,
        title: conv.title,
        parentId: conv.parentId,
        rootConversationId: conv.rootConversationId,
        depth: conv.depth,
        highlightText: conv.highlightText,
        highlightContext: conv.highlightContext,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
      },
      messages: msgRows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model ?? null,
        providerId: m.providerId ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
    };
    const res = jsonRaw(body, 200);
    res.headers.set("Content-Disposition", contentDisposition(`${filenameBase}.json`));
    return res;
  }

  const md = buildMarkdownExport({
    title: conv.title,
    isRoot,
    ancestorTitles: breadcrumb,
    highlightText: conv.highlightText,
    highlightContext: conv.highlightContext,
    messages: msgRows.map((m) => ({
      role: m.role as Role,
      content: m.content,
    })),
  });

  const res = new Response(md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  res.headers.set("Content-Disposition", contentDisposition(`${filenameBase}.md`));
  return res;
}
