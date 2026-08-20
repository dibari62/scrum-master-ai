import NextAuth from "next-auth";

import { authConfig } from "./config";

/**
 * The Auth.js entry points.
 *
 * The configuration is passed as a function so nothing touches the database
 * until a request arrives (see `authConfig`).
 *
 * Registration deliberately lives in `./registration` and is **not** re-exported
 * here: it needs no part of Auth.js, and pulling this module in would drag the
 * whole framework — `next/server` included — into anything that imports it.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => authConfig());
