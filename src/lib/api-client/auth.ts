"use server";

import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { signIn, signOut } from "@/lib/auth";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { apiFetch, ApiError } from "./base";
import type { AuthActionResult, CreateChatResponse } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

type FieldErrors = Partial<
  Record<"email" | "password" | "confirmPassword" | "name", string>
>;

async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
  return h.get("x-real-ip") ?? "unknown";
}

export async function signUpAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const name = String(formData.get("name") ?? "").trim() || null;

  const fieldErrors: FieldErrors = {};
  if (!email) fieldErrors.email = "Enter a valid email";
  else if (!EMAIL_RE.test(email)) fieldErrors.email = "Enter a valid email";
  if (!password) fieldErrors.password = "Use at least 8 characters";
  else if (password.length < PASSWORD_MIN)
    fieldErrors.password = "Use at least 8 characters";
  if (password !== confirmPassword)
    fieldErrors.confirmPassword = "Passwords do not match";

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  try {
    await apiFetch(`/api/auth/signup`, {
      method: "POST",
      baseUrl: process.env.AUTH_URL,
      body: { email, password, name },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === "EMAIL_TAKEN") {
        return {
          ok: false,
          fieldErrors: {
            email: "An account already exists for this email",
          },
        };
      }
      if (err.code === "INVALID_INPUT" && err.fields) {
        return { ok: false, fieldErrors: err.fields };
      }
      if (err.code === "RATE_LIMITED") {
        return { ok: false, formError: "Too many attempts. Try again in 15 minutes" };
      }
      return { ok: false, formError: err.message };
    }
    return { ok: false, formError: "Could not create account — try again" };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, formError: "Account created — please sign in" };
    }
    throw err;
  }

  revalidatePath("/");
  redirect("/");
}

export async function signInAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "/") || "/";

  const fieldErrors: FieldErrors = {};
  if (!email) fieldErrors.email = "Enter a valid email";
  else if (!EMAIL_RE.test(email)) fieldErrors.email = "Enter a valid email";
  if (!password) fieldErrors.password = "Enter your password";
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const ip = await getClientIp();
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterMs / 60000);
    return {
      ok: false,
      formError: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.type === "CredentialsSignin") {
        return { ok: false, formError: "Invalid email or password" };
      }
      return { ok: false, formError: "Could not sign in — try again" };
    }
    throw err;
  }

  const safe = callbackUrl.startsWith("/") ? callbackUrl : "/";
  revalidatePath("/");
  redirect(safe);
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirect: false });
  revalidatePath("/");
  redirect("/signin");
}

export async function createChatAction(): Promise<never> {
  const chat = await apiFetch<CreateChatResponse>(`/api/chats`, {
    method: "POST",
    body: {},
    baseUrl: process.env.AUTH_URL,
  });
  revalidatePath("/");
  redirect(`/c/${chat.id}`);
}
