import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
import { useSplit } from "@/lib/state/split";

beforeEach(() => useSplit().closeSplit());
describe("three-chat hierarchy window", () => {
  it("closes only the deepest pane, but closes descendants with their parent", () => {
    useSplit().openBranch("main", "sub");
    useSplit().openBranch("sub", "subsub");
    useSplit().closeBranch("subsub");
    expect(useSplit().path).toEqual(["main", "sub"]);
    expect(useSplit().splitOpen).toBe(true);
    useSplit().openBranch("sub", "subsub");
    useSplit().closeBranch("sub");
    expect(useSplit().path).toEqual(["main"]);
    expect(useSplit().splitOpen).toBe(false);
  });
  it("keeps the path while moving a bounded window backward and forward", () => {
    useSplit().openBranch("main", "sub");
    useSplit().openBranch("sub", "subsub");
    useSplit().openBranch("subsub", "deep");
    expect(useSplit().path).toEqual(["main", "sub", "subsub", "deep"]);
    expect(useSplit().windowStart).toBe(1);
    useSplit().shiftWindow("back");
    expect(useSplit().windowStart).toBe(0);
    useSplit().shiftWindow("back");
    expect(useSplit().windowStart).toBe(0);
    useSplit().shiftWindow("forward");
    useSplit().shiftWindow("forward");
    expect(useSplit().windowStart).toBe(1);
  });
  it("reuses ancestors without duplicating panes and replaces only the selected branch path", () => {
    useSplit().openBranch("main", "sub");
    useSplit().openBranch("sub", "deep");
    useSplit().openBranch("deep", "main");
    expect(useSplit().path).toEqual(["main", "sub", "deep"]);
    useSplit().openBranch("sub", "sibling");
    expect(useSplit().path).toEqual(["main", "sub", "sibling"]);
  });
});
