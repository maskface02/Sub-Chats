import "server-only";
import NextAuth, { type NextAuthConfig, type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/lib/db/schema";
import { log } from "@/lib/log";
import { allowGuestAccess } from "@/lib/config/flags";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string | null;
      image: string | null;
    };
    expires: string;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/signin",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          log.warn({ reason: "zod" }, "credentials rejected: invalid shape");
          return null;
        }
        const { email, password } = parsed.data;
        const found = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1);
        const user = found[0];
        if (!user || !user.passwordHash) {
          log.warn({ email }, "credentials rejected: unknown user");
          return null;
        }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          log.warn({ email }, "credentials rejected: bad password");
          return null;
        }
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
        };
      },
    }),
  ],
  callbacks: {
    // JWT strategy (credentials requires it — database sessions are
    // unsupported with the Credentials provider in Auth.js v5). Capture the
    // db user id into the token at sign-in, surface it on the session.
    async jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token?.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  events: {
    async signOut(message) {
      if ("session" in message && message.session?.sessionToken) {
        log.info(
          { sessionToken: message.session.sessionToken.slice(0, 8) },
          "session destroyed",
        );
      }
    },
  },
};

export const { handlers, auth: authFn, signIn, signOut } = NextAuth(authConfig);

const GUEST_EMAIL = "guest@localhost";
const FAR_FUTURE_EXPIRES = "9999-12-31T23:59:59.999Z";

declare global {
  // eslint-disable-next-line no-var
  var __guestUserId: string | undefined;
}

/**
 * Ensures the shared guest user row exists (FK target for guest-mode data)
 * and returns its id. Memoized per process — one DB round-trip ever.
 */
async function ensureGuestUserId(): Promise<string> {
  if (globalThis.__guestUserId) return globalThis.__guestUserId;
  await db
    .insert(users)
    .values({ email: GUEST_EMAIL, name: "Guest" })
    .onConflictDoNothing();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, GUEST_EMAIL))
    .limit(1);
  const id = rows[0]!.id;
  globalThis.__guestUserId = id;
  log.info({ guestUserId: id }, "guest access enabled — synthetic session");
  return id;
}

/**
 * Auth entry point used by every route/page.
 * 1. real session (JWT cookie) when present
 * 2. ALLOW_GUEST_ACCESS=true → synthetic guest session (direct access, no login)
 * 3. null (callers redirect to /signin as before)
 */
export async function auth() {
  const session = await authFn();
  if (session?.user?.id) {
    const existing = await db.select({ id: users.id }).from(users)
      .where(eq(users.id, session.user.id)).limit(1);
    // A JWT can outlive a reset database or a deleted account.
    // Never treat it as authorization to create rows for a missing user.
    return existing.length > 0 ? session : null;
  }
  if (allowGuestAccess()) {
    const guestId = await ensureGuestUserId();
    return {
      user: {
        id: guestId,
        email: GUEST_EMAIL,
        name: "Guest",
        image: null,
      },
      expires: FAR_FUTURE_EXPIRES,
    };
  }
  return session;
}
