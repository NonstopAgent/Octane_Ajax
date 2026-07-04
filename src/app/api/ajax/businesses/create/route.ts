import { NextResponse } from "next/server";
import { createBusiness } from "@/lib/businesses/queries";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
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

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      niche?: string;
      brand?: string;
    };

    if (!body.name || !body.name.trim()) {
      return NextResponse.json(
        { ok: false, error: "Business name is required." },
        { status: 400 },
      );
    }

    const business = await createBusiness(supabase, user.id, {
      name: body.name,
      niche: body.niche ?? null,
      brand: body.brand ?? null,
    });

    if (!business) {
      return NextResponse.json(
        { ok: false, error: "Could not create business." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, business });
  } catch (err) {
    console.error("[businesses/create] error", err);
    return NextResponse.json(
      { ok: false, error: "Create failed." },
      { status: 500 },
    );
  }
}
