import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { signIn } from "@/lib/auth";
import { SignUpRequestSchema, jsonError, jsonRaw } from "@/lib/types/api";
import { log } from "@/lib/log";

export const runtime = "nodejs";

const BCRYPT_COST = 12;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(422, "INVALID_INPUT");
  }

  const parsed = SignUpRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? "_";
      if (!(key in fields)) fields[key] = issue.message;
    }
    return jsonError(422, "INVALID_INPUT", undefined, fields);
  }

  const email = parsed.data.email.toLowerCase();
  const { password, name } = parsed.data;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return jsonError(
      409,
      "EMAIL_TAKEN",
      "An account already exists for this email",
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const newId = crypto.randomUUID();
  await db.insert(users).values({
    id: newId,
    email,
    name: name ?? null,
    passwordHash,
    emailVerified: null,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  log.info({ userId: newId, email }, "user created");

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch (err) {
    log.error({ err, userId: newId }, "post-signup signIn failed");
    return jsonError(500, "PROVIDER_FAILED", "Sign-in after signup failed");
  }

  return jsonRaw(
    { user: { id: newId, email, name: name ?? null } },
    201,
  );
}