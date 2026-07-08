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
 * Optional JSON body:
 *   { "printifyTitle": "..." }     → fix the Printify product title first
 *   { "artworkUploadId": "..." }   → swap the print-area artwork first; the
 *     route then STOPS (published:false) because Printify regenerates mockups
 *     asynchronously (~60s) — call republish again afterwards to publish.
 *
 * Auth: operator session (same pattern as the fulfill route).
 */
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { createPrintifyAdapter } from "@/lib/ajax/adapters/printify";
import { mapListingFromDb } from "@/lib/ajax/mappers";
import { publishListingViaPrintify } from "@/lib/review/printify-publish-on-approve";
import { mapGenerationFromDb } from "@/lib/product/mappers";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: listingId } = await context.params;
    if (!listingId) {
      return NextResponse.json(
        { ok: false, error: "Listing id is required." },
        { status: 400 },
      );
    }

    const rawBody = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const printifyTitle =
      typeof rawBody.printifyTitle === "string" && rawBody.printifyTitle.trim()
        ? rawBody.printifyTitle.trim()
        : undefined;
    const artworkUploadId =
      typeof rawBody.artworkUploadId === "string" &&
      rawBody.artworkUploadId.trim()
        ? rawBody.artworkUploadId.trim()
        : undefined;

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

    const generation = generationRow
      ? mapGenerationFromDb(generationRow)
      : null;

    // Optional content fixes on the Printify product (source of truth)
    // BEFORE syncing to Etsy.
    if (printifyTitle || artworkUploadId) {
      const printifyProductId =
        generation?.fulfillment?.printifyProductId?.trim();
      if (!printifyProductId) {
        return NextResponse.json(
          { ok: false, error: "Listing has no Printify product to update." },
          { status: 409 },
        );
      }

      const adapter = createPrintifyAdapter();
      const updateResult = await adapter.updateProductContent(
        printifyProductId,
        { title: printifyTitle, artworkUploadId },
      );

      if (printifyTitle) {
        // Keep our DB in step with the corrected title.
        await supabase
          .from(TABLES.LISTINGS)
          .update({ title: printifyTitle })
          .eq("id", listingId)
          .eq("user_id", user.id);
      }

      if (artworkUploadId) {
        // Printify regenerates mockups asynchronously after an artwork swap.
        // Publishing now would sync stale/missing mockups — stop here and let
        // the operator call republish again once the render finishes (~60s).
        return NextResponse.json({
          ok: true,
          published: false,
          updated: updateResult.data.updated,
          note: "Artwork replaced — mockups regenerating. Call republish again (no body) in ~90s to publish.",
        });
      }
    }

    const result = await publishListingViaPrintify({
      supabase,
      userId: user.id,
      listingId,
      listing: mapListingFromDb({
        ...listingRow,
        ...(printifyTitle ? { title: printifyTitle } : {}),
      }),
      generation,
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
