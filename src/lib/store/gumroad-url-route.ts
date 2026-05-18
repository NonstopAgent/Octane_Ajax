import { NextResponse } from "next/server";
import {
  saveManualListingCheckoutUrl,
  StorePublishError,
} from "@/lib/store/publish";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

export type GumroadUrlRouteDependencies = {
  createSupabaseClient?: typeof createClient;
};

/** PATCH /api/ajax/listings/[id]/gumroad-url — body: { gumroadUrl: string } */
export async function handleGumroadUrlPatch(
  request: Request,
  context: RouteContext,
  deps: GumroadUrlRouteDependencies = {},
) {
  const { id: listingId } = await context.params;
  const supabase = await (deps.createSupabaseClient ?? createClient)();
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

  try {
    const result = await saveManualListingCheckoutUrl(
      supabase,
      user.id,
      listingId,
      body.gumroadUrl,
    );
    return NextResponse.json({
      ok: true,
      listing: result.listing,
      gumroadUrl: result.listing.gumroadUrl,
      message: result.message,
    });
  } catch (err) {
    if (err instanceof StorePublishError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: err.statusCode },
      );
    }

    console.error("[listings/gumroad-url]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to save checkout URL." },
      { status: 500 },
    );
  }
}
