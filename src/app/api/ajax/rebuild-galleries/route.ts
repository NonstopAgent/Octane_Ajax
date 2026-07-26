// GALLERY DESIGN REBUILD (2026-07-24, operator escalation): several
// listings mixed photos from DIFFERENT design generations because the
// healer only ever APPENDED current renders around stale ones. This
// one-shot rebuilds a listing's gallery deterministically: upload the
// product's CURRENT render set first (donor-angle swap when Printify
// exposes only one selected mockup, vision-probed before trust), THEN
// delete every pre-existing photo. Upload-before-delete keeps the listing
// legal (Etsy requires >=1 image) at every moment.
//
// ?only=etsyId1,etsyId2 limits the pass (operator's flagged listings run
// first). Session auth; navigation-friendly GET.
export const maxDuration = 600;

import { NextResponse } from "next/server";
import {
  buildSiblingMockupUrls,
  createPrintifyAdapter,
  pickMockupImages,
  MAX_PUBLISH_MOCKUPS,
} from "@/lib/ajax/adapters/printify";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { visionCheckProductMockup } from "@/lib/review/mockup-vision-qa";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";
import { requireOperator } from "@/lib/auth/operator";

type GenerationJoin = {
  structure: {
    metadata?: { fulfillment?: { printifyProductId?: string } };
  } | null;
};

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 },
      );
    }

    // Operator-only (2026-07-25 audit, H10): signed-in is not authorized —
    // this surface mutates the ONE live shop on process-wide credentials.
    const operatorCheck = requireOperator(user);
    if (!operatorCheck.ok) {
      return NextResponse.json(
        { ok: false, error: operatorCheck.error },
        { status: operatorCheck.status },
      );
    }
    const credentials = await refreshEtsyToken(user.id, { supabase });
    if (!credentials) {
      return NextResponse.json(
        { ok: false, error: "Etsy shop not connected." },
        { status: 400 },
      );
    }
    const only = (new URL(request.url).searchParams.get("only") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const { data: rows } = await supabase
      .from(TABLES.LISTINGS)
      .select(
        "id, title, gumroad_product_id, product_generations ( structure )",
      )
      .eq("user_id", user.id)
      .eq("status", "published")
      .limit(100);

    const printify = createPrintifyAdapter();
    const etsy = createEtsyAdapter();
    const done: { listing: string; uploaded: number; deleted: number }[] = [];
    const skipped: { listing: string; reason: string }[] = [];
    const failed: { listing: string; error: string }[] = [];

    for (const row of rows ?? []) {
      const etsyId = String(row.gumroad_product_id ?? "");
      if (!/^\d+$/.test(etsyId)) continue;
      if (only.length > 0 && !only.includes(etsyId)) continue;
      try {
        const generations = (
          row.product_generations == null
            ? []
            : Array.isArray(row.product_generations)
              ? row.product_generations
              : [row.product_generations]
        ) as GenerationJoin[];
        const printifyId =
          generations[0]?.structure?.metadata?.fulfillment?.printifyProductId?.trim();
        if (!printifyId) {
          skipped.push({ listing: etsyId, reason: "no printify id" });
          continue;
        }

        // Current-design render set.
        const product = await printify.getProduct(printifyId);
        let urls = pickMockupImages(product.data.images, MAX_PUBLISH_MOCKUPS).map(
          (p) => p.image.src,
        );
        if (urls.length <= 1 && product.data.blueprintId != null) {
          const shopProducts = await printify.listProducts(50);
          const donor = shopProducts.data.find(
            (p) =>
              p.productId !== product.data.productId &&
              typeof p.blueprintId === "number" &&
              typeof product.data.blueprintId === "number" &&
              p.blueprintId === product.data.blueprintId &&
              p.images.filter((i) => i.is_selected_for_publishing).length > 1,
          );
          if (donor) {
            const sibling = buildSiblingMockupUrls(
              donor.images,
              donor.productId,
              product.data.productId,
              MAX_PUBLISH_MOCKUPS,
            );
            if (sibling.length > 1) {
              const probe = await visionCheckProductMockup({
                mockupUrl: sibling[0]!,
                productTitle: product.data.title,
              });
              if (!probe.checked || probe.pass) urls = sibling;
            }
          }
        }
        if (urls.length < 2) {
          skipped.push({ listing: etsyId, reason: "no fresh render set" });
          continue;
        }

        // Old photos (captured BEFORE the new uploads).
        const oldIds = await etsy.getListingImages(
          etsyId,
          credentials.access_token,
        );

        // Upload the new set (verified fetches), ranked after the old ones.
        let uploaded = 0;
        for (let i = 0; i < urls.length; i += 1) {
          const res = await fetch(urls[i]!);
          const contentType = res.headers.get("content-type") ?? "";
          if (!res.ok || !contentType.startsWith("image")) continue;
          const buffer = Buffer.from(await res.arrayBuffer());
          await etsy.uploadListingImage(
            etsyId,
            buffer,
            `design-${i + 1}.jpg`,
            credentials.shop_id,
            credentials.access_token,
            oldIds.length + uploaded + 1,
          );
          uploaded += 1;
          await new Promise((r) => setTimeout(r, 400));
        }
        if (uploaded < 2) {
          skipped.push({ listing: etsyId, reason: "uploads failed" });
          continue;
        }

        // Now remove every pre-existing photo — the gallery is single-design.
        let deleted = 0;
        for (const imageId of oldIds) {
          await etsy.deleteListingImage(
            etsyId,
            imageId,
            credentials.shop_id,
            credentials.access_token,
          );
          deleted += 1;
          await new Promise((r) => setTimeout(r, 400));
        }
        done.push({ listing: etsyId, uploaded, deleted });
      } catch (err) {
        failed.push({
          listing: etsyId,
          error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        });
        if (failed.length >= 3) break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    try {
      await supabase.from(TABLES.EVENTS).insert({
        user_id: user.id,
        event_type: "gallery_design_rebuilt",
        message: `Gallery design rebuild: ${done.length} listing(s) rebuilt single-design, ${skipped.length} skipped, ${failed.length} failed.`,
        metadata: { done, skipped, failed } as never,
      });
    } catch {
      // report still returns
    }

    return NextResponse.json({ ok: true, done, skipped, failed });
  } catch (err) {
    console.error("[rebuild-galleries]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 400) : "Failed.",
      },
      { status: 500 },
    );
  }
}
