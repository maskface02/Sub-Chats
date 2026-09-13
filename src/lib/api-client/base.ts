import { headers } from "next/headers";

import type { ApiErrorBody } from "./types";

export interface ApiFetchOptions extends Omit<RequestInit, "body" | "headers"> {
  body?: unknown;
  headers?: Record<string, string>;
  cookie?: string;
  forwardCookies?: boolean;
  baseUrl?: string;
  next?: { revalidate?: number | false; tags?: string[] };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message ?? body.error.code);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error.code;
    this.fields = body.error.fields;
  }
}

function resolveBaseUrl(explicit?: string): string {
  if (explicit) return explicit.replace(/\/$/, "");
  if (typeof window !== "undefined") return "";
  const env = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return env.replace(/\/$/, "");
}

export async function apiFetch<T>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const { body, headers: extraHeaders, cookie, forwardCookies, baseUrl, next, ...rest } = opts;

  const url = `${resolveBaseUrl(baseUrl)}${path}`;

  const finalHeaders: Record<string, string> = {
    accept: "application/json",
    ...(extraHeaders ?? {}),
  };

  const isJsonBody = body !== undefined && !(body instanceof FormData);
  if (isJsonBody) {
    finalHeaders["content-type"] = "application/json";
  }

  let cookieHeader = cookie ?? "";
  if (forwardCookies !== false && typeof window === "undefined" && !cookieHeader) {
    try {
      const h = await headers();
      const c = h.get("cookie");
      if (c) cookieHeader = c;
    } catch {
      // headers() unavailable outside request scope; ignore
    }
  }
  if (cookieHeader) finalHeaders.cookie = cookieHeader;

  const init: RequestInit & { next?: typeof next } = {
    ...rest,
    headers: finalHeaders,
  };
  if (body !== undefined) {
    init.body = isJsonBody ? JSON.stringify(body) : (body as BodyInit);
  }
  if (next) init.next = next;

  const res = await fetch(url, init);

  const text = await res.text();
  const data: unknown = text ? safeJsonParse(text) : null;

  if (!res.ok) {
    const errBody =
      data && typeof data === "object" && "error" in (data as Record<string, unknown>)
        ? (data as ApiErrorBody)
        : { error: { code: "HTTP_ERROR", message: res.statusText } };
    throw new ApiError(res.status, errBody);
  }

  return data as T;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
