"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { hierarchy } from "@visx/hierarchy";
import { tree } from "d3-hierarchy";
import type { HierarchyPointNode } from "d3-hierarchy";
import { ApiError } from "@/lib/api-client/base";
import { cn } from "@/lib/utils";
import { useSplit } from "@/lib/state/split";
import { registerTreeSearchFocus } from "@/lib/state/tree-search";
import {
  TreeQueryScope,
  useConversationTree,
} from "./useConversationTree";
import {
  TreeNodeShape,
  TREE_NODE_HEIGHT,
  TREE_NODE_WIDTH,
} from "./TreeNodeShape";
import type {
  Conversation,
  TreeResponse,
  TreeNodeDto,
} from "@/lib/api-client/types";

export interface TreeMapSidebarProps {
  conversation: Conversation;
  /** panel = persistent desktop sidebar; drawer = mobile slide-over */
  variant?: "panel" | "drawer";
  /** drawer mode: invoked by Esc / backdrop / close button */
  onClose?: () => void;
}

const SIDEBAR_WIDTH = 260;
const NODE_SPACING_X = TREE_NODE_WIDTH + 24;
const NODE_SPACING_Y = TREE_NODE_HEIGHT + 22;
const MARGIN = 16;

interface Positioned {
  dto: TreeNodeDto;
  level: number;
  parentId: string | null;
  setSize: number;
  posInSet: number;
  hasChildren: boolean;
  sx: number;
  sy: number;
}

export function TreeMapSidebar(props: TreeMapSidebarProps) {
  return (
    <TreeQueryScope>
      <SidebarInner {...props} />
    </TreeQueryScope>
  );
}

function SidebarInner({ conversation, variant = "panel", onClose }: TreeMapSidebarProps) {
  const router = useRouter();
  const split = useSplit();
  const rootId = conversation.rootConversationId || conversation.id;
  const { data, isLoading, isError, error, refetch } = useConversationTree(rootId);
  const currentId = data ? data.currentId : conversation.id;

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ dto: TreeNodeDto; x: number; y: number } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Tree search (US-404): client-side only, 150ms debounce, per-instance.
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const resetCollapsed = useCallback(() => setCollapsed(new Set()), []);
  useEffect(() => {
    resetCollapsed();
    setQuery("");
    setDebouncedQuery("");
  }, [rootId, conversation?.id, resetCollapsed]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    return registerTreeSearchFocus(() => {
      const el = searchRef.current;
      if (!el || isError) return false;
      if (el.offsetParent === null) return false; // hidden instance (drawer vs panel)
      el.focus();
      return true;
    });
  }, [isError]);

  const matchInfo = useMemo(() => {
    if (!data) return null;
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return null;
    const matches = new Set<string>();
    const kept = new Set<string>();
    const walk = (dto: TreeNodeDto, ancestors: string[]): boolean => {
      const selfMatch =
        (dto.title || "").toLowerCase().includes(q) ||
        (dto.highlightText ?? "").toLowerCase().includes(q);
      let childMatch = false;
      for (const c of dto.children) {
        childMatch = walk(c, [...ancestors, dto.id]) || childMatch;
      }
      if (selfMatch) matches.add(dto.id);
      if (selfMatch || childMatch) {
        kept.add(dto.id);
        for (const a of ancestors) kept.add(a);
        return true;
      }
      return false;
    };
    walk(data.root, []);
    return { matches, kept, count: matches.size };
  }, [data, debouncedQuery]);

  const visible = useMemo(() => {
    if (!data) return {} as Returned;
    // While searching, matches in collapsed subtrees must stay reachable —
    // treat every node as expanded (US-404 AC.2).
    const effCollapsed = matchInfo ? new Set<string>() : collapsed;
    const built = buildVisible(data, effCollapsed);
    if (!matchInfo) return built;
    const items = built.items.filter((i) => matchInfo.kept.has(i.dto.id));
    renumber(items);
    return { ...built, items };
  }, [data, collapsed, matchInfo]);

  const navigate = useCallback(
    (id: string) => {
      split.updateActivePaneId(id);
      if (!split.splitOpen) {
        router.push(`/c/${encodeURIComponent(id)}`);
      }
    },
    [router, split],
  );

  const onToggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onHoverStart = useCallback((dto: TreeNodeDto, e: React.MouseEvent) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => {
      setTooltip({ dto, x: e.clientX, y: e.clientY });
    }, 150);
  }, []);

  const onHoverEnd = useCallback(() => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltip(null);
  }, []);

  const onKeyDownItem = useCallback(
    (e: React.KeyboardEvent, item: VisibleItem) => {
      const all = visible.items;
      const focusTarget = (dto: TreeNodeDto) => {
        e.preventDefault();
        setFocusedId(dto.id);
        requestAnimationFrame(() => {
          containerRef.current
            ?.querySelector<HTMLButtonElement>(`[data-treeitem-id="${dto.id}"]`)
            ?.focus();
        });
      };
      switch (e.key) {
        case "ArrowDown": {
          const next = all[all.indexOf(item) + 1];
          if (next) focusTarget(next.dto);
          break;
        }
        case "ArrowUp": {
          const prev = all[all.indexOf(item) - 1];
          if (prev) focusTarget(prev.dto);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (!item.hasChildren) break;
          if (collapsed.has(item.dto.id)) onToggle(item.dto.id);
          else {
            const firstChild = all[all.indexOf(item) + 1];
            if (firstChild && firstChild.parentId === item.dto.id)
              focusTarget(firstChild.dto);
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (item.hasChildren && !collapsed.has(item.dto.id)) {
            onToggle(item.dto.id);
          } else if (item.parentDto) {
            focusTarget(item.parentDto);
          }
          break;
        }
        case "Home": {
          const first = visible.items[0];
          if (first) focusTarget(first.dto);
          break;
        }
        case "End": {
          const last = visible.items[visible.items.length - 1];
          if (last) focusTarget(last.dto);
          break;
        }
        case "Enter":
        case " ":
          e.preventDefault();
          navigate(item.dto.id);
          break;
      }
    },
    [visible, collapsed, navigate, onToggle],
  );

  // Drawer: initial focus, focus trap, Esc-to-close (US-202 a11y notes).
  useEffect(() => {
    if (variant !== "drawer") return;
    const el = containerRef.current;
    if (!el) return;
    const focusables = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          "button:not([tabindex='-1']), [href], [tabindex='0']",
        ),
      );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant, onClose]);

  const rovingTarget = focusedId ?? currentId;

  const clearSearch = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
  }, []);

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Return focus to the tree (US-404 AC.4): focus a visible node BEFORE
      // clearing so the root item — always kept — keeps focus across the
      // re-render; fall back to blurring the input.
      containerRef.current
        ?.querySelector<HTMLButtonElement>("[data-treeitem-id]")
        ?.focus();
      clearSearch();
    },
    [clearSearch],
  );

  const ariaBusy = isLoading ? "true" : "false";

  return (
    <div
      ref={containerRef}
      role={variant === "drawer" ? "dialog" : "complementary"}
      aria-label="Conversation tree"
      className={cn("flex flex-col overflow-hidden bg-background", variantClass(variant))}
      style={{ width: variant === "panel" ? SIDEBAR_WIDTH : undefined }}
      aria-busy={ariaBusy}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tree
        </span>
        {variant === "drawer" ? (
          <button
            type="button"
            aria-label="Close conversation tree"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="border-b px-3 py-2">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search tree…"
          aria-label="Search tree"
          disabled={isError}
          aria-disabled={isError || undefined}
          data-testid="tree-search"
          className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3 p-3" data-testid="tree-skeleton">
          <div className="h-9 w-full rounded-full bg-muted" />
          <div className="ml-8 h-8 w-3/4 rounded-full bg-muted" />
          <div className="ml-14 h-8 w-2/3 rounded-full bg-muted" />
        </div>
      ) : isError ? (
        <TreeErrorState error={error} onRetry={() => void refetch()} />
      ) : data ? (
        <>
          {matchInfo && matchInfo.count > 0 ? (
            <p
              role="status"
              className="border-b px-3 py-1.5 text-xs text-muted-foreground"
              data-testid="tree-search-count"
            >
              {matchInfo.count}{" "}
              {matchInfo.count === 1 ? "conversation" : "conversations"} match
            </p>
          ) : null}
          {(!data.root.children || data.root.children.length === 0) &&
          !matchInfo ? (
            <p
              className="border-b px-3 py-2 text-xs text-muted-foreground"
              data-testid="tree-empty-hint"
            >
              No sub-chats yet — select text in a reply to branch
            </p>
          ) : null}
          {matchInfo && matchInfo.count === 0 ? (
            <div
              role="status"
              className="flex flex-1 flex-col items-center gap-2 px-4 py-8 text-center"
              data-testid="tree-search-empty"
            >
              <p className="text-sm text-muted-foreground">
                No conversations match &quot;{debouncedQuery}&quot;
              </p>
              <button
                type="button"
                onClick={clearSearch}
                className="rounded border px-2 py-1 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Clear search
              </button>
            </div>
          ) : (
            <TreeSurface
              data={data}
              visible={visible}
              collapsed={collapsed}
              highlightQuery={debouncedQuery}
              rovingTarget={rovingTarget}
              onFocusNode={setFocusedId}
              onActivate={navigate}
              onToggle={onToggle}
              onTreeKeyDown={onKeyDownItem}
              onHoverStart={onHoverStart}
              onHoverEnd={onHoverEnd}
            />
          )}
        </>
      ) : null}

      {tooltip ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-xs rounded border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{ top: tooltip.y + 16, left: tooltip.x + 12 }}
        >
          <div className="font-medium">
            <HighlightedText text={tooltip.dto.title || "New chat"} query={debouncedQuery} />
          </div>
          {tooltip.dto.highlightText ? (
            <div className="mt-1 text-muted-foreground">
              <span aria-hidden="true">📌 </span>
              <HighlightedText text={tooltip.dto.highlightText} query={debouncedQuery} />
            </div>
          ) : null}
          <div className="text-muted-foreground">{formatDate(tooltip.dto.createdAt)}</div>
        </div>
      ) : null}
    </div>
  );
}

interface TreeErrorStateProps {
  error: Error | null;
  onRetry: () => void;
}

function TreeErrorState({ error, onRetry }: TreeErrorStateProps) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center gap-2 px-4 py-8 text-center"
    >
      <p className="text-sm text-destructive">
        {notFound ? "Conversation not found" : "Could not load tree"}
      </p>
      {!notFound ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded border px-2 py-1 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

interface VisibleItem {
  dto: TreeNodeDto;
  level: number;
  parentId: string | null;
  parentDto: TreeNodeDto | null;
  setSize: number;
  posInSet: number;
  hasChildren: boolean;
}

interface Returned {
  items: VisibleItem[];
  // Map id → depth-step us used for layout dimension hints.
  maxDepth: number;
}

function buildVisible(data: TreeResponse, collapsed: Set<string>): Returned {  const items: VisibleItem[] = [];
  const maxDepth = 0;
  const walk = (
    dto: TreeNodeDto,
    level: number,
    parentDto: TreeNodeDto | null,
    underCollapsed: boolean,
  ): void => {
    if (underCollapsed) return;
    items.push({
      dto,
      level,
      parentId: parentDto ? parentDto.id : null,
      parentDto,
      setSize: 0,
      posInSet: 0,
      hasChildren: dto.children.length > 0,
    });
    for (const c of dto.children) {
      walk(c, level + 1, dto, collapsed.has(dto.id));
    }
  };
  walk(data.root, 0, null, false);

  const sibCount = new Map<string, number>();
  for (const item of items) {
    const key = item.parentId ?? "";
    sibCount.set(key, (sibCount.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const item of items) {
    const key = item.parentId ?? "";
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    item.setSize = sibCount.get(key) ?? 1;
    item.posInSet = n;
  }
  return { items, maxDepth };
}

/** Recomputes aria-setsize/posinset after client-side filtering. */
function renumber(items: VisibleItem[]): void {
  const totals = new Map<string, number>();
  for (const it of items) {
    const key = it.parentId ?? "";
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const it of items) {
    const key = it.parentId ?? "";
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    it.setSize = totals.get(key) ?? 1;
    it.posInSet = n;
  }
}

/** HTML-context match highlighter (tooltips) — visual only, text unchanged. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      parts.push({ text: text.slice(i), hit: false });
      break;
    }
    if (idx > i) parts.push({ text: text.slice(i, idx), hit: false });
    parts.push({ text: text.slice(idx, idx + ql.length), hit: true });
    i = idx + ql.length;
  }
  return (
    <>
      {parts.map((p, j) =>
        p.hit ? (
          <mark
            key={j}
            className="bg-yellow-200 text-inherit dark:bg-yellow-700/60"
          >
            {p.text}
          </mark>
        ) : (
          <span key={j}>{p.text}</span>
        ),
      )}
    </>
  );
}

interface TreeSurfaceProps {
  data: TreeResponse;
  visible: Returned;
  collapsed: Set<string>;
  highlightQuery: string;
  rovingTarget: string;
  onFocusNode: (id: string) => void;
  onActivate: (id: string) => void;
  onToggle: (id: string) => void;
  onTreeKeyDown: (e: React.KeyboardEvent, item: VisibleItem) => void;
  onHoverStart: (dto: TreeNodeDto, e: React.MouseEvent) => void;
  onHoverEnd: () => void;
}

function TreeSurface({
  data,
  visible,
  collapsed,
  highlightQuery,
  rovingTarget,
  onFocusNode,
  onActivate,
  onToggle,
  onTreeKeyDown,
  onHoverStart,
  onHoverEnd,
}: TreeSurfaceProps) {
  const itemByDtoId = useMemo(() => {
    const m = new Map<string, VisibleItem>();
    for (const it of visible.items) m.set(it.dto.id, it);
    return m;
  }, [visible]);

  const { positioned, width, height } = useMemo(() => {
    // Lay out the FULL server tree (truncated server-side), then render only
    // visible nodes at their layout positions.
    const layoutRoot = hierarchy<TreeNodeDto>(data.root, (d) => d.children);
    const layout = tree<TreeNodeDto>()
      .nodeSize([NODE_SPACING_X, NODE_SPACING_Y])
      .separation((a, b) =>
        a.parent === b.parent ? 1 : Math.max(1.4, 2 - Math.min(a.depth, b.depth)),
      )(layoutRoot);

    const nodes = visible.items;
    const posById = new Map<string, Positioned>();
    for (const item of nodes) {
      const ln = findLayoutNode(layout, item.dto.id);
      if (!ln) continue;
      posById.set(item.dto.id, {
        dto: item.dto,
        level: item.level,
        parentId: item.parentId,
        setSize: item.setSize,
        posInSet: item.posInSet,
        hasChildren: item.hasChildren,
        sx: ln.x,
        sy: ln.y,
      });
    }
    const entries = [...posById.values()];
    // Tree coordinates are centered around 0 — shift so nodes never clip.
    const minSx = entries.reduce((acc, p) => Math.min(acc, p.sx), 0);
    const offset = Math.max(-minSx + MARGIN, TREE_NODE_WIDTH / 2 + MARGIN);
    for (const p of entries) p.sx += offset;
    const w = entries.reduce((acc, p) => Math.max(acc, p.sx + TREE_NODE_WIDTH / 2), offset + MARGIN);
    const h = entries.reduce((acc, p) => Math.max(acc, p.sy + TREE_NODE_HEIGHT), MARGIN * 2);
    return { positioned: entries, width: w, height: h };
  }, [data, visible]);

  const positionedById = useMemo(() => {
    const m = new Map<string, Positioned>();
    for (const p of positioned) m.set(p.dto.id, p);
    return m;
  }, [positioned]);

  return (
    <div className="flex-1 overflow-auto p-2" data-testid="tree-map">
      <div role="tree" aria-label="Conversation tree" className="relative">
        <svg
          width={width}
          height={height}
          className="block"
          aria-hidden="true"
        >
          {positioned.map((n) =>
            n.parentId && positionedById.has(n.parentId) ? (
              <Edge key={`e-${n.dto.id}`} from={positionedById.get(n.parentId)!} to={n} />
            ) : null,
          )}
          {positioned.map((n) => {
            const variant: "root" | "current" | "highlight" | "default" =
              n.dto.id === data.currentId
                ? "current"
                : n.level === 0
                  ? "root"
                  : n.dto.highlightText
                    ? "highlight"
                    : "default";
            return (
              <TreeNodeShape
                key={n.dto.id}
                x={n.sx}
                y={n.sy}
                title={n.dto.title}
                variant={variant}
                isFocused={rovingTarget === n.dto.id}
                hasChildren={n.hasChildren && !collapsed.has(n.dto.id)}
                highlightQuery={highlightQuery}
              />
            );
          })}
        </svg>

        {positioned.map((n) => {
          const item = itemByDtoId.get(n.dto.id);
          if (!item) return null;
          return (
            <button
              key={`t-${n.dto.id}`}
              type="button"
              data-treeitem-id={n.dto.id}
              role="treeitem"
              tabIndex={rovingTarget === n.dto.id ? 0 : -1}
              aria-level={n.level + 1}
              aria-setsize={n.setSize}
              aria-posinset={n.posInSet}
              aria-expanded={n.hasChildren ? !collapsed.has(n.dto.id) : undefined}
              aria-current={n.dto.id === data.currentId ? "true" : undefined}
              onFocus={() => onFocusNode(n.dto.id)}
              onClick={() => onActivate(n.dto.id)}
              onKeyDown={(e) => onTreeKeyDown(e, item)}
              onMouseEnter={(e) => onHoverStart(n.dto, e)}
              onMouseLeave={onHoverEnd}
              className="absolute rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                left: n.sx - TREE_NODE_WIDTH / 2,
                top: n.sy - TREE_NODE_HEIGHT / 2,
                width: TREE_NODE_WIDTH,
                height: TREE_NODE_HEIGHT,
              }}
            >
              <span className="sr-only">
                {n.dto.title || "New chat"}
                {n.dto.highlightText ? " (branched from a highlight)" : ""}
                {n.hasChildren ? (collapsed.has(n.dto.id) ? " collapsed" : " expanded") : ""}
                {n.dto.id === data.currentId ? " (current conversation)" : ""}
              </span>
            </button>
          );
        })}

        {positioned.map((n) =>
          n.hasChildren ? (
            <button
              key={`c-${n.dto.id}`}
              type="button"
              aria-label={
                collapsed.has(n.dto.id) ? "Expand subtree" : "Collapse subtree"
              }
              onClick={() => onToggle(n.dto.id)}
              className="absolute z-10 rounded p-0.5 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                left: n.sx - TREE_NODE_WIDTH / 2 - 12,
                top: n.sy - 7,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d={collapsed.has(n.dto.id) ? "M3 1l4 4-4 4" : "M1 3l4 4 4-4"}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : null,
        )}
      </div>

      {data.truncated ? (
        <div
          role="status"
          className="border-t px-3 py-2 text-xs text-muted-foreground"
        >
          Showing 500 of {data.totalNodes} conversations
        </div>
      ) : null}
    </div>
  );
}

function Edge({ from, to }: { from: Positioned; to: Positioned }) {
  const x1 = from.sx + TREE_NODE_WIDTH / 2;
  const y1 = from.sy;
  const x2 = to.sx - TREE_NODE_WIDTH / 2;
  const y2 = to.sy;
  const midX = (x1 + x2) / 2;
  return (
    <path
      d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
      fill="none"
      stroke="currentColor"
      strokeOpacity={0.3}
      strokeWidth={1}
      className="text-foreground"
      aria-hidden="true"
    />
  );
}

function variantClass(variant: "panel" | "drawer"): string {
  if (variant === "panel") return "w-full";
  return "h-full w-full max-w-[20rem] shadow-xl motion-safe:animate-in motion-safe:slide-in-from-left";
}

function findLayoutNode(
  root: HierarchyPointNode<TreeNodeDto>,
  id: string,
): HierarchyPointNode<TreeNodeDto> | null {
  const walk = (
    n: HierarchyPointNode<TreeNodeDto>,
  ): HierarchyPointNode<TreeNodeDto> | null => {
    if (n.data.id === id) return n;
    for (const c of n.children ?? []) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  return walk(root);
}
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

/* Mobile slide-over drawer trigger (US-202 AC.4): header button, backdrop,
 * focus trap + Esc. Rendered by AppShell on viewports < 768px. */
export function TreeDrawer({
  conversation,
}: {
  conversation: Conversation;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      >
        Tree
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/40"
            aria-hidden="true"
            onClick={close}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw]">
            <TreeMapSidebar
              conversation={conversation}
              variant="drawer"
              onClose={close}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
