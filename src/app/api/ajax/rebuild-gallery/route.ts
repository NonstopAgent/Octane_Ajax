/**
 * POST /api/ajax/rebuild-gallery — pad a listing's Etsy gallery with the
 * product's own Printify mockups. Printify's publish sync doesn't reliably
 * push the full mockup selection to existing listings (three repaired
 * listings stayed at 2 photos), and the heal path only enforces a 2-photo
 * floor. This uploads a varied mockup set (front + angles + context) until
 * the gallery reaches the target.
 *
 * Body: { printifyProductId: string, etsyListingId: string, target?: number }
 */
export const maxDuration = 180;

import { NextResponse } from "next/server";
import {
  createPrintifyAdapter,
  pickMockupImages,
} from "@/lib/ajax/adapters/printify";
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
      target?: number;
    };
    if (!body.printifyProductId?.trim() || !body.etsyListingId?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Pass printifyProductId and etsyListingId." },
        { status: 400 },
      );
    }
    const listingId = body.etsyListingId.trim();
    const target = Math.min(Math.max(body.target ?? 8, 2), 10);

    const credentials = await refreshEtsyToken(user.id, { supabase });
    if (!credentials) {
      return NextResponse.json(
        { ok: false, error: "Etsy shop not connected." },
        { status: 500 },
      );
    }
    const etsy = createEtsyAdapter();
    const printify = createPrintifyAdapter();

    const beforeImages = await etsy.getListingImages(
      listingId,
      credentials.access_token,
    );
    const existingCount = beforeImages.length;
    if (existingCount >= target) {
      return NextResponse.json({
        ok: true,
        uploaded: 0,
        galleryCount: existingCount,
        note: "gallery already at target",
      });
    }

    const details = await printify.getProduct(body.printifyProductId.trim());
    const picks = pickMockupImages(details.data.images ?? [], target);
    // Existing photos are almost always the front mockups Printify synced —
    // skip the front-most picks that duplicate them and upload the rest.
    const candidates = picks.slice(existingCount > 0 ? 1 : 0);

    let uploaded = 0;
    const errors: string[] = [];
    for (const pick of candidates) {
      if (existingCount + uploaded >= target) break;
      try {
        const imgRes = await fetch(pick.image.src);
        if (!imgRes.ok) throw new Error(`download ${imgRes.status}`);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        await etsy.uploadListingImage(
          listingId,
          buffer,
          `mockup-${uploaded + 2}.jpg`,
          credentials.shop_id,
          credentials.access_token,
          existingCount + uploaded + 1,
        );
        uploaded += 1;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "upload failed");
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    const afterImages = await etsy.getListingImages(
      listingId,
      credentials.access_token,
    );
    const afterCount = afterImages.length;

    await supabase.from(TABLES.EVENTS).insert({
      user_id: user.id,
      event_type: "gallery_rebuilt",
      message: `Gallery rebuilt for listing ${listingId}: ${existingCount} → ${afterCount} photos (${uploaded} uploaded).`,
      agent_slug: "forge",
      room: "storefront",
      metadata: {
        etsyListingId: listingId,
        printifyProductId: body.printifyProductId,
        before: existingCount,
        uploaded,
        after: afterCount,
        errors,
      } as never,
    });

    return NextResponse.json({
      ok: true,
      uploaded,
      galleryCount: afterCount,
      errors,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
