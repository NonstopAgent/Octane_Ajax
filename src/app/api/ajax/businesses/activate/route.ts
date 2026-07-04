import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACTIVE_BUSINESS_COOKIE } from "@/lib/businesses/active";
import { fetchBusinesses } from "@/lib/businesses/queries";
import { createClient } from "@/lib/supabase/server";

/** POST /api/ajax/businesses/activate — sets which business new production is attributed to. */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as { businessId?: string };
    if (!body.businessId) {
      return NextResponse.json(
        { ok: false, error: "businessId required" },
        { status: 400 },
      );
    }

    const list = await fetchBusinesses(supabase, user.id);
    if (!list.some((b) => b.id === body.businessId)) {
      return NextResponse.json(
        { ok: false, error: "Business not found" },
        { status: 404 },
      );
    }

    const store = await cookies();
    store.set(ACTIVE_BUSINESS_COOKIE, body.businessId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[businesses/activate] error", err);
    return NextResponse.json(
      { ok: false, error: "Activate failed." },
      { status: 500 },
    );
  }
}
