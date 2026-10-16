import type { Message, TreeNodeDto } from "@/lib/api-client/types";

export interface BranchRange { start: number; end: number; branch: TreeNodeDto }

export function branchRanges(messages: Message[], branches: TreeNodeDto[]): Map<string, BranchRange[]> {
  const result = new Map<string, BranchRange[]>();
  for (const branch of branches) {
    const text = branch.highlightText;
    if (!text) continue;
    let matches: { message: Message; start: number; end: number }[] = [];
    if (branch.sourceMessageId) {
      const message = messages.find(m => m.id === branch.sourceMessageId && m.role === "assistant");
      const start = branch.sourceStart, end = branch.sourceEnd;
      if (message && start != null && end != null && start >= 0 && end > start && message.content.slice(start, end) === text) matches = [{ message, start, end }];
    } else {
      for (const message of messages.filter(m => m.role === "assistant")) {
        let start = message.content.indexOf(text);
        while (start >= 0 && matches.length < 2) {
          matches.push({ message, start, end: start + text.length });
          start = message.content.indexOf(text, start + 1);
        }
      }
    }
    if (matches.length !== 1) continue;
    const { message, start, end } = matches[0];
    result.set(message.id, [...(result.get(message.id) ?? []), { start, end, branch }]);
  }
  return result;
}

export function findTreeNode(node: TreeNodeDto, id: string): TreeNodeDto | undefined {
  if (node.id === id) return node;
  for (const child of node.children) { const found = findTreeNode(child, id); if (found) return found; }
}
