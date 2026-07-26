/**
 * GET  /api/ajax/alerts        — unresolved system alerts for the signed-in user
 * POST /api/ajax/alerts        — { kind } dismisses that alert class
 *
 * The read side also lives inside the Mission Control snapshot; this route
 * exists so the banner can dismiss without re-fetching the whole dashboard,
 * and so an alert list is reachable on its own.
 *
 * Session auth only, and every query is scoped by user_id under RLS — an alert
 * is a private note about the operator's own system, not a shop mutation, so
 * this deliberately does not carry the operator gate that write surfaces do.
 */
import { NextResponse, type NextRequest } from "next/server";
import { clearAlert, fetchActiveAlerts } from "@/lib/ajax/alerts";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }
  return NextResponse.json({
    ok: true,
    alerts: await fetchActiveAlerts(supabase, user.id),
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  let kind: unknown = null;
  try {
    kind = ((await req.json()) as { kind?: unknown })?.kind ?? null;
  } catch {
    kind = null;
  }
  if (typeof kind !== "string" || kind.trim() === "") {
    return NextResponse.json(
      { ok: false, error: "Body must be { kind: string }." },
      { status: 400 },
    );
  }

  await clearAlert(supabase, user.id, kind.trim());
  return NextResponse.json({ ok: true, dismissed: kind.trim() });
}
