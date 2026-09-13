import { type NextRequest } from "next/server";
import { signOut } from "@/lib/auth";
import { jsonRaw } from "@/lib/types/api";
import { log } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await signOut({ redirect: false });
    return jsonRaw({ ok: true }, 200);
  } catch (err) {
    log.error({ err }, "sign-out failed");
    return jsonRaw(
      { error: { code: "PROVIDER_FAILED", message: "Sign-out failed" } },
      500,
    );
  }
}