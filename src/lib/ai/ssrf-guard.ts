import "server-only";
import { lookup } from "node:dns/promises";

export type SsrfGuardType = "openai" | "anthropic" | "ollama" | "custom";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export type SsrfCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

const PRIVATE_V4_MESSAGE = "baseUrl must not point to a private address";

function parseV4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isBlockedV4(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  if (a === 127) return true; // loopback 127/8
  if (a === 10) return true; // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // link-local 169.254/16
  return false;
}

function expandV6(ip: string): number[] | null {
  // returns hextets (lowercase numbers) or null if invalid
  let addr = ip.split("%")[0]!; // strip zone id
  if (addr.includes("::")) {
    const [head, tail] = addr.split("::");
    if (addr.split("::").length > 2) return null;
    const headGroups = head ? head.split(":") : [];
    const tailGroups = tail ? tail.split(":") : [];
    const fill = 8 - headGroups.length - tailGroups.length;
    if (fill < 0) return null;
    const groups = [
      ...headGroups,
      ...Array<string>(fill).fill("0"),
      ...tailGroups,
    ];
    addr = groups.join(":");
  }
  const hextets = addr.split(":");
  if (hextets.length !== 8) return null;
  const nums: number[] = [];
  for (const h of hextets) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
    nums.push(parseInt(h, 16));
  }
  return nums;
}

function isBlockedV6(ip: string): boolean {
  // IPv4-mapped (::ffff:a.b.c.d) → evaluate as IPv4
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) {
    const octets = parseV4(mapped[1]!);
    return octets !== null && isBlockedV4(octets);
  }
  const groups = expandV6(ip);
  if (!groups) return true; // unparseable IPv6 → treat as blocked
  const first = groups[0]!;
  if (groups[7] === 1 && groups.slice(0, 7).every((g) => g === 0)) return true; // ::1
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10
  return false;
}

function isBlockedIp(ip: string): boolean {
  if (ip.includes(":")) return isBlockedV6(ip);
  const octets = parseV4(ip);
  if (!octets) return true; // unparseable → treat as blocked
  return isBlockedV4(octets);
}

async function checkCustomUrl(url: URL): Promise<SsrfCheckResult> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const ipLiteral =
    /^(\d{1,3}(?:\.\d{1,3}){3})$/.test(hostname) || hostname.includes(":");

  let addresses: Array<{ address: string }>;
  if (ipLiteral) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      return {
        ok: false,
        reason: "baseUrl hostname could not be resolved",
      };
    }
    if (addresses.length === 0) {
      return { ok: false, reason: "baseUrl hostname could not be resolved" };
    }
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      return { ok: false, reason: PRIVATE_V4_MESSAGE };
    }
  }
  return { ok: true };
}

/**
 * Validate a user-supplied provider baseUrl (US-301 AC.3b).
 * - scheme allowlist: http/https only
 * - `custom`: deny loopback/private/link-local resolved IPs (DNS rebinding is
 *   mitigated by re-running this at send time via assertSendTimeAllowed)
 * - `ollama`: EXEMPT from the private-range denylist (documented accept-risk)
 */
export async function validateProviderBaseUrl(
  url: string,
  type: SsrfGuardType,
): Promise<SsrfCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "baseUrl must be a valid http(s) URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "baseUrl must use http or https" };
  }
  if (type === "ollama") {
    return { ok: true };
  }
  return checkCustomUrl(parsed);
}

/**
 * Send-time re-validation (US-301 AC.3b point 4). Throws SsrfBlockedError on
 * violation so the caller can map it to a 502 PROVIDER_FAILED error path.
 */
export async function assertSendTimeAllowed(
  url: string,
  type: SsrfGuardType,
): Promise<void> {
  const result = await validateProviderBaseUrl(url, type);
  if (!result.ok) {
    throw new SsrfBlockedError(result.reason);
  }
}

const MAX_REDIRECT_HOPS = 3;

/**
 * A fetch wrapper that closes the redirect-following SSRF gap (Security
 * phase-3 hardening #1): default fetch follows 3xx hops WITHOUT re-running
 * the private-IP denylist, so a public baseUrl could redirect to
 * http://169.254.169.254/ and bypass the guard.
 *
 * Uses redirect: "manual", validates every hop's URL through the same
 * guard, and follows up to MAX_REDIRECT_HOPS redirects itself.
 * 303/307/308 preserve the method + body; 301/302 degrade to GET.
 */
export function ssrfSafeFetch(type: SsrfGuardType): typeof fetch {
  return async (input, init) => {
    let url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    let currentInit: RequestInit | undefined = init;
    let method = (init?.method ?? "GET").toUpperCase();
    let body = init?.body;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      await assertSendTimeAllowed(url, type);

      const res = await fetch(url, { ...currentInit, redirect: "manual" });
      if (res.status < 300 || res.status >= 400) return res;

      const location = res.headers.get("location");
      if (!location) return res; // no Location → treat as terminal
      const next = new URL(location, url).toString();
      if (res.status === 301 || res.status === 302) {
        method = "GET";
        body = undefined;
      }
      url = next;
      currentInit = { ...currentInit, method, body };
    }
    throw new SsrfBlockedError("too many redirects");
  };
}
