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
}

const NODE_WIDTH = 148;
const NODE_HEIGHT = 34;
const CHAR_LIMIT = 24;

function truncateTitle(title: string): string {
  if (!title) return "New chat";
  if (title.length <= CHAR_LIMIT) return title;
  return `${title.slice(0, CHAR_LIMIT - 1)}…`;
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
}: TreeNodeShapeProps) {
  const truncated = truncateTitle(title);
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
        {truncated}
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
