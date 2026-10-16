type Node = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: Node[];
};

// Preserve source coordinates before highlighting introduces extra text nodes.
export function sourcePositions(options: { ranges?: { start: number; end: number; branch: { id: string } }[] } = {}) {
  return (tree: Node) => {
    function visit(node: Node) {
      node.children = node.children?.flatMap<Node>(child => {
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        if (child.type === "text" && start !== undefined && end !== undefined) {
          const ranges = (options.ranges ?? []).filter(r => r.start < end && r.end > start);
          if (ranges.length && child.value?.length === end - start) {
            const cuts = [...new Set([start, end, ...ranges.flatMap(r => [Math.max(start, r.start), Math.min(end, r.end)])])].sort((a, b) => a - b);
            return cuts.slice(0, -1).map((a, i) => {
              const b = cuts[i + 1];
              const ids = ranges.filter(r => r.start <= a && r.end >= b).map(r => r.branch.id);
              return { type: "element", tagName: "span", properties: {
                "data-source-start": a, "data-source-end": b,
                ...(ids.length ? { "data-branch-ids": ids.join(",") } : {}),
              }, children: [{ type: "text", value: child.value!.slice(a - start, b - start) }] };
            });
          }
          return { type: "element", tagName: "span", properties: {
            "data-source-start": start, "data-source-end": end,
          }, children: [child] };
        }
        // Code highlighters require their original text children.
        if (child.tagName !== "code") visit(child);
        return child;
      });
    }
    visit(tree);
  };
}
