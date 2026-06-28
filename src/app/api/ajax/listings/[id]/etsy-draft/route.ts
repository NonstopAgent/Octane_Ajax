/**
 * POST /api/ajax/listings/[id]/etsy-draft
 *
 * Manually (re)create the Etsy DRAFT for an approved listing. Same work the
 * background post-approval step does, exposed so the operator can retry when the
 * automatic attempt failed (e.g., approved before Etsy was connected). Requires
 * the product's artwork mockup to be ready and Etsy to be connected.
 */
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { mapListingFromDb } from "@/lib/ajax/mappers";
import { mapGenerationFromDb } from "@/lib/product/mappers";
import { publishListingViaPrintify } from "@/lib/review/printify-publish-on-approve";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: listingRow, error: listingError } = await supabase
    .from(TABLES.LISTINGS)
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (listingError || !listingRow) {
    return NextResponse.json(
      { ok: false, error: "Listing not found." },
      { status: 404 },
    );
  }

  const { data: genRow } = await supabase
    .from(TABLES.GENERATIONS)
    .select("*")
    .eq("user_id", user.id)
    .eq("product_listing_id", id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  try {
    const result = await publishListingViaPrintify({
      supabase,
      userId: user.id,
      listingId: id,
      listing: mapListingFromDb(listingRow),
      generation: genRow ? mapGenerationFromDb(genRow) : null,
    });

    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Publish failed. Confirm the product finished fulfillment (Printify product created) and that your Etsy shop is connected inside Printify, then try again.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, etsyUrl: result.url });
  } catch (err) {
    console.error("[listings/etsy-draft]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to create Etsy draft." },
      { status: 500 },
    );
  }
}
