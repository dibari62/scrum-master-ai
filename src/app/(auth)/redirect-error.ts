/**
 * Recognises the error Next.js throws to perform a redirect.
 *
 * `redirect()` reports success by throwing, so any `catch` around code that
 * redirects — such as Auth.js `signIn` — catches the success path as well.
 * Every handler has to let this one through before deciding that something
 * went wrong.
 *
 * Written here rather than imported from `next/dist/client/components/…`:
 * Next.js exposes no public predicate, and reaching into its internals means
 * a silent breakage on a minor upgrade. The `NEXT_REDIRECT` digest is part of
 * the contract between server and client, so matching on it is the stable
 * choice — and, unlike the internal import, it can be tested.
 */
const REDIRECT_DIGEST_PREFIX = "NEXT_REDIRECT";

export function isRedirectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("digest" in error)) return false;

  const { digest } = error as { digest: unknown };

  return typeof digest === "string" && digest.startsWith(REDIRECT_DIGEST_PREFIX);
}
