const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNIN_MAX_ATTEMPTS = 5;

const MESSAGES_PER_MINUTE = 60;
const MESSAGES_PER_HOUR = 500;
const MESSAGE_MINUTE_WINDOW_MS = 60 * 1000;
const MESSAGE_HOUR_WINDOW_MS = 60 * 60 * 1000;

const BRANCH_WINDOW_MS = 10 * 60 * 1000;
const BRANCH_MAX_ATTEMPTS = 30;

const PROVIDER_WINDOW_MS = 10 * 60 * 1000;
const PROVIDER_MAX_ATTEMPTS = 30;

// Shared mutation bucket: delete/restore + edit/regenerate (US-401 AC.8,
// phase-4 §8.7 — delete/edit/regenerate all draw from one 30/10min/user bucket;
// LLM-cost-bearing edit/regenerate also draw the message-send bucket).
const MUTATION_WINDOW_MS = 10 * 60 * 1000;
const MUTATION_MAX_ATTEMPTS = 30;

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
  __branchRateLimitBuckets?: Map<string, Bucket>;
  __providerRateLimitBuckets?: Map<string, Bucket>;
  __mutationRateLimitBuckets?: Map<string, Bucket>;
};

const buckets: Map<string, Bucket> =
  globalForRl.__rateLimitBuckets ?? new Map<string, Bucket>();
globalForRl.__rateLimitBuckets = buckets;

const messageBuckets: Map<string, DualBucket> =
  globalForRl.__messageRateLimitBuckets ?? new Map<string, DualBucket>();
globalForRl.__messageRateLimitBuckets = messageBuckets;

const branchBuckets: Map<string, Bucket> =
  globalForRl.__branchRateLimitBuckets ?? new Map<string, Bucket>();
globalForRl.__branchRateLimitBuckets = branchBuckets;

const providerBuckets: Map<string, Bucket> =
  globalForRl.__providerRateLimitBuckets ?? new Map<string, Bucket>();
globalForRl.__providerRateLimitBuckets = providerBuckets;

const mutationBuckets: Map<string, Bucket> =
  globalForRl.__mutationRateLimitBuckets ?? new Map<string, Bucket>();
globalForRl.__mutationRateLimitBuckets = mutationBuckets;

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

export function checkBranchRateLimit(userId: string): {
  allowed: boolean;
  retryAfterMs: number;
  reason: string | null;
} {
  const now = Date.now();
  const existing = branchBuckets.get(userId);

  if (!existing || now - existing.windowStart >= BRANCH_WINDOW_MS) {
    branchBuckets.set(userId, { attempts: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0, reason: null };
  }

  if (existing.attempts >= BRANCH_MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, BRANCH_WINDOW_MS - (now - existing.windowStart)),
      reason: "branch-quota-exceeded",
    };
  }

  existing.attempts += 1;
  return { allowed: true, retryAfterMs: 0, reason: null };
}

export function resetBranchRateLimit(userId: string): void {
  branchBuckets.delete(userId);
}

export function checkProviderRateLimit(userId: string): {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
} {
  const now = Date.now();
  const existing = providerBuckets.get(userId);

  if (!existing || now - existing.windowStart >= PROVIDER_WINDOW_MS) {
    providerBuckets.set(userId, { attempts: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0, remaining: PROVIDER_MAX_ATTEMPTS - 1 };
  }

  if (existing.attempts >= PROVIDER_MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, PROVIDER_WINDOW_MS - (now - existing.windowStart)),
      remaining: 0,
    };
  }

  existing.attempts += 1;
  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: PROVIDER_MAX_ATTEMPTS - existing.attempts,
  };
}

export function resetProviderRateLimit(userId: string): void {
  providerBuckets.delete(userId);
}

export function checkMutationRateLimit(userId: string): {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
} {
  const now = Date.now();
  const existing = mutationBuckets.get(userId);

  if (!existing || now - existing.windowStart >= MUTATION_WINDOW_MS) {
    mutationBuckets.set(userId, { attempts: 1, windowStart: now });
    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: MUTATION_MAX_ATTEMPTS - 1,
    };
  }

  if (existing.attempts >= MUTATION_MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterMs: Math.max(
        0,
        MUTATION_WINDOW_MS - (now - existing.windowStart),
      ),
      remaining: 0,
    };
  }

  existing.attempts += 1;
  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: MUTATION_MAX_ATTEMPTS - existing.attempts,
  };
}

export function resetMutationRateLimit(userId: string): void {
  mutationBuckets.delete(userId);
}

export const rateLimitConfig = {
  signin: { windowMs: SIGNIN_WINDOW_MS, maxAttempts: SIGNIN_MAX_ATTEMPTS },
  messages: { perMinute: MESSAGES_PER_MINUTE, perHour: MESSAGES_PER_HOUR },
  branch: { windowMs: BRANCH_WINDOW_MS, maxAttempts: BRANCH_MAX_ATTEMPTS },
  providers: { windowMs: PROVIDER_WINDOW_MS, maxAttempts: PROVIDER_MAX_ATTEMPTS },
  mutation: { windowMs: MUTATION_WINDOW_MS, maxAttempts: MUTATION_MAX_ATTEMPTS },
} as const;