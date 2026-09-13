import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildSubChatSystemNote } from "@/lib/ai/stream";

const ENV_KEY = "SUBSCHAT_SYSTEM_PROMPT";

describe("buildSubChatSystemNote", () => {
  beforeEach(() => {
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("uses default template when env var is not set", () => {
    const result = buildSubChatSystemNote({
      parentTitle: "RAG Chat",
      highlightText: "vector database",
    });
    expect(result).toContain("RAG Chat");
    expect(result).toContain("vector database");
    expect(result.toLowerCase()).toContain("sub-chat");
    expect(result).not.toContain("{parentTitle}");
    expect(result).not.toContain("{highlightText}");
  });

  it("substitutes the {parentTitle} placeholder", () => {
    const result = buildSubChatSystemNote({
      parentTitle: "My Parent",
      highlightText: "x",
    });
    expect(result).toContain("My Parent");
    expect(result).not.toContain("{parentTitle}");
  });

  it("substitutes the {highlightText} placeholder", () => {
    const result = buildSubChatSystemNote({
      parentTitle: "x",
      highlightText: "my highlight",
    });
    expect(result).toContain("my highlight");
    expect(result).not.toContain("{highlightText}");
  });

  it("uses SUBSCHAT_SYSTEM_PROMPT env var when set", () => {
    process.env[ENV_KEY] =
      "CUSTOM: parent={parentTitle} phrase={highlightText}";
    const result = buildSubChatSystemNote({
      parentTitle: "MyParent",
      highlightText: "MyPhrase",
    });
    expect(result).toBe("CUSTOM: parent=MyParent phrase=MyPhrase");
  });

  it("falls back to 'a parent chat' when parentTitle is null", () => {
    const result = buildSubChatSystemNote({
      parentTitle: null,
      highlightText: "x",
    });
    expect(result).toContain("a parent chat");
  });

  it("falls back to 'a highlighted passage' when highlightText is null", () => {
    const result = buildSubChatSystemNote({
      parentTitle: "x",
      highlightText: null,
    });
    expect(result).toContain("a highlighted passage");
  });

  it("substitutes all occurrences when the template repeats a placeholder", () => {
    process.env[ENV_KEY] =
      "{highlightText} :: {highlightText} :: {parentTitle}";
    const result = buildSubChatSystemNote({
      parentTitle: "P",
      highlightText: "H",
    });
    expect(result).toBe("H :: H :: P");
  });
});
