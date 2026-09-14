import { describe, it, expect } from "vitest";
import {
  setPendingQuestion,
  takePendingQuestion,
} from "@/lib/state/pending-question";

describe("pending-question store (sub-chat question dialog hand-off)", () => {
  it("returns the question set for a conversation", () => {
    setPendingQuestion("conv-1", "What is a vector database?");
    expect(takePendingQuestion("conv-1")).toBe(
      "What is a vector database?",
    );
  });

  it("take is get-and-clear (second take returns null)", () => {
    setPendingQuestion("conv-2", "q2");
    expect(takePendingQuestion("conv-2")).toBe("q2");
    expect(takePendingQuestion("conv-2")).toBeNull();
  });

  it("isolates conversations", () => {
    setPendingQuestion("conv-3", "q3");
    expect(takePendingQuestion("conv-other")).toBeNull();
    expect(takePendingQuestion("conv-3")).toBe("q3");
  });

  it("returns null for unknown conversations", () => {
    expect(takePendingQuestion("never-set")).toBeNull();
  });
});
