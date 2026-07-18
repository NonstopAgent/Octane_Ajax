/**
 * POST /api/ajax/repair-listing — placement surgery for one defective listing.
 *
 * Steps: normalize the Printify print placement (contain-fit, centered,
 * unrotated — undoing the scale:1 defect), optionally republish so the
 * corrected mockups sync to the bound Etsy listing, then force the listing
 * back to INACTIVE (Printify publish can reactivate it; nothing goes live
 * until media is rebuilt and verified).
 *
 * Body: { printifyProductId: string, etsyListingId?: string,
 *         publish?: boolean (default true) }
 */
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { createPrintifyAdapter } from "@/lib/ajax/adapters/printify";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

export async function POST(req: Request) {
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
      printifyProductId?: string;
      etsyListingId?: string;
      publish?: boolean;
    };
    if (!body.printifyProductId?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Pass printifyProductId." },
        { status: 400 },
      );
    }
    const productId = body.printifyProductId.trim();
    const publish = body.publish !== false;

    const printify = createPrintifyAdapter();
    const fix = await printify.fixPrintPlacement(productId);

    let published = false;
    let forcedInactive = false;
    if (publish) {
      // Give Printify a beat to accept the placement update before publish.
      await new Promise((r) => setTimeout(r, 2000));
      await printify.publishProduct(productId);
      published = true;

      // Publish can flip the Etsy listing live — force it back to inactive
      // until the media rebuild passes verification.
      if (body.etsyListingId?.trim()) {
        try {
          const credentials = await refreshEtsyToken(user.id, { supabase });
          if (credentials) {
            const etsy = createEtsyAdapter();
            // Etsy needs a moment to apply the publish before a state change.
            await new Promise((r) => setTimeout(r, 3000));
            await etsy.updateListing(
              credentials.shop_id,
              body.etsyListingId.trim(),
              credentials.access_token,
              { state: "inactive" },
            );
            forcedInactive = true;
          }
        } catch (stateErr) {
          console.warn(
            `[repair] could not force listing ${body.etsyListingId} inactive:`,
            stateErr instanceof Error ? stateErr.message : stateErr,
          );
        }
      }
    }

    await supabase.from(TABLES.EVENTS).insert({
      user_id: user.id,
      event_type: "listing_placement_repaired",
      message: `Placement ${fix.data.changed ? "normalized" : "already correct"} on Printify ${productId}${published ? "; republished" : ""}${forcedInactive ? "; listing held inactive pending media rebuild" : ""}.`,
      agent_slug: "forge",
      room: "storefront",
      metadata: {
        printifyProductId: productId,
        etsyListingId: body.etsyListingId ?? null,
        fix: fix.data,
        published,
        forcedInactive,
      } as never,
    });

    return NextResponse.json({
      ok: true,
      fix: fix.data,
      published,
      forcedInactive,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
