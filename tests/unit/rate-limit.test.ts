import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  resetRateLimit,
  rateLimitConfig,
} from "../../src/lib/auth/rate-limit";

const MAX = rateLimitConfig.signin.maxAttempts;
const WINDOW = rateLimitConfig.signin.windowMs;

describe("rate limiter (token bucket, 5 / 15 min)", () => {
  beforeEach(() => {
    resetRateLimit("1.2.3.4");
    resetRateLimit("5.6.7.8");
  });

  it("allows the first attempt", () => {
    const r = checkRateLimit("1.2.3.4");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(MAX - 1);
  });

  it("blocks the 6th attempt from the same IP", () => {
    for (let i = 0; i < MAX; i++) {
      const r = checkRateLimit("1.2.3.4");
      expect(r.allowed).toBe(true);
    }
    const sixth = checkRateLimit("1.2.3.4");
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
    expect(sixth.retryAfterMs).toBeGreaterThan(0);
    expect(sixth.retryAfterMs).toBeLessThanOrEqual(WINDOW);
  });

  it("isolates attempts per IP", () => {
    for (let i = 0; i < MAX; i++) {
      checkRateLimit("1.2.3.4");
    }
    const blocked = checkRateLimit("1.2.3.4");
    expect(blocked.allowed).toBe(false);

    const otherIp = checkRateLimit("5.6.7.8");
    expect(otherIp.allowed).toBe(true);
    expect(otherIp.remaining).toBe(MAX - 1);
  });

  it("resets after resetRateLimit is called", () => {
    for (let i = 0; i < MAX; i++) {
      checkRateLimit("1.2.3.4");
    }
    expect(checkRateLimit("1.2.3.4").allowed).toBe(false);
    resetRateLimit("1.2.3.4");
    expect(checkRateLimit("1.2.3.4").allowed).toBe(true);
  });
});