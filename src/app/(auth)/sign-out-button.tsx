import { signOutAction } from "./actions";

/**
 * The sign-out control, shared by every frame that shows the header.
 *
 * A form and not a link: signing out changes state on the server, and a state
 * change does not travel over a GET. A link would be followed by a prefetch, a
 * crawler or an antivirus scanner, and the session would end on its own.
 *
 * It lives under `src/app` because it reaches for a server action, which
 * `src/components` may not do (§4).
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="text-muted-foreground hover:text-foreground cursor-pointer"
      >
        Esci
      </button>
    </form>
  );
}
