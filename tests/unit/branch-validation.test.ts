import { describe, it, expect } from "vitest";
import {
  extractSentenceContext,
  validateBranchSelection,
} from "@/lib/ai/stream";

describe("validateBranchSelection", () => {
  it("accepts a valid selection that exactly matches the slice", () => {
    const result = validateBranchSelection({
      messageContent: "In a RAG pipeline, a vector database stores embeddings.",
      selectedText: "vector database",
      charStart: 21,
      charEnd: 36,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a selection with whitespace mismatch (sliced.trim vs selected.trim)", () => {
    const result = validateBranchSelection({
      messageContent: "In a RAG pipeline, a vector database stores embeddings.",
      selectedText: "  vector database  ",
      charStart: 21,
      charEnd: 36,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when charStart is negative", () => {
    const result = validateBranchSelection({
      messageContent: "hello world",
      selectedText: "hello",
      charStart: -1,
      charEnd: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.charStart).toBeTruthy();
    }
  });

  it("rejects when charEnd exceeds content length", () => {
    const result = validateBranchSelection({
      messageContent: "hello",
      selectedText: "hello world",
      charStart: 0,
      charEnd: 11,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when charStart >= charEnd", () => {
    const result = validateBranchSelection({
      messageContent: "hello",
      selectedText: "h",
      charStart: 3,
      charEnd: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.charEnd).toBeTruthy();
    }
  });

  it("rejects when selectedText trim is empty", () => {
    const result = validateBranchSelection({
      messageContent: "hello world",
      selectedText: "   ",
      charStart: 0,
      charEnd: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.selectedText).toBeTruthy();
    }
  });

  it("rejects when selectedText exceeds 2000 chars", () => {
    const content = "x".repeat(2500);
    const result = validateBranchSelection({
      messageContent: content,
      selectedText: "x".repeat(2001),
      charStart: 0,
      charEnd: 2001,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.selectedText).toBeTruthy();
    }
  });

  it("rejects when slice.trim() does not match selectedText.trim()", () => {
    const result = validateBranchSelection({
      messageContent: "the quick brown fox",
      selectedText: "slow fox",
      charStart: 10,
      charEnd: 19,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.selectedText).toBeTruthy();
    }
  });

  it("rejects when clientHighlightContext exceeds 500 chars", () => {
    const result = validateBranchSelection({
      messageContent: "hello world",
      selectedText: "hello",
      charStart: 0,
      charEnd: 5,
      clientHighlightContext: "x".repeat(501),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields.clientHighlightContext).toBeTruthy();
    }
  });

  it("accepts clientHighlightContext at exactly 500 chars", () => {
    const result = validateBranchSelection({
      messageContent: "hello world",
      selectedText: "hello",
      charStart: 0,
      charEnd: 5,
      clientHighlightContext: "x".repeat(500),
    });
    expect(result.ok).toBe(true);
  });
});

describe("extractSentenceContext", () => {
  it("returns the matching sentence when alone in content", () => {
    const content = "First sentence. Second sentence with selection. Third sentence.";
    const idx = content.indexOf("with selection");
    const result = extractSentenceContext(content, idx, idx + 14, 500);
    expect(result).toContain("Second sentence");
  });

  it("includes one sentence before and after when available", () => {
    const content =
      "First sentence. Second sentence with selection. Third sentence.";
    const idx = content.indexOf("selection");
    const result = extractSentenceContext(content, idx, idx + 9, 500);
    expect(result).toContain("First sentence");
    expect(result).toContain("Second sentence");
    expect(result).toContain("Third sentence");
  });

  it("only includes the matching sentence at the start of content", () => {
    const content = "First sentence with selection. Second. Third.";
    const idx = content.indexOf("selection");
    const result = extractSentenceContext(content, idx, idx + 9, 500);
    expect(result).toContain("First sentence");
    expect(result).toContain("Second");
    expect(result).not.toContain("Third");
  });

  it("caps the result at 500 chars and truncates with ellipsis", () => {
    const longSentence = "B".repeat(800);
    const content = "First sentence. " + longSentence + ". Third sentence.";
    const idx = content.indexOf("B");
    const result = extractSentenceContext(content, idx, idx + 1, 500);
    expect(result.length).toBeLessThanOrEqual(500);
    expect(result.endsWith("…")).toBe(true);
  });

  it("falls back to the full content when the splitter yields nothing", () => {
    const content = "no terminal punctuation here";
    const result = extractSentenceContext(content, 0, 5, 500);
    expect(result).toBe(content);
  });

  it("falls back to truncated full content when content has no terminators", () => {
    const content = "x".repeat(600);
    const result = extractSentenceContext(content, 50, 60, 500);
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it("returns empty string for empty content", () => {
    expect(extractSentenceContext("", 0, 0, 500)).toBe("");
  });
});
