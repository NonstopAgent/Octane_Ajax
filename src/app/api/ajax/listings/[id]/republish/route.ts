/**
 * Republish an already-fulfilled listing through Printify.
 *
 * POST /api/ajax/listings/:id/republish
 *
 * Maintenance action for the operator: re-runs the Printify→Etsy publish for
 * an EXISTING listing (same Etsy listing id — no new listing fee). Because
 * publishing now selects a varied mockup gallery first, this is the lever to
 * repair listings that went live with a single photo, and to push corrected
 * titles from Printify (source of truth) to Etsy.
 *
 * Auth: operator session (same pattern as the fulfill route).
 */
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { mapListingFromDb } from "@/lib/ajax/mappers";
import { publishListingViaPrintify } from "@/lib/review/printify-publish-on-approve";
import { mapGenerationFromDb } from "@/lib/product/mappers";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: listingId } = await context.params;
    if (!listingId) {
      return NextResponse.json(
        { ok: false, error: "Listing id is required." },
        { status: 400 },
      );
    }

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

    const { data: listingRow, error: listingError } = await supabase
      .from(TABLES.LISTINGS)
      .select("*")
      .eq("id", listingId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (listingError || !listingRow) {
      return NextResponse.json(
        { ok: false, error: "Listing not found." },
        { status: 404 },
      );
    }

    const { data: generationRow, error: generationError } = await supabase
      .from(TABLES.GENERATIONS)
      .select("*")
      .eq("user_id", user.id)
      .eq("product_listing_id", listingId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (generationError) {
      return NextResponse.json(
        { ok: false, error: "Failed to load the listing's generation." },
        { status: 500 },
      );
    }

    const result = await publishListingViaPrintify({
      supabase,
      userId: user.id,
      listingId,
      listing: mapListingFromDb(listingRow),
      generation: generationRow ? mapGenerationFromDb(generationRow) : null,
    });

    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Republish did not complete — see factory events for the reason (missing Printify product or Printify not configured).",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, url: result.url });
  } catch (err) {
    console.error("[listings/republish] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "Republish failed." },
      { status: 500 },
    );
  }
}
