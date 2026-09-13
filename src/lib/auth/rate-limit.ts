const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNIN_MAX_ATTEMPTS = 5;

const MESSAGES_PER_MINUTE = 60;
const MESSAGES_PER_HOUR = 500;
const MESSAGE_MINUTE_WINDOW_MS = 60 * 1000;
const MESSAGE_HOUR_WINDOW_MS = 60 * 60 * 1000;

type Bucket = {
  attempts: number;
  windowStart: number;
};

type DualBucket = {
  minute: Bucket;
  hour: Bucket;
};

const globalForRl = globalThis as unknown as {
  __rateLimitBuckets?: Map<string, Bucket>;
  __messageRateLimitBuckets?: Map<string, DualBucket>;
};

const buckets: Map<string, Bucket> =
  globalForRl.__rateLimitBuckets ?? new Map<string, Bucket>();
globalForRl.__rateLimitBuckets = buckets;

const messageBuckets: Map<string, DualBucket> =
  globalForRl.__messageRateLimitBuckets ?? new Map<string, DualBucket>();
globalForRl.__messageRateLimitBuckets = messageBuckets;

export function checkRateLimit(ip: string): {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
} {
  const now = Date.now();
  const existing = buckets.get(ip);

  if (!existing || now - existing.windowStart >= SIGNIN_WINDOW_MS) {
    buckets.set(ip, { attempts: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0, remaining: SIGNIN_MAX_ATTEMPTS - 1 };
  }

  if (existing.attempts >= SIGNIN_MAX_ATTEMPTS) {
    const retryAfterMs = Math.max(0, SIGNIN_WINDOW_MS - (now - existing.windowStart));
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  existing.attempts += 1;
  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: SIGNIN_MAX_ATTEMPTS - existing.attempts,
  };
}

export function resetRateLimit(ip: string): void {
  buckets.delete(ip);
}

export function checkMessagesRateLimit(userId: string): {
  allowed: boolean;
  retryAfterMs: number;
  reason: "minute" | "hour" | null;
} {
  const now = Date.now();
  let entry = messageBuckets.get(userId);

  if (!entry) {
    entry = {
      minute: { attempts: 0, windowStart: now },
      hour: { attempts: 0, windowStart: now },
    };
    messageBuckets.set(userId, entry);
  }

  if (now - entry.minute.windowStart >= MESSAGE_MINUTE_WINDOW_MS) {
    entry.minute = { attempts: 0, windowStart: now };
  }
  if (now - entry.hour.windowStart >= MESSAGE_HOUR_WINDOW_MS) {
    entry.hour = { attempts: 0, windowStart: now };
  }

  if (entry.hour.attempts >= MESSAGES_PER_HOUR) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, MESSAGE_HOUR_WINDOW_MS - (now - entry.hour.windowStart)),
      reason: "hour",
    };
  }
  if (entry.minute.attempts >= MESSAGES_PER_MINUTE) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, MESSAGE_MINUTE_WINDOW_MS - (now - entry.minute.windowStart)),
      reason: "minute",
    };
  }

  entry.minute.attempts += 1;
  entry.hour.attempts += 1;
  return { allowed: true, retryAfterMs: 0, reason: null };
}

export const rateLimitConfig = {
  signin: { windowMs: SIGNIN_WINDOW_MS, maxAttempts: SIGNIN_MAX_ATTEMPTS },
  messages: { perMinute: MESSAGES_PER_MINUTE, perHour: MESSAGES_PER_HOUR },
} as const;