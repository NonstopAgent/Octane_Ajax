import { NextResponse } from "next/server";
import { fetchFactorySnapshot } from "@/lib/factory/queries";
import { createClient } from "@/lib/supabase/server";

/** GET /api/ajax/factory-snapshot — refresh factory floor data for the signed-in user. */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const snapshot = await fetchFactorySnapshot(supabase, user.id);
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (err) {
    console.error("[factory-snapshot]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load factory snapshot." },
      { status: 500 },
    );
  }
}
