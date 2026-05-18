import { NextResponse } from "next/server";
import {
  publishListingWithGumroad,
  StorePublishError,
} from "@/lib/store/publish";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/** POST /api/ajax/listings/[id]/publish — body: { gumroadUrl: string } */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: listingId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { gumroadUrl?: string };
    if (!body.gumroadUrl?.trim()) {
      return NextResponse.json(
        { ok: false, error: "gumroadUrl is required." },
        { status: 400 },
      );
    }

    const result = await publishListingWithGumroad(
      supabase,
      user.id,
      listingId,
      body.gumroadUrl,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof StorePublishError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: err.statusCode },
      );
    }

    console.error("[listings/publish]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to publish listing." },
      { status: 500 },
    );
  }
}
