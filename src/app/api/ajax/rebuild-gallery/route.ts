/**
 * POST /api/ajax/rebuild-gallery — rebuild a listing's Etsy gallery from the
 * product's CURRENT Printify mockups.
 *
 * Modes:
 *  - wipe (default): upload the full fresh mockup set, then DELETE every
 *    pre-existing photo. Printify regenerates mockups slowly after a
 *    placement fix, so galleries synced at publish time can mix fresh fronts
 *    with STALE BROKEN context shots (the 2026-07-17 relist mistake: two
 *    listings went live with old sheared/backward renders still in the
 *    gallery). Stale photos never self-heal — they must go.
 *  - append (wipe:false): legacy padding toward the target only.
 *
 * Freshness gate: wipe refuses to run until Printify serves >= minPicks
 * distinct mockups (regeneration still in progress = leave the gallery
 * alone and report, never rebuild from a half-rendered set).
 *
 * Body: { printifyProductId, etsyListingId, wipe?: boolean, target?: number }
 */
export const maxDuration = 300;

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
      wipe?: boolean;
      target?: number;
    };
    if (!body.printifyProductId?.trim() || !body.etsyListingId?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Pass printifyProductId and etsyListingId." },
        { status: 400 },
      );
    }
    const listingId = body.etsyListingId.trim();
    const wipe = body.wipe !== false;
    const target = Math.min(Math.max(body.target ?? 8, 2), 10);
    const minPicks = 4;

    const credentials = await refreshEtsyToken(user.id, { supabase });
    if (!credentials) {
      return NextResponse.json(
        { ok: false, error: "Etsy shop not connected." },
        { status: 500 },
      );
    }
    const etsy = createEtsyAdapter();
    const printify = createPrintifyAdapter();

    const staleIds = [
      ...(await etsy.getListingImages(listingId, credentials.access_token)),
    ];

    const details = await printify.getProduct(body.printifyProductId.trim());
    const picks = pickMockupImages(details.data.images ?? [], target);

    if (wipe && picks.length < minPicks) {
      return NextResponse.json(
        {
          ok: false,
          notReady: true,
          error: `Printify serves only ${picks.length} mockup(s) — regeneration still in progress; gallery left untouched.`,
        },
        { status: 422 },
      );
    }

    const uploadSet = wipe ? picks : picks.slice(staleIds.length > 0 ? 1 : 0);
    let uploaded = 0;
    const errors: string[] = [];

    // Etsy caps listings at 20 images. If the stale set + fresh set would
    // overflow (one legacy poster sat at 20/20 and every upload bounced),
    // clear room FIRST — delete stale from the back, always keeping one so
    // the listing never hits zero images.
    let preDeleted = 0;
    if (wipe && staleIds.length + uploadSet.length > 20) {
      const room = staleIds.length + uploadSet.length - 20;
      const removable = staleIds.slice(1).slice(-Math.min(room, staleIds.length - 1));
      for (const staleId of removable) {
        try {
          await etsy.deleteListingImage(
            listingId,
            staleId,
            credentials.shop_id,
            credentials.access_token,
          );
          preDeleted += 1;
          staleIds.splice(staleIds.indexOf(staleId), 1);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : "pre-delete failed");
        }
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    for (const pick of uploadSet) {
      if (!wipe && staleIds.length + uploaded >= target) break;
      try {
        const imgRes = await fetch(pick.image.src);
        if (!imgRes.ok) throw new Error(`download ${imgRes.status}`);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        await etsy.uploadListingImage(
          listingId,
          buffer,
          `mockup-${uploaded + 1}.jpg`,
          credentials.shop_id,
          credentials.access_token,
          uploaded + 1,
        );
        uploaded += 1;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "upload failed");
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    let deleted = 0;
    if (wipe && uploaded >= minPicks) {
      // Fresh set is in place — now remove every stale photo. Uploads went
      // in FIRST so the listing never hits zero images (Etsy requirement).
      for (const staleId of staleIds) {
        try {
          await etsy.deleteListingImage(
            listingId,
            staleId,
            credentials.shop_id,
            credentials.access_token,
          );
          deleted += 1;
        } catch (err) {
          errors.push(err instanceof Error ? err.message : "delete failed");
        }
        await new Promise((r) => setTimeout(r, 350));
      }
    } else if (wipe && uploaded < minPicks) {
      errors.push(
        `only ${uploaded} fresh upload(s) succeeded — stale photos kept to avoid an empty gallery`,
      );
    }

    const afterCount = (
      await etsy.getListingImages(listingId, credentials.access_token)
    ).length;

    await supabase.from(TABLES.EVENTS).insert({
      user_id: user.id,
      event_type: "gallery_rebuilt",
      message: `Gallery ${wipe ? "wiped & rebuilt" : "padded"} for listing ${listingId}: ${staleIds.length} → ${afterCount} photos (${uploaded} fresh, ${deleted} stale removed).`,
      agent_slug: "forge",
      room: "storefront",
      metadata: {
        etsyListingId: listingId,
        printifyProductId: body.printifyProductId,
        wipe,
        before: staleIds.length + preDeleted,
        uploaded,
        deleted: deleted + preDeleted,
        after: afterCount,
        errors,
      } as never,
    });

    return NextResponse.json({
      ok: true,
      uploaded,
      deleted,
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
