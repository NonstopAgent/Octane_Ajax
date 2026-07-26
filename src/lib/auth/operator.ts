/**
 * Single-operator authorization (2026-07-25 audit, H10).
 *
 * `supabase.auth.getUser()` proves "signed in", not "allowed": signup is
 * browser-reachable, and the /api/ajax surface drives ONE live shop on
 * process-wide Printify/Etsy/OpenAI credentials — so any self-registered
 * account could previously enumerate products (printify-map), run paid
 * artwork edits (repair-poster), and republish corrupted art to Etsy
 * (repair-listing). Authorization now requires the caller to BE the
 * operator, matching how the cron routes already resolve identity.
 *
 * OPERATOR_EMAIL unset fails CLOSED (503) on operator-only routes — same
 * fail-closed posture the cron auth got on 2026-07-24.
 */

export type OperatorCheck =
  | { ok: true }
  | { ok: false; status: 403 | 503; error: string };

export function requireOperator(
  user: { email?: string | null } | null | undefined,
): OperatorCheck {
  const operatorEmail = process.env.OPERATOR_EMAIL?.trim().toLowerCase();
  if (!operatorEmail) {
    return {
      ok: false,
      status: 503,
      error:
        "OPERATOR_EMAIL not configured — operator-only routes are disabled until it is set.",
    };
  }
  const email = user?.email?.trim().toLowerCase();
  if (!email || email !== operatorEmail) {
    return {
      ok: false,
      status: 403,
      error: "Operator-only route.",
    };
  }
  return { ok: true };
}
