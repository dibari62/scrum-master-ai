import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NextAuthConfig } from "next-auth";
// Bare type import: module augmentation below only resolves if the module is
// referenced in this file.
import type {} from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";

import { findInitialMembership, findUserForSignIn, getDatabase, schema } from "@/db";
import { signInInputSchema, userIdSchema, type OrganizationRole } from "@/domain";

import { spendVerificationTime, verifyPassword } from "../password";

/**
 * Auth.js configuration (ADR-0006).
 *
 * Sessions are JWTs: the credentials provider requires it, and it keeps a
 * database round trip off every request — which matters on Neon Free, where
 * that round trip may land on a cold start.
 */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
    };
    /** `null` for a user who belongs to no organization yet. */
    organizationId: string | null;
    role: OrganizationRole | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    organizationId?: string | null;
    role?: OrganizationRole | null;
  }
}

/**
 * Email and password.
 *
 * `authorize` returns `null` for every failure without distinguishing them:
 * telling an unknown address apart from a wrong password turns the sign-in
 * form into a way to test which addresses are registered.
 */
const credentialsProvider = Credentials({
  name: "Credenziali",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  authorize: async (raw) => {
    const parsed = signInInputSchema.safeParse(raw);
    if (!parsed.success) return null;

    const { email, password } = parsed.data;
    const record = await findUserForSignIn(getDatabase(), email);

    if (!record) {
      // Same work as a real check, so the response time does not reveal
      // whether the address exists.
      await spendVerificationTime(password);
      return null;
    }

    if (!(await verifyPassword(password, record.passwordHash))) return null;

    return { id: record.id, email: record.email, name: record.name };
  },
});

/**
 * GitHub is registered only when its credentials exist.
 *
 * Local development must work without anyone creating an OAuth application
 * first; an unconfigured provider would otherwise fail at the moment someone
 * clicks the button. The interface asks the same question before drawing it.
 */
export function isGitHubConfigured(): boolean {
  return (
    Boolean(process.env["AUTH_GITHUB_ID"]) && Boolean(process.env["AUTH_GITHUB_SECRET"])
  );
}

function providers(): NextAuthConfig["providers"] {
  return isGitHubConfigured() ? [credentialsProvider, GitHub] : [credentialsProvider];
}

/**
 * Built per request rather than at module load.
 *
 * The adapter needs a database, and resolving one at import time would make
 * `next build` fail wherever `DATABASE_URL` is not set — including a checkout
 * with no `.env.local`.
 */
export function authConfig(): NextAuthConfig {
  const db = getDatabase();

  return {
    adapter: DrizzleAdapter(db, {
      usersTable: schema.users,
      accountsTable: schema.accounts,
    }),
    session: { strategy: "jwt" },
    trustHost: true,
    // Our own pages, in Italian, instead of the built-in English ones.
    pages: { signIn: "/accedi" },
    providers: providers(),
    callbacks: {
      /**
       * The tenant is resolved once, when the token is issued. Re-reading it on
       * every request is exactly the cost the JWT session avoids.
       *
       * The consequence is recorded in ADR-0006: removing a membership does not
       * end an existing session until the token expires.
       */
      jwt: async ({ token, user }) => {
        if (!user?.id) return token;

        const userId = userIdSchema.parse(user.id);
        const membership = await findInitialMembership(db, userId);

        token.userId = userId;
        token.organizationId = membership?.organizationId ?? null;
        token.role = membership?.role ?? null;

        return token;
      },

      session: ({ session, token }) => {
        if (token.userId) session.user.id = token.userId;
        session.organizationId = token.organizationId ?? null;
        session.role = token.role ?? null;

        return session;
      },
    },
  };
}
