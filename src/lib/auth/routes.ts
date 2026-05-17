/** App routes that require an authenticated Supabase session. */
export const PROTECTED_PATHS = [
  "/dashboard",
  "/factory",
  "/review",
  "/agents",
  "/settings",
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
