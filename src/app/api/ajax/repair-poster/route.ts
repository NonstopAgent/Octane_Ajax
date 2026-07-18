/**
 * POST /api/ajax/repair-poster — poster/print repair: square art on a 2:3
 * print area either floats with empty bands or gets cropped. This extends
 * the artwork itself to a 2:3 portrait canvas (background continued by the
 * image model, original composition untouched), swaps it onto the Printify
 * product, normalizes placement to full bleed, republishes, and holds the
 * Etsy listing inactive pending media verification.
 *
 * Body: { printifyProductId: string, etsyListingId?: string }
 */
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { createPrintifyAdapter } from "@/lib/ajax/adapters/printify";
import { createImageGeneratorAdapter } from "@/lib/ajax/adapters/image-generator";
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
    };
    if (!body.printifyProductId?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Pass printifyProductId." },
        { status: 400 },
      );
    }
    const productId = body.printifyProductId.trim();

    const printify = createPrintifyAdapter();
    const details = await printify.getProduct(productId);
    const art = await printify.getProductArtwork(productId);
    if (!art.data.src) {
      return NextResponse.json(
        { ok: false, error: "Print-area artwork has no source URL to extend." },
        { status: 422 },
      );
    }

    const alreadyPortrait =
      art.data.width != null &&
      art.data.height != null &&
      art.data.height > 0 &&
      art.data.width / art.data.height < 0.8;

    let artworkSwapped = false;
    if (!alreadyPortrait) {
      const artRes = await fetch(art.data.src);
      if (!artRes.ok) {
        throw new Error(`Artwork download failed (${artRes.status}).`);
      }
      const artBuffer = Buffer.from(await artRes.arrayBuffer());

      const generator = createImageGeneratorAdapter();
      const extended = await generator.extendArtToPortrait({
        artImage: artBuffer,
        productTitle: details.data.title,
      });
      if (!extended.data.imageBase64) {
        throw new Error("Portrait extension returned empty image.");
      }

      const upload = await printify.uploadArtwork({
        fileName: `art-2x3-${productId.slice(0, 8)}.png`,
        imageUrl: `data:image/png;base64,${extended.data.imageBase64}`,
      });
      await printify.updateProductContent(productId, {
        artworkUploadId: upload.data.uploadId,
      });
      artworkSwapped = true;
    }

    // Normalize placement — with 2:3 art on a 2:3 area this lands full bleed.
    await new Promise((r) => setTimeout(r, 1500));
    const fix = await printify.fixPrintPlacement(productId);

    await new Promise((r) => setTimeout(r, 2000));
    await printify.publishProduct(productId);

    let forcedInactive = false;
    if (body.etsyListingId?.trim()) {
      try {
        const credentials = await refreshEtsyToken(user.id, { supabase });
        if (credentials) {
          const etsy = createEtsyAdapter();
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
          `[repair-poster] could not force listing ${body.etsyListingId} inactive:`,
          stateErr instanceof Error ? stateErr.message : stateErr,
        );
      }
    }

    await supabase.from(TABLES.EVENTS).insert({
      user_id: user.id,
      event_type: "poster_art_repaired",
      message: `Poster art ${artworkSwapped ? "extended to 2:3 and swapped" : "already portrait"} on Printify ${productId}; placement ${fix.data.changed ? "normalized" : "unchanged"}; republished${forcedInactive ? "; held inactive pending media rebuild" : ""}.`,
      agent_slug: "forge",
      room: "storefront",
      metadata: {
        printifyProductId: productId,
        etsyListingId: body.etsyListingId ?? null,
        artworkSwapped,
        fix: fix.data,
        forcedInactive,
      } as never,
    });

    return NextResponse.json({
      ok: true,
      artworkSwapped,
      fix: fix.data,
      forcedInactive,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
