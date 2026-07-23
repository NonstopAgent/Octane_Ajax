/**
 * Publish an approved product to Etsy THROUGH Printify.
 *
 * Printify (connected to the operator's Etsy shop in Printify's own dashboard)
 * creates a complete Etsy listing — real variants, sizes, pricing, shipping, and
 * order fulfillment linkage — which the direct Etsy listing API cannot do for POD.
 * When the shop's Printify publish setting is "Publish as draft", this respects the
 * Review Gate: the human approves here, Printify creates the Etsy DRAFT, and the
 * human publishes it live from Etsy.
 *
 * Never throws — failures are logged as factory events so approval continues.
 */
import {
  buildSiblingMockupUrls,
  createPrintifyAdapter,
  isPrintifyConfigured,
  pickMockupImages,
  MAX_PUBLISH_MOCKUPS,
  type PrintifyAdapter,
} from "@/lib/ajax/adapters/printify";
import { enqueueApprovalVideos } from "@/lib/ajax/video/jobs";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { mapListingFromDb } from "@/lib/ajax/mappers";
import type { ProductListing } from "@/lib/ajax/types";
import type { ProductGeneration } from "@/lib/product/domain";
import { insertGumroadEvent } from "@/lib/review/gumroad-on-approve";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type PrintifyPublishContext = {
  supabase: Supabase;
  userId: string;
  listingId: string;
  listing: ProductListing;
  generation: ProductGeneration | null;
};

export type PrintifyPublishResult = {
  listing: ProductListing;
  url: string;
} | null;

/**
 * Post-publish enrichment: make sure the Etsy listing carries a full mockup
 * gallery (5+ photos) and has a product video render queued.
 *
 * Photos: the v1 API lists only a product's SELECTED mockups, and API-created
 * products start with one. When the product's own list is thin, gallery URLs
 * are borrowed from a "donor" product of the same blueprint whose gallery was
 * hand-picked once (mockup CDN paths embed the product id — swapping ids
 * yields the target's own renders). Every URL is verified before upload.
 *
 * Video: one 1:1 listing clip per Etsy listing, enqueued at most once
 * (checked against video_jobs) — the poll endpoint + cron attach it when the
 * render finishes.
 *
 * Idempotent and best-effort — a failure never breaks the publish.
 *
 * Exported so the hourly autopilot can re-run it as a self-heal for any
 * listing the publish-time pass missed (it only ADDS photos / queues a
 * video — it never publishes or changes a listing's active/inactive state).
 */
export type EnrichOutcome = {
  /** Photos on the Etsy listing after this pass. */
  galleryCount: number;
  /** Photos added this pass. */
  added: number;
};

export async function enrichEtsyListingAfterPublish(
  supabase: Supabase,
  userId: string,
  listingId: string,
  printifyProductId: string,
  adapter: PrintifyAdapter,
  options: {
    /** Binding-wait attempts (12s apart). Publish-time uses the default;
     * the hourly self-heal passes 1 — by then the binding either exists
     * or this listing needs the next pass anyway. */
    bindingAttempts?: number;
  } = {},
): Promise<EnrichOutcome | null> {
  const bindingAttempts = options.bindingAttempts ?? 5;
  const skip = async (
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<null> => {
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_gallery_skipped",
      `Listing enrichment skipped: ${reason}`,
      { listingId, printifyProductId, ...extra },
    );
    return null;
  };

  try {
    const product = await adapter.getProduct(printifyProductId);

    // --- Gallery source: own selected mockups, else sibling harvest --------
    const ownPicks = pickMockupImages(product.data.images, MAX_PUBLISH_MOCKUPS);
    let galleryUrls = ownPicks.map((p) => p.image.src);
    let gallerySource = "own mockups";

    // Trigger the donor harvest whenever the OWN set is thin — not only at
    // ≤1. Printify pre-attaches its design-preview images at publish, so new
    // listings arrived with 3 images (1 real render + 2 flat-art previews),
    // which defeated the old ≤1 gate and froze galleries at 3 forever
    // (operator caught it on the 2026-07-21 mug wave).
    if (galleryUrls.length < 5 && product.data.blueprintId != null) {
      try {
        const shopProducts = await adapter.listProducts(50);
        const donor = shopProducts.data.find(
          (p) =>
            p.productId !== product.data.productId &&
            // STRICT blueprint match (2026-07-22): `null === null` passed
            // here when the list API omitted blueprints, so a POSTER donated
            // its camera angles to a BANDANA — Printify's CDN then rendered
            // the bandana design in a picture frame above a couch, and that
            // shipped as a listing photo. Both ids must be REAL and equal.
            typeof p.blueprintId === "number" &&
            typeof product.data.blueprintId === "number" &&
            p.blueprintId === product.data.blueprintId &&
            p.images.filter((i) => i.is_selected_for_publishing).length > 1,
        );
        if (donor) {
          const siblingUrls = buildSiblingMockupUrls(
            donor.images,
            donor.productId,
            product.data.productId,
            MAX_PUBLISH_MOCKUPS,
          );
          if (siblingUrls.length > galleryUrls.length) {
            // Cheap sanity check on ONE harvested angle before trusting the
            // set: a donor-angle render that shows the wrong PRODUCT TYPE
            // for this listing title (poster frame for a bandana) fails the
            // MATCH rule and the whole harvest is skipped.
            const { visionCheckProductMockup } = await import(
              "@/lib/review/mockup-vision-qa"
            );
            const probe = await visionCheckProductMockup({
              mockupUrl: siblingUrls[0]!,
              productTitle: product.data.title,
            });
            if (!probe.checked || probe.pass) {
              galleryUrls = siblingUrls;
              gallerySource = `donor ${donor.productId}`;
            } else {
              await insertGumroadEvent(
                supabase,
                userId,
                "etsy_gallery_skipped",
                `Donor-angle harvest rejected by vision QA (${probe.issues.join("; ").slice(0, 160)}) — keeping the product's own mockups.`,
                { listingId, printifyProductId, donor: donor.productId },
              );
            }
          }
        }
      } catch {
        // Donor discovery is optional — continue with whatever we have.
      }
    }

    const credentials = await refreshEtsyToken(userId, { supabase });
    if (!credentials) {
      return skip("Etsy shop not connected");
    }

    const etsy = createEtsyAdapter();

    // Printify binds the Etsy listing ASYNCHRONOUSLY after publish — the
    // external id can take a minute to appear (this raced and lost on 4 of 5
    // overnight publishes). Retry the binding, then fall back to an
    // exact-title match against the shop's active listings.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // BINDING PRECEDENCE: the row's stored numeric id WINS over Printify's
    // external field. Printify kept a STALE listing id after a republish
    // (its external said 4534795607 — a dead listing — while the real one
    // was 4534788962), and because externalId used to take precedence every
    // heal pass re-persisted the dead id, silently reverting manual repairs.
    // Stored ids come from live-shop matches or operator repairs; Printify's
    // external is the fallback, not the authority.
    let etsyListingId: string | null = null;
    {
      const { data: row } = await supabase
        .from(TABLES.LISTINGS)
        .select("gumroad_product_id")
        .eq("id", listingId)
        .eq("user_id", userId)
        .maybeSingle();
      const stored = String(row?.gumroad_product_id ?? "");
      if (/^\d+$/.test(stored)) etsyListingId = stored;
    }
    if (
      etsyListingId &&
      product.data.externalId &&
      product.data.externalId !== etsyListingId
    ) {
      await insertGumroadEvent(
        supabase,
        userId,
        "listing_binding_mismatch",
        `Printify's external listing id (${product.data.externalId}) disagrees with the stored binding (${etsyListingId}) — using the stored id. Printify likely kept a stale id after a republish.`,
        { listingId, printifyProductId, stored: etsyListingId, printify: product.data.externalId },
      );
    }
    if (!etsyListingId) etsyListingId = product.data.externalId;
    for (
      let attempt = 0;
      !etsyListingId && attempt < bindingAttempts;
      attempt += 1
    ) {
      if (attempt > 0) {
        await sleep(12_000);
        try {
          const fresh = await adapter.getProduct(printifyProductId);
          etsyListingId = fresh.data.externalId;
          if (etsyListingId) break;
        } catch {
          // transient — keep retrying
        }
      }
      if (!etsyListingId) {
        try {
          const shopListings = await etsy.getShopListings(
            credentials.shop_id,
            credentials.access_token,
          );
          const wanted = product.data.title.trim().toLowerCase();
          etsyListingId =
            shopListings.find((l) => l.title.trim().toLowerCase() === wanted)
              ?.listingId ?? null;
        } catch {
          // transient — keep retrying
        }
      }
    }
    if (!etsyListingId) {
      return skip(
        "could not resolve the Etsy listing id (will self-heal on the next autopilot pass)",
        {
          productTitle: product.data.title,
          // Diagnostics: what Printify actually returned in `external` —
          // pins down WHY binding stopped resolving (shape change vs. never
          // populated vs. slow).
          externalRaw: JSON.stringify(product.data.externalRaw ?? null).slice(
            0,
            400,
          ),
        },
      );
    }

    // Persist the binding the moment it resolves — later title renames
    // (medic/operator/Etsy widget) break the exact-title fallback, so a
    // resolved id must never be lost again.
    try {
      await supabase
        .from(TABLES.LISTINGS)
        .update({
          gumroad_product_id: etsyListingId,
          gumroad_url: `https://www.etsy.com/listing/${etsyListingId}`,
        })
        .eq("id", listingId)
        .eq("user_id", userId)
        .neq("gumroad_product_id", etsyListingId);
    } catch {
      // Best-effort — enrichment continues either way.
    }

    // Etsy seller-policy compliance (2026-07-21): POD listings must disclose
    // their production partner. The original 28 got Printify attached via a
    // manual bulk edit; every NEW listing arrives bare. Idempotent — Etsy
    // re-setting the same partner list is a no-op, and this runs on both the
    // publish-time pass and the hourly self-heal.
    try {
      const partnerIds = await etsy.getProductionPartnerIds(
        credentials.shop_id,
        credentials.access_token,
      );
      if (partnerIds.length > 0) {
        await etsy.updateListing(
          credentials.shop_id,
          etsyListingId,
          credentials.access_token,
          { production_partner_ids: partnerIds },
        );
      }
    } catch (partnerErr) {
      await insertGumroadEvent(
        supabase,
        userId,
        "production_partner_attach_failed",
        `Could not attach the production partner to listing ${etsyListingId}: ${partnerErr instanceof Error ? partnerErr.message : "unknown"}`,
        { listingId, etsyListingId },
      );
    }

    // --- Photos -------------------------------------------------------------
    let firstImageBuffer: Buffer | null = null;
    // The moat: every listing accepts buyer personalization (pet name/date,
    // or a photo link on portrait items). Idempotent PATCH; the intake poller
    // + Personalization Bay fulfill these orders automatically.
    try {
      await etsy.updateListing(
        credentials.shop_id,
        etsyListingId,
        credentials.access_token,
        {
          personalization_is_required: false,
          personalization_char_count_max: 256,
          personalization_instructions:
            "Optional personalization: your pet's name (and year) exactly as you'd like it on the design. For portrait items, paste a shareable photo link (Google Photos/iCloud/Drive).",
        },
      );
    } catch {
      // Optional enhancement — never blocks enrichment.
    }

    const existing = await etsy.getListingImages(
      etsyListingId,
      credentials.access_token,
    );

    let added = 0;
    let fetchFailed = 0;
    if (existing.length < galleryUrls.length) {
      for (let i = existing.length; i < galleryUrls.length; i += 1) {
        const res = await fetch(galleryUrls[i]!);
        if (!res.ok) {
          fetchFailed += 1;
          continue; // unverified sibling render — skip
        }
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.startsWith("image")) {
          fetchFailed += 1;
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!firstImageBuffer) firstImageBuffer = buffer;
        await etsy.uploadListingImage(
          etsyListingId,
          buffer,
          `mockup-${i + 1}.jpg`,
          credentials.shop_id,
          credentials.access_token,
          i + 1,
        );
        added += 1;
      }
      if (added > 0) {
        await insertGumroadEvent(
          supabase,
          userId,
          "etsy_gallery_filled",
          `Added ${added} mockup photo(s) to the Etsy listing (now ${existing.length + added} total; source: ${gallerySource}).`,
          { listingId, printifyProductId, etsyListingId, added, gallerySource },
        );
      }
    }
    // --- Photo floor: our own stored art mockup ------------------------------
    // Some blueprints come back from Printify with a single mockup and no
    // same-blueprint donor (both stuck mugs did) — Etsy's search-visibility
    // banner flags exactly this ("listings have 1 photo"). We ALWAYS have our
    // own generated art mockup, so no listing may ever sit at 1 photo.
    let galleryCount = existing.length + added;
    if (galleryCount < 2) {
      try {
        const { data: listingRow } = await supabase
          .from(TABLES.LISTINGS)
          .select("mockup_url")
          .eq("id", listingId)
          .eq("user_id", userId)
          .maybeSingle();
        const mockupUrl = (listingRow?.mockup_url ?? "").trim();
        if (mockupUrl.startsWith("https://")) {
          const res = await fetch(mockupUrl);
          const contentType = res.headers.get("content-type") ?? "";
          if (res.ok && contentType.startsWith("image")) {
            const buffer = Buffer.from(await res.arrayBuffer());
            if (!firstImageBuffer) firstImageBuffer = buffer;
            await etsy.uploadListingImage(
              etsyListingId,
              buffer,
              "art-mockup.jpg",
              credentials.shop_id,
              credentials.access_token,
              galleryCount + 1,
            );
            galleryCount += 1;
            await insertGumroadEvent(
              supabase,
              userId,
              "etsy_gallery_filled",
              `Added our own art mockup as photo #${galleryCount} (Printify offered no additional mockups for this blueprint).`,
              {
                listingId,
                printifyProductId,
                etsyListingId,
                source: "own_art_mockup",
              },
            );
          }
        }
      } catch {
        // Floor is best-effort — the stall event below still fires.
      }
    }

    // A listing stuck at 1 photo with no path forward used to exit silently —
    // the exact failure mode that kept "healthy" passes shipping thin
    // listings. Emit the reason so the next debugging session starts here.
    if (galleryCount < 2) {
      await insertGumroadEvent(
        supabase,
        userId,
        "etsy_gallery_stalled",
        `Gallery STILL stuck at ${galleryCount} photo(s) after all sources: ${galleryUrls.length} candidate URL(s) from ${gallerySource}, ${fetchFailed} failed fetch/verify, art-mockup floor unavailable.`,
        {
          listingId,
          printifyProductId,
          etsyListingId,
          galleryCount,
          candidates: galleryUrls.length,
          gallerySource,
          fetchFailed,
        },
      );
    }

    // --- Video (one per listing, ever) --------------------------------------
    try {
      const { data: existingJob } = await supabase
        .from(TABLES.VIDEO_JOBS)
        .select("id")
        .eq("user_id", userId)
        .eq("etsy_listing_id", etsyListingId)
        .eq("kind", "etsy_listing")
        .in("status", ["pending", "done"])
        .limit(1)
        .maybeSingle();

      if (!existingJob) {
        if (!firstImageBuffer && galleryUrls.length > 0) {
          const res = await fetch(galleryUrls[0]!);
          if (res.ok) {
            firstImageBuffer = Buffer.from(await res.arrayBuffer());
          }
        }
        if (firstImageBuffer) {
          const queued = await enqueueApprovalVideos(supabase, {
            userId,
            mockupBuffer: firstImageBuffer,
            title: product.data.title,
            etsyListingId,
            listingUrl: `https://www.etsy.com/listing/${etsyListingId}`,
          });
          if (queued.etsy) {
            await insertGumroadEvent(
              supabase,
              userId,
              "video_render_queued",
              queued.style === "lifestyle"
                ? "Queued a LIFESTYLE product video (worn/hung/styled scene); it attaches to the Etsy listing when the render finishes."
                : `⚠️ Queued a plain product video (camera move on the catalog photo — the weak kind) because the lifestyle scene could not be generated: ${queued.styleError ?? "unknown reason"}.`,
              {
                listingId,
                etsyListingId,
                provider: "printify",
                style: queued.style ?? null,
                styleError: queued.styleError ?? null,
              },
            );
          } else {
            await insertGumroadEvent(
              supabase,
              userId,
              "video_enqueue_skipped",
              `Listing has no video and the render did not enqueue: ${queued.etsyError ?? "unknown reason"}.`,
              { listingId, etsyListingId, reason: queued.etsyError ?? null },
            );
          }
        } else {
          await insertGumroadEvent(
            supabase,
            userId,
            "video_enqueue_skipped",
            "Listing has no video and no fetchable mockup image to render from — was previously silent.",
            { listingId, etsyListingId },
          );
        }
      }
    } catch {
      // Video is a bonus — never let it break enrichment.
    }

    return { galleryCount, added };
  } catch (err) {
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_gallery_failed",
      `Listing enrichment failed: ${err instanceof Error ? err.message : "unknown"}`,
      { listingId, printifyProductId },
    );
    return null;
  }
}

export async function publishListingViaPrintify(
  ctx: PrintifyPublishContext,
): Promise<PrintifyPublishResult> {
  const { supabase, userId, listingId, generation } = ctx;

  const printifyProductId = generation?.fulfillment?.printifyProductId?.trim();
  if (!printifyProductId) {
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_publish_failed",
      "Publish failed: no Printify product yet — run the product through the factory so fulfillment creates it first.",
      { listingId },
    );
    return null;
  }

  if (!isPrintifyConfigured()) {
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_skipped",
      "Publish skipped: Printify is not configured (PRINTIFY_API_TOKEN / PRINTIFY_SHOP_ID).",
      { listingId },
    );
    return null;
  }

  try {
    const adapter = createPrintifyAdapter();
    const result = await adapter.publishProduct(printifyProductId);
    const url = result.data.storefrontUrl;
    const externalId = result.data.externalId;

    const { data: updated, error } = await supabase
      .from(TABLES.LISTINGS)
      .update({
        gumroad_url: url,
        gumroad_product_id: externalId,
        status: "published",
      })
      .eq("id", listingId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error || !updated) {
      await insertGumroadEvent(
        supabase,
        userId,
        "etsy_publish_failed",
        `Printify publish succeeded but saving the listing failed: ${error?.message ?? "unknown"}`,
        { listingId },
      );
      return null;
    }

    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_published",
      `Published to Etsy via Printify (review and publish it live from Printify or Etsy): ${url}`,
      { listingId, printifyProductId, url, provider: "printify" },
    );

    // Etsy ranks listings with 5+ photos higher and videos boost conversion;
    // Printify's own sync sends only the default mockup, so enrich via the
    // Etsy API (photos now, video render queued for the cron to attach).
    await enrichEtsyListingAfterPublish(
      supabase,
      userId,
      listingId,
      printifyProductId,
      adapter,
    );

    return { listing: mapListingFromDb(updated), url };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown Printify publish error.";
    await insertGumroadEvent(
      supabase,
      userId,
      "etsy_publish_failed",
      `Printify publish failed: ${message}`,
      { listingId, provider: "printify" },
    );
    return null;
  }
}
