import { describe, expect, it } from "vitest";
import { branchRanges } from "@/components/chat/branchHighlights";
import { sourcePositions } from "@/components/markdown/sourcePositions";
import type { Message, TreeNodeDto } from "@/lib/api-client/types";
const message: Message = { id: "m", role: "assistant", content: "same same", createdAt: "2026-01-01" };
const branch: TreeNodeDto = { id: "b", title: "Branch", depth: 1, highlightText: "same", createdAt: "2026-01-01", children: [] };
describe("persistent branch highlights", () => {
  it("uses exact saved offsets for repeated phrases", () => {
    expect(branchRanges([message], [{ ...branch, sourceMessageId: "m", sourceStart: 5, sourceEnd: 9 }]).get("m")?.[0].start).toBe(5);
  });
  it("does not guess ambiguous legacy links or stale message content", () => {
    expect(branchRanges([message], [branch]).size).toBe(0);
    expect(branchRanges([message], [{ ...branch, sourceMessageId: "m", sourceStart: 1, sourceEnd: 5 }]).size).toBe(0);
  });
  it("resolves unambiguous older branches", () => {
    expect(branchRanges([{ ...message, content: "one same" }], [branch]).get("m")?.[0].start).toBe(4);
  });
  it("splits text at overlapping branch boundaries without losing source coordinates", () => {
    const tree = { type: "root", children: [{ type: "text", value: "abcdef", position: { start: { offset: 0 }, end: { offset: 6 } } }] };
    sourcePositions({ ranges: [{ start: 1, end: 4, branch: { id: "a" } }, { start: 3, end: 5, branch: { id: "b" } }] })(tree);
    expect(tree.children).toMatchObject([
      { properties: { "data-source-start": 0 }, children: [{ value: "a" }] },
      { properties: { "data-branch-ids": "a" }, children: [{ value: "bc" }] },
      { properties: { "data-branch-ids": "a,b" }, children: [{ value: "d" }] },
      { properties: { "data-branch-ids": "b" }, children: [{ value: "e" }] },
      { properties: { "data-source-end": 6 }, children: [{ value: "f" }] },
    ]);
  });
});
