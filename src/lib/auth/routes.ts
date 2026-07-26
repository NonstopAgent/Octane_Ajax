/** App routes that require an authenticated Supabase session. */
export const PROTECTED_PATHS = [
  "/dashboard",
  "/factory",
  "/review",
  "/agents",
  "/businesses",
  "/settings",
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Where post-login redirects land when `next` is missing or untrusted. */
export const DEFAULT_POST_LOGIN_PATH = "/factory";

/**
 * The only sanctioned way to turn an untrusted `?next=` into a redirect target.
 *
 * 2026-07-25 audit, M5: both the auth callback and the login form took `next`
 * straight from the query string. The callback did `redirect(`${origin}${next}`)`,
 * and string concatenation onto an origin is NOT a same-origin guarantee —
 * `?next=@evil.com` produces `https://octane-ajax.vercel.app@evil.com`, where
 * everything before the `@` is userinfo and the host is **evil.com**. The
 * attack lands the victim on the attacker's page immediately after a genuinely
 * successful login, with the real session cookie already set — which is
 * exactly when a credential re-prompt is most believable.
 *
 * Rules, in order:
 *   - must be a path, not a URL (`/…`) → blocks `https://evil.com`, `@evil.com`
 *   - must not start with `//` → blocks protocol-relative `//evil.com`
 *   - must not contain a backslash → some parsers treat `\` as `/`
 *   - must be a known protected app path → blocks open-ended internal probing
 *     and keeps the allowlist in one place
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_POST_LOGIN_PATH,
): string {
  if (!raw) return fallback;
  const value = raw.trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  // Compare the path only — a `?tab=` or `#anchor` on a protected path is fine.
  const path = value.split(/[?#]/)[0];
  return isProtectedPath(path) ? value : fallback;
}
