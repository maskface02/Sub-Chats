import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rows: [] as { id: string }[] }));
vi.mock("next-auth", () => ({ default: () => ({ auth: mocks.auth, handlers: {}, signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows }) }) }) } }));
vi.mock("@/lib/config/flags", () => ({ allowGuestAccess: () => false }));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

describe("stale account sessions", () => {
  beforeEach(() => { mocks.rows = []; mocks.auth.mockReset(); });
  it("rejects a JWT whose account is missing", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "deleted-user" } });
    const { auth } = await import("@/lib/auth");
    expect(await auth()).toBeNull();
  });
  it("preserves a session for an existing account", async () => {
    const session = { user: { id: "existing-user" } };
    mocks.rows = [{ id: "existing-user" }];
    mocks.auth.mockResolvedValue(session);
    const { auth } = await import("@/lib/auth");
    expect(await auth()).toEqual(session);
  });
});
