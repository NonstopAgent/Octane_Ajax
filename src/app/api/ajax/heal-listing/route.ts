/**
 * POST /api/ajax/heal-listing — operator-triggered INSTANT enrichment for one
 * listing (photos floor + video enqueue), instead of waiting for the hourly
 * rotation to reach its batch. Body: { "etsyListingId": "123..." } or
 * { "listingId": "<uuid>" }.
 *
 * Born from a real incident: two mugs sat at 1 photo on a Sunday evening and
 * the operator had to watch Etsy flag them until their batch came up. Never
 * again — anything visibly broken must be fixable NOW.
 */
export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import { createPrintifyAdapter } from "@/lib/ajax/adapters/printify";
import { enrichEtsyListingAfterPublish } from "@/lib/review/printify-publish-on-approve";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized. Sign in first." },
        { status: 401 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      etsyListingId?: string;
      listingId?: string;
    };
    if (!body.etsyListingId && !body.listingId) {
      return NextResponse.json(
        { ok: false, error: "Pass etsyListingId or listingId." },
        { status: 400 },
      );
    }

    let query = supabase
      .from(TABLES.LISTINGS)
      .select("id, title, gumroad_product_id, product_generations ( structure )")
      .eq("user_id", user.id);
    query = body.listingId
      ? query.eq("id", body.listingId)
      : query.eq("gumroad_product_id", body.etsyListingId!);
    const { data: row, error } = await query.maybeSingle();

    if (error || !row) {
      return NextResponse.json(
        { ok: false, error: error?.message ?? "Listing not found." },
        { status: 404 },
      );
    }

    const generations =
      row.product_generations == null
        ? []
        : Array.isArray(row.product_generations)
          ? row.product_generations
          : [row.product_generations];
    const fulfillment = (
      generations[0]?.structure as {
        metadata?: { fulfillment?: { printifyProductId?: string } };
      } | null
    )?.metadata?.fulfillment;
    const printifyProductId = fulfillment?.printifyProductId?.trim();
    if (!printifyProductId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Listing has no Printify fulfillment id in its generation structure.",
        },
        { status: 422 },
      );
    }

    const outcome = await enrichEtsyListingAfterPublish(
      supabase,
      user.id,
      row.id,
      printifyProductId,
      createPrintifyAdapter(),
      { bindingAttempts: 1 },
    );

    return NextResponse.json({
      ok: true,
      listing: { id: row.id, title: row.title },
      outcome,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
