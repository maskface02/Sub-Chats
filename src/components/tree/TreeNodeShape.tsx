"use client";

export interface TreeNodeShapeProps {
  x: number;
  y: number;
  width?: number;
  height?: number;
  title: string;
  variant: "root" | "current" | "highlight" | "default";
  isFocused: boolean;
  hasChildren: boolean;
  labelId?: string;
  /** When set, matching substrings render visually highlighted (US-404 AC.2). */
  highlightQuery?: string;
}

const NODE_WIDTH = 148;
const NODE_HEIGHT = 34;
const CHAR_LIMIT = 24;

function truncateTitle(title: string): string {
  if (!title) return "New chat";
  if (title.length <= CHAR_LIMIT) return title;
  return `${title.slice(0, CHAR_LIMIT - 1)}…`;
}

interface TitleSegment {
  text: string;
  hit: boolean;
}

function splitHighlight(text: string, query: string): TitleSegment[] {
  const q = query.trim().toLowerCase();
  if (!q || !text) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: TitleSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (idx > i) out.push({ text: text.slice(i, idx), hit: false });
    out.push({ text: text.slice(idx, idx + q.length), hit: true });
    i = idx + q.length;
  }
  return out.length > 0 ? out : [{ text, hit: false }];
}

const VARIANT_CLASS: Record<TreeNodeShapeProps["variant"], string> = {
  root: "fill-secondary stroke-border text-foreground",
  current: "fill-primary stroke-primary text-primary-foreground",
  highlight: "fill-muted stroke-border text-foreground",
  default: "fill-card stroke-border text-foreground",
};

export function TreeNodeShape({
  x,
  y,
  width = NODE_WIDTH,
  height = NODE_HEIGHT,
  title,
  variant,
  isFocused,
  hasChildren,
  labelId,
  highlightQuery,
}: TreeNodeShapeProps) {
  const truncated = truncateTitle(title);
  const segments = highlightQuery
    ? splitHighlight(truncated, highlightQuery)
    : null;
  const rx = height / 2;

  return (
    <g
      transform={`translate(${x - width / 2}, ${y - height / 2})`}
      className={VARIANT_CLASS[variant]}
    >
      <rect
        width={width}
        height={height}
        rx={rx}
        strokeWidth={variant === "current" ? 2 : 1}
        aria-hidden="true"
      />
      {variant === "highlight" ? (
        <text
          x={10}
          y={height / 2 + 4}
          className="text-foreground"
          fill="currentColor"
          aria-hidden="true"
        >
          📌
        </text>
      ) : null}
      <text
        id={labelId}
        x={variant === "highlight" ? 26 : width / 2}
        y={height / 2 + 4}
        textAnchor={variant === "highlight" ? "start" : "middle"}
        fill="currentColor"
        className="text-xs"
      >
        {segments
          ? segments.map((s, i) => (
              <tspan
                key={i}
                style={
                  s.hit
                    ? { textDecoration: "underline", fontWeight: 700 }
                    : undefined
                }
              >
                {s.text}
              </tspan>
            ))
          : truncated}
      </text>
      {isFocused ? (
        <rect
          width={width}
          height={height}
          rx={rx}
          fill="none"
          stroke="currentColor"
          strokeDasharray="3 3"
          strokeWidth={1}
          aria-hidden="true"
        />
      ) : null}
    </g>
  );
}

export { NODE_HEIGHT as TREE_NODE_HEIGHT, NODE_WIDTH as TREE_NODE_WIDTH };
