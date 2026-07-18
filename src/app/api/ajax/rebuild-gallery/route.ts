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
  buildSiblingMockupUrls,
  createPrintifyAdapter,
  pickMockupImages,
} from "@/lib/ajax/adapters/printify";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

/**
 * GET variant — same operation, parameters via query string. Exists because
 * the operator browser-drives repairs and plain navigations are immune to
 * the background-tab JS throttling that kept killing scripted POST drivers.
 * Session-cookie auth applies identically.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams;
  const body = {
    printifyProductId: p.get("pid") ?? undefined,
    etsyListingId: p.get("etsy") ?? undefined,
    wipe: p.get("wipe") !== "false",
    target: p.get("target") ? Number(p.get("target")) : undefined,
    donorProductId: p.get("donor") ?? undefined,
    phase: (p.get("phase") ?? undefined) as "upload" | "cleanup" | undefined,
  };
  return runRebuild(body);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Parameters<
    typeof runRebuild
  >[0];
  return runRebuild(body);
}

async function runRebuild(body: {
  printifyProductId?: string;
  etsyListingId?: string;
  wipe?: boolean;
  target?: number;
  /** Same-blueprint product with a healthy mockup selection. When this
   * product's own API-visible selection has collapsed to 1 (placement
   * updates reset it, and publish can only re-select from what it can
   * see — circular), the donor's camera angles are borrowed by swapping
   * product ids in the CDN paths, yielding THIS product's own renders. */
  donorProductId?: string;
  /** Split-run mode for the ~60s serverless wall: "upload" pushes the fresh
   * set only; "cleanup" deletes everything but the NEWEST `target` images
   * (Etsy image ids increase over time, so newest = the fresh uploads).
   * Omit for the original single-pass behavior. */
  phase?: "upload" | "cleanup";
}) {
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

    if (body.phase === "cleanup") {
      if (!body.etsyListingId?.trim()) {
        return NextResponse.json(
          { ok: false, error: "Pass etsyListingId." },
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
      const ids = await etsy.getListingImages(
        listingId,
        credentials.access_token,
      );
      const newestFirst = [...ids].sort((a, b) => Number(b) - Number(a));
      const toDelete = newestFirst.slice(target);
      let deleted = 0;
      const errors: string[] = [];
      for (const id of toDelete) {
        try {
          await etsy.deleteListingImage(
            listingId,
            id,
            credentials.shop_id,
            credentials.access_token,
          );
          deleted += 1;
        } catch (err) {
          errors.push(err instanceof Error ? err.message : "delete failed");
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      const after = (
        await etsy.getListingImages(listingId, credentials.access_token)
      ).length;
      await supabase.from(TABLES.EVENTS).insert({
        user_id: user.id,
        event_type: "gallery_rebuilt",
        message: `Gallery cleanup for listing ${listingId}: kept newest ${Math.min(target, ids.length)}, removed ${deleted} older photo(s) → ${after} photos.`,
        agent_slug: "forge",
        room: "storefront",
        metadata: {
          etsyListingId: listingId,
          phase: "cleanup",
          before: ids.length,
          deleted,
          after,
          errors,
        } as never,
      });
      return NextResponse.json({ ok: true, deleted, galleryCount: after, errors });
    }

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

    const productId = body.printifyProductId.trim();
    const details = await printify.getProduct(productId);
    const picks = pickMockupImages(details.data.images ?? [], target);
    let sourceUrls = picks.map((p) => p.image.src);
    let usedDonor = false;

    if (sourceUrls.length < minPicks && body.donorProductId?.trim()) {
      const donor = await printify.getProduct(body.donorProductId.trim());
      const candidates = buildSiblingMockupUrls(
        donor.data.images ?? [],
        body.donorProductId.trim(),
        productId,
        target,
      );
      const verified: string[] = [];
      for (const url of candidates) {
        try {
          const head = await fetch(url, { method: "GET" });
          if (head.ok) verified.push(url);
        } catch {
          // skip URLs that don't resolve
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      if (verified.length >= minPicks) {
        // Own front mockup first when we have it, then the donor angles.
        const own = sourceUrls[0];
        sourceUrls = own
          ? [own, ...verified.filter((u) => u !== own)]
          : verified;
        sourceUrls = sourceUrls.slice(0, target);
        usedDonor = true;
      }
    }

    if (wipe && sourceUrls.length < minPicks) {
      return NextResponse.json(
        {
          ok: false,
          notReady: true,
          error: `Printify serves only ${sourceUrls.length} usable mockup(s) — regeneration still in progress; gallery left untouched.`,
        },
        { status: 422 },
      );
    }

    const uploadSet = wipe
      ? sourceUrls
      : sourceUrls.slice(staleIds.length > 0 ? 1 : 0);

    // Prefetch every mockup in PARALLEL. Serial downloads (8 × 2-4s) pushed
    // total runtime past the ~60s serverless wall and upload phases died
    // silently, leaving live listings with 2-3 photos.
    const buffers = await Promise.all(
      uploadSet.map(async (srcUrl) => {
        try {
          const imgRes = await fetch(srcUrl, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!imgRes.ok) return null;
          return Buffer.from(await imgRes.arrayBuffer());
        } catch {
          return null;
        }
      }),
    );
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
    for (const buffer of buffers) {
      if (!wipe && staleIds.length + uploaded >= target) break;
      if (!buffer) {
        errors.push("download failed");
        continue;
      }
      try {
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
      await new Promise((r) => setTimeout(r, 150));
    }

    if (body.phase === "upload") {
      const afterUpload = (
        await etsy.getListingImages(listingId, credentials.access_token)
      ).length;
      await supabase.from(TABLES.EVENTS).insert({
        user_id: user.id,
        event_type: "gallery_rebuilt",
        message: `Gallery upload phase for listing ${listingId}: ${uploaded} fresh photo(s) added (now ${afterUpload}) — cleanup phase next.`,
        agent_slug: "forge",
        room: "storefront",
        metadata: {
          etsyListingId: listingId,
          phase: "upload",
          uploaded,
          preDeleted,
          after: afterUpload,
          usedDonor,
          errors,
        } as never,
      });
      return NextResponse.json({
        ok: true,
        uploaded,
        usedDonor,
        galleryCount: afterUpload,
        errors,
      });
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
        usedDonor,
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
      usedDonor,
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
