/**
 * Shop Autopilot — Ajax's continuous improvement loop (server only).
 *
 * Runs on an hourly cron. Each pass:
 *   1. AUDITS every live Etsy listing for SEO gaps (tags, shipping, returns, price).
 *   2. AUTO-FIXES the small reversible ones via the Etsy API (tags, free-shipping
 *      profile) and QUEUES the big ones as strategy recommendations.
 *   3. REACTS to stalled listings by regenerating Pixel marketing content.
 *   4. KEEPS THE FACTORY MOVING: when the Review Gate is clear and the shop is
 *      under its listing target, it triggers a full Nova→Forge→fulfillment cycle.
 *   5. LOGS everything to factory_events so the operator (and other agents) can
 *      see exactly what Ajax changed and why.
 *
 * Strategy source: AJAX_STRATEGY.md (repo) — encoded here as behavior.
 */
import {
  createEtsyAdapter,
  type EtsyListingDetails,
  type EtsyShippingProfileSummary,
} from "@/lib/ajax/adapters/etsy";
import {
  auditListing,
  buildTagFill,
  type AutopilotAction,
  type ListingAuditInput,
} from "@/lib/ajax/autopilot/decisions";
import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { fetchOperatorKeywords } from "@/lib/ajax/nova/research";
import {
  isPrintifyCatalogKey,
  getPrintifyCatalogEntry,
} from "@/lib/ajax/pod/printify-catalog";
import {
  NoQueuedContentError,
  runPixelMarketing,
} from "@/lib/ajax/pixel-simulator";
import {
  CycleBlockedError,
  runForgeStep,
  runNovaStep,
} from "@/lib/ajax/simulator";
import { runGenerationPodJob } from "@/lib/product/generation-pod-runner";
import {
  gatherTakedownCandidates,
  selectTakedownCandidate,
} from "@/lib/ajax/autopilot/takedown";
import {
  createPrintifyAdapter,
  isPrintifyConfigured,
} from "@/lib/ajax/adapters/printify";
import { isVideoRenderConfigured } from "@/lib/ajax/video/fal-render";
import { enrichEtsyListingAfterPublish } from "@/lib/review/printify-publish-on-approve";
import { generateListingFix } from "@/lib/ajax/autopilot/listing-medic";
import {
  findBlockedContentViolations,
  titleStyleIssues,
} from "@/lib/ajax/product-brain/rules";
import { pollPersonalizedOrders } from "@/lib/ajax/pod/order-intake";
import { autoReviewPending } from "@/lib/review/auto-review";
import { runPostApproval } from "@/lib/review/service";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

/** Stop auto-producing once the shop has this many active listings (override via
 * AUTOPILOT_TARGET_LISTINGS). Set for a fuller starter storefront; the 85+ review
 * bar + hourly cadence keep quality high and spend paced. */
const DEFAULT_TARGET_LISTINGS = 30;
/** Cap Etsy detail lookups per pass (rate-limit hygiene). */
const MAX_LISTINGS_PER_PASS = 25;

export type AutopilotResult = {
  ok: boolean;
  skipped?: string;
  audited: number;
  tagsFixed: number;
  shippingFixed: number;
  recommended: number;
  marketingQueued: number;
  cycleTriggered: boolean;
  cycleBlocked: boolean;
  reviewsCleared: number;
  takenDown: number;
  errors: string[];
};

function emptyResult(): AutopilotResult {
  return {
    ok: true,
    audited: 0,
    tagsFixed: 0,
    shippingFixed: 0,
    recommended: 0,
    marketingQueued: 0,
    cycleTriggered: false,
    cycleBlocked: false,
    reviewsCleared: 0,
    takenDown: 0,
    errors: [],
  };
}

async function logEvent(
  supabase: Supabase,
  userId: string,
  eventType: string,
  message: string,
  metadata: Json = {},
): Promise<void> {
  try {
    await supabase.from(TABLES.EVENTS).insert({
      user_id: userId,
      event_type: eventType,
      message,
      agent_slug: AGENT_SLUGS.NOVA,
      room: ROOM_SLUGS.REVIEW_GATE,
      metadata,
    });
  } catch {
    // Logging must never break the loop.
  }
}

type InternalListingRow = {
  id: string;
  gumroad_product_id: string | null;
  created_at: string | null;
  product_ideas: { seo_keywords: string[] | null } | { seo_keywords: string[] | null }[] | null;
  product_generations:
    | { structure: unknown }[]
    | { structure: unknown }
    | null;
};

function firstOrSelf<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Strategy price floor (cents) from the generation's catalog key. */
function minPriceCentsFor(row: InternalListingRow | undefined): number | null {
  const generations =
    row?.product_generations == null
      ? []
      : Array.isArray(row.product_generations)
        ? row.product_generations
        : [row.product_generations];
  for (const g of generations) {
    const meta = (g.structure as { metadata?: { catalogKey?: unknown } } | null)
      ?.metadata;
    const key = typeof meta?.catalogKey === "string" ? meta.catalogKey : null;
    if (key && isPrintifyCatalogKey(key)) {
      const prices = Object.values(getPrintifyCatalogEntry(key).variantPrices);
      if (prices.length > 0) return Math.min(...prices);
    }
  }
  return null;
}

export async function runShopAutopilot(
  supabase: Supabase,
  userId: string,
): Promise<AutopilotResult> {
  const result = emptyResult();

  if (process.env.AUTOPILOT_DISABLED === "true") {
    result.skipped = "disabled_via_env";
    return result;
  }

  // ---- Overlap lock ----------------------------------------------------------
  // When a pass runs long, Vercel's cron can retry it — two concurrent passes
  // double every Etsy/Printify call (rate limits) and double-post promos.
  // If another pass started in the last 8 minutes, stand down.
  try {
    const lockWindow = new Date(Date.now() - 8 * 60 * 1000).toISOString();
    const { data: running } = await supabase
      .from(TABLES.EVENTS)
      .select("id")
      .eq("user_id", userId)
      .eq("event_type", "autopilot_started")
      .gte("created_at", lockWindow)
      .limit(1);
    if ((running ?? []).length > 0) {
      result.skipped = "overlapping_pass";
      return result;
    }
    await logEvent(
      supabase,
      userId,
      "autopilot_started",
      "Autopilot pass started.",
      {},
    );
  } catch {
    // Lock is best-effort — never block the pass on it.
  }

  // ---- Etsy access ---------------------------------------------------------
  let credentials;
  try {
    credentials = await refreshEtsyToken(userId, { supabase });
  } catch {
    credentials = null;
  }

  const adapter = createEtsyAdapter();
  let liveListings: { listingId: string; title: string; views: number }[] = [];
  let freeShippingProfileId: number | null = null;
  let paidProfileIds = new Set<number>();

  if (credentials) {
    try {
      liveListings = await adapter.getShopListings(
        credentials.shop_id,
        credentials.access_token,
      );
    } catch (err) {
      result.errors.push(
        `listings: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
    try {
      const profiles: EtsyShippingProfileSummary[] =
        await adapter.getShippingProfiles(
          credentials.shop_id,
          credentials.access_token,
        );
      freeShippingProfileId =
        profiles.find((p) => p.usPrimaryCostCents === 0)?.profileId ?? null;
      paidProfileIds = new Set(
        profiles
          .filter((p) => (p.usPrimaryCostCents ?? 0) > 0)
          .map((p) => p.profileId),
      );
    } catch (err) {
      result.errors.push(
        `profiles: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  // ---- Internal context ----------------------------------------------------
  const etsyIds = liveListings.map((l) => l.listingId);
  const internalByEtsyId = new Map<string, InternalListingRow>();
  if (etsyIds.length > 0) {
    const { data } = await supabase
      .from(TABLES.LISTINGS)
      .select(
        `id, gumroad_product_id, created_at,
         product_ideas ( seo_keywords ),
         product_generations ( structure )`,
      )
      .eq("user_id", userId)
      .in("gumroad_product_id", etsyIds);
    for (const row of (data ?? []) as unknown as InternalListingRow[]) {
      if (row.gumroad_product_id) {
        internalByEtsyId.set(String(row.gumroad_product_id), row);
      }
    }
  }

  // ---- Binding backfill ------------------------------------------------------
  // When Printify's external id never materializes (and a later title rename
  // breaks the exact-title fallback), rows keep a Printify hex id in
  // gumroad_product_id and every downstream step (gallery, video,
  // personalization) silently skips. Repair here: any published row whose
  // stored id is NOT numeric gets matched against the live listings by
  // normalized title and rebound permanently.
  if (credentials && liveListings.length > 0) {
    try {
      const { data: unbound } = await supabase
        .from(TABLES.LISTINGS)
        .select("id, title, gumroad_product_id")
        .eq("user_id", userId)
        .eq("status", "published")
        .not("gumroad_product_id", "is", null);
      const norm = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
      const liveByTitle = new Map(
        liveListings.map((l) => [norm(l.title), l.listingId]),
      );
      // Only ids ALREADY claimed by an internal row are off-limits — building
      // this from all live ids made every candidate look taken (0 rebinds).
      const boundIds = new Set(internalByEtsyId.keys());
      for (const row of unbound ?? []) {
        const stored = String(row.gumroad_product_id ?? "");
        if (/^\d+$/.test(stored)) continue; // already a real Etsy id
        const liveId = liveByTitle.get(norm(row.title ?? ""));
        if (!liveId || boundIds.has(liveId)) continue;
        await supabase
          .from(TABLES.LISTINGS)
          .update({
            gumroad_product_id: liveId,
            gumroad_url: `https://www.etsy.com/listing/${liveId}`,
          })
          .eq("id", row.id)
          .eq("user_id", userId);
        await logEvent(
          supabase,
          userId,
          "listing_binding_repaired",
          `Rebound "${(row.title ?? "").slice(0, 60)}" to Etsy listing ${liveId} (Printify external id never resolved).`,
          { listingId: row.id, etsyListingId: liveId, previous: stored },
        );
      }
    } catch (err) {
      result.errors.push(
        `binding-backfill: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  const marketKeywords =
    (await fetchOperatorKeywords({ supabase, userId }))?.map((k) => k.term) ??
    [];

  // Recent marketing (avoid re-queueing the same listing every hour).
  // 3-day window (was 7): at 5-7 social posts/day the queue needs ~6 fresh
  // promo packs daily, and each listing can be re-promoted twice a week
  // with a different caption — normal cadence on Pinterest.
  const marketingWindowAgo = new Date(
    Date.now() - 3 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const recentMarketing = new Set<string>();
  {
    const { data } = await supabase
      .from(TABLES.CONTENT_JOBS)
      .select("listing_id, created_at")
      .eq("user_id", userId)
      .gte("created_at", marketingWindowAgo);
    for (const row of data ?? []) {
      if (row.listing_id) recentMarketing.add(row.listing_id);
    }
  }

  // Open recommendations (dedupe by title).
  const openRecTitles = new Set<string>();
  {
    const { data } = await supabase
      .from(TABLES.STRATEGY)
      .select("title, status")
      .eq("user_id", userId)
      .eq("status", "proposed");
    for (const row of data ?? []) openRecTitles.add(row.title ?? "");
  }

  // ---- Audit + act ---------------------------------------------------------
  const runId = crypto.randomUUID();
  const marketingListingIds: string[] = [];
  const medicCandidates: {
    live: { listingId: string; title: string; views: number };
    details: EtsyListingDetails;
    internalId: string | null;
    issues: string[];
    critical: boolean;
  }[] = [];

  for (const live of liveListings.slice(0, MAX_LISTINGS_PER_PASS)) {
    if (!credentials) break;
    let details: EtsyListingDetails;
    try {
      details = await adapter.getListingDetails(
        live.listingId,
        credentials.access_token,
      );
    } catch (err) {
      result.errors.push(
        `detail ${live.listingId}: ${err instanceof Error ? err.message : "failed"}`,
      );
      continue;
    }
    if (details.state && details.state !== "active") continue;

    const internal = internalByEtsyId.get(live.listingId);
    const createdAt = internal?.created_at ? Date.parse(internal.created_at) : NaN;
    const ageDays = Number.isFinite(createdAt)
      ? (Date.now() - createdAt) / 86_400_000
      : null;

    const usShippingCostCents =
      details.shippingProfileId == null
        ? null
        : freeShippingProfileId != null &&
            details.shippingProfileId === freeShippingProfileId
          ? 0
          : paidProfileIds.has(details.shippingProfileId)
            ? 1 // exact amount irrelevant — "paid" is enough to act
            : null;

    const auditInput: ListingAuditInput = {
      etsyListingId: live.listingId,
      title: details.title || live.title,
      tagCount: details.tags.length,
      usShippingCostCents,
      hasReturnPolicy: details.returnPolicyId != null,
      priceCents: details.priceCents,
      minPriceCents: minPriceCentsFor(internal),
      totalViews: live.views,
      ageDays,
      hasRecentMarketing: internal ? recentMarketing.has(internal.id) : true,
    };

    result.audited += 1;

    // Collect Store-QA-grade problems the MEDIC can actually fix (incomplete
    // tags, blocked/risky copy, stuffed titles) — repaired after the loop,
    // worst first.
    {
      const violations = findBlockedContentViolations(
        `${details.title} ${details.description}`,
      );
      const issues: string[] = [];
      if (details.tags.length !== 13) {
        issues.push(
          `Uses ${details.tags.length} of 13 tags — fill all 13 with multi-word long-tail phrases.`,
        );
      }
      if (violations.length > 0) {
        issues.push(
          `Copy contains blocked/risky content (${violations.join(", ")}) — remove it.`,
        );
      }
      // Etsy's search-visibility banner re-flags stuffed titles until fixed —
      // repair them proactively so the operator never sees the banner again.
      issues.push(...titleStyleIssues(details.title));
      if (issues.length > 0) {
        medicCandidates.push({
          live,
          details,
          internalId: internal?.id ?? null,
          issues,
          critical: violations.length > 0,
        });
      }
    }

    const actions: AutopilotAction[] = auditListing(auditInput);

    for (const action of actions) {
      if (action.kind === "fill_tags") {
        const idea = firstOrSelf(internal?.product_ideas ?? null);
        const candidates = [...(idea?.seo_keywords ?? []), ...marketKeywords];
        const tags = buildTagFill(details.tags, candidates);
        if (tags.length > details.tags.length) {
          try {
            await adapter.updateListing(
              credentials.shop_id,
              live.listingId,
              credentials.access_token,
              { tags },
            );
            result.tagsFixed += 1;
            await logEvent(
              supabase,
              userId,
              "autopilot_fixed_listing",
              `Autopilot filled tags on "${auditInput.title}" (${details.tags.length} → ${tags.length}).`,
              { etsyListingId: live.listingId, runId, tags },
            );
          } catch (err) {
            result.errors.push(
              `tags ${live.listingId}: ${err instanceof Error ? err.message : "failed"}`,
            );
          }
        }
      } else if (action.kind === "fix_shipping") {
        if (freeShippingProfileId != null) {
          try {
            await adapter.updateListing(
              credentials.shop_id,
              live.listingId,
              credentials.access_token,
              { shipping_profile_id: freeShippingProfileId },
            );
            result.shippingFixed += 1;
            await logEvent(
              supabase,
              userId,
              "autopilot_fixed_listing",
              `Autopilot moved "${auditInput.title}" to the free-US-shipping profile (Etsy suppresses >$6 shipping).`,
              { etsyListingId: live.listingId, runId },
            );
          } catch (err) {
            result.errors.push(
              `shipping ${live.listingId}: ${err instanceof Error ? err.message : "failed"}`,
            );
          }
        } else if (!openRecTitles.has(`Create a free-US-shipping profile`)) {
          openRecTitles.add(`Create a free-US-shipping profile`);
          await insertRecommendation(supabase, userId, runId, {
            category: "channel",
            title: `Create a free-US-shipping profile`,
            rationale: `"${auditInput.title}" ships at a paid rate and no free-US profile exists to move it to. Etsy suppresses US listings shipping above $6.`,
            recommendedAction:
              "Set the listing's shipping profile to Free shipping (US) in Etsy → Settings → Shipping, or flip Printify's store shipping to free so new listings inherit it.",
            priority: 5,
            etsyListingId: live.listingId,
          });
          result.recommended += 1;
        }
      } else if (action.kind === "queue_marketing") {
        if (internal) marketingListingIds.push(internal.id);
      } else if (action.kind === "recommend") {
        if (openRecTitles.has(action.title)) continue;
        openRecTitles.add(action.title);
        await insertRecommendation(supabase, userId, runId, {
          category: action.category,
          title: action.title,
          rationale: action.rationale,
          recommendedAction: action.recommendedAction,
          priority: action.priority,
          etsyListingId: action.etsyListingId,
        });
        result.recommended += 1;
      }
    }
  }

  // ---- Medic: FIX the QA findings, don't just report them --------------------
  // Up to 2 listings per pass (criticals first) get an LLM-corrected title /
  // description / full 13-tag set, validated hard and applied via the Etsy
  // API — the shop's QA score climbs without the operator lifting a finger.
  if (credentials) {
    const prioritized = [...medicCandidates].sort(
      (a, b) => Number(b.critical) - Number(a.critical),
    );
    for (const cand of prioritized.slice(0, 2)) {
      try {
        const fix = await generateListingFix({
          title: cand.details.title,
          description: cand.details.description,
          tags: cand.details.tags,
          issues: cand.issues,
          marketKeywords,
        });
        if (!fix) continue;
        await adapter.updateListing(
          credentials.shop_id,
          cand.live.listingId,
          credentials.access_token,
          {
            tags: fix.tags,
            ...(fix.changed.includes("title") ? { title: fix.title } : {}),
            ...(fix.changed.includes("description")
              ? { description: fix.description }
              : {}),
          },
        );
        if (cand.internalId) {
          await supabase
            .from(TABLES.LISTINGS)
            .update({
              ...(fix.changed.includes("title") ? { title: fix.title } : {}),
              ...(fix.changed.includes("description")
                ? { description: fix.description }
                : {}),
            })
            .eq("id", cand.internalId)
            .eq("user_id", userId);
        }
        result.tagsFixed += 1;
        await logEvent(
          supabase,
          userId,
          "autopilot_medic_fixed",
          `Medic repaired "${cand.details.title.slice(0, 60)}" — updated ${fix.changed.join(" + ")} (${cand.issues.length} QA issue(s) cleared).`,
          {
            etsyListingId: cand.live.listingId,
            runId,
            changed: fix.changed,
            issues: cand.issues,
          },
        );
      } catch (err) {
        result.errors.push(
          `medic ${cand.live.listingId}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    }
  }

  // ---- React: regenerate marketing for stalled listings ---------------------
  for (const listingId of marketingListingIds) {
    const { error } = await supabase.from(TABLES.CONTENT_JOBS).insert({
      user_id: userId,
      listing_id: listingId,
      platform: "social",
      content_type: "promo",
      status: "queued",
      caption: "Autopilot: low-traffic listing — fresh promo pack",
    });
    if (!error) result.marketingQueued += 1;
  }
  if (result.marketingQueued > 0) {
    try {
      await runPixelMarketing(supabase, userId);
      await logEvent(
        supabase,
        userId,
        "autopilot_marketing",
        `Autopilot generated fresh social posts for ${result.marketingQueued} low-traffic listing(s) — copy them from the Marketing page.`,
        { runId, count: result.marketingQueued },
      );
    } catch (err) {
      if (!(err instanceof NoQueuedContentError)) {
        result.errors.push(
          `pixel: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    }
  }

  // ---- Traffic: swap PNG post assets for the listing's Etsy JPEG -------------
  // TikTok photo posts reject PNG (Printify mockups); Etsy re-hosts every
  // listing photo as JPEG on its CDN. Refreshing staged jobs' assets here
  // unlocks TikTok for every image post — current queue and future ones.
  if (credentials) {
    try {
      const { data: pngJobs } = await supabase
        .from(TABLES.CONTENT_JOBS)
        .select("id, asset_url, product_listings ( gumroad_product_id )")
        .eq("user_id", userId)
        .eq("status", "scheduled")
        .like("asset_url", "%.png%")
        .limit(8);
      for (const row of pngJobs ?? []) {
        const listing = firstOrSelf(
          row.product_listings as
            | { gumroad_product_id?: string | null }
            | { gumroad_product_id?: string | null }[]
            | null,
        );
        const etsyListingId = listing?.gumroad_product_id?.trim();
        if (!etsyListingId) continue;
        try {
          const urls = await adapter.getListingImageUrls(
            etsyListingId,
            credentials.access_token,
          );
          const jpeg = urls.find((u) =>
            /\.jpe?g(\?|$)/i.test(u.split("?")[0] ?? ""),
          );
          if (jpeg) {
            await supabase
              .from(TABLES.CONTENT_JOBS)
              .update({ asset_url: jpeg })
              .eq("id", row.id)
              .eq("user_id", userId);
          }
        } catch {
          // Non-fatal: job keeps its PNG (poster skips TikTok for it).
        }
      }
    } catch (err) {
      result.errors.push(
        `asset-refresh: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  // ---- Learn: measure recent posts' engagement (Ayrshare analytics) ----------
  // ≤4 fetches/pass; feeds Pixel's performance notes so copy improves itself.
  try {
    const { runSocialAnalytics } = await import("@/lib/social/analytics");
    await runSocialAnalytics(supabase, userId);
  } catch (err) {
    result.errors.push(
      `analytics: ${err instanceof Error ? err.message : "failed"}`,
    );
  }

  // ---- Traffic: post a staged Pixel promo to social (Ayrshare) ---------------
  // Dormant until AYRSHARE_API_KEY exists; per-platform daily caps.
  try {
    const { runSocialAutoPoster } = await import("@/lib/social/auto-poster");
    const social = await runSocialAutoPoster(supabase, userId);
    if (social.posted > 0) {
      result.marketingQueued += social.posted;
    }
    if (social.errors.length > 0) {
      result.errors.push(...social.errors.map((e) => `social: ${e}`));
    }
  } catch (err) {
    result.errors.push(
      `social: ${err instanceof Error ? err.message : "failed"}`,
    );
  }

  // ---- Room 2 intake: personalized orders (Etsy has no order webhooks) ------
  // Scans recent receipts for buyer personalization (pet name / photo link)
  // and feeds the Personalization Bay queue. Fixed orders are ignored —
  // Printify fulfills those natively.
  if (credentials && isPrintifyConfigured()) {
    try {
      const intake = await pollPersonalizedOrders(supabase, userId, {
        etsy: adapter,
        printify: createPrintifyAdapter(),
        shopId: credentials.shop_id,
        accessToken: credentials.access_token,
      });
      if (intake.queued > 0) {
        await logEvent(
          supabase,
          userId,
          "autopilot_order_intake",
          `Personalization intake: queued ${intake.queued} personalized order(s) from ${intake.scanned} recent receipt(s).`,
          { runId, ...intake } as unknown as Json,
        );
      }
      if (intake.errors.length > 0) {
        result.errors.push(...intake.errors.map((e) => `intake: ${e}`));
      }
    } catch (err) {
      result.errors.push(
        `intake: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  // ---- Self-heal: galleries + videos on recent listings ----------------------
  // The publish-time enrichment can lose the race with Printify's async Etsy
  // binding. Re-running it here is idempotent (photos top up only when
  // missing, video renders enqueue at most once per listing, and it NEVER
  // changes a listing's active/inactive state) — so anything missed at
  // publish time heals within an hour.
  if (isPrintifyConfigured()) {
    if (isVideoRenderConfigured()) {
      try {
        const { drainVideoJobs } = await import("@/lib/ajax/video/jobs");
        await drainVideoJobs(supabase, userId);
      } catch (err) {
        result.errors.push(
          `video-drain: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    }
    try {
      // Heal every published listing — but in ROTATING batches of 8/hour,
      // not all at once. Enriching 25 listings back-to-back blew through
      // Etsy's per-second rate limit, stretched the pass past its timeout
      // (Vercel then RETRIED the cron — double passes), and starved the
      // newest listings of enrichment entirely.
      const HEAL_BATCH = 8;
      const healOffset = (new Date().getUTCHours() % 3) * HEAL_BATCH;
      const { data: recentRows } = await supabase
        .from(TABLES.LISTINGS)
        .select("id, created_at, product_generations ( structure )")
        .eq("user_id", userId)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .range(healOffset, healOffset + HEAL_BATCH - 1);
      const printifyAdapterForHeal = createPrintifyAdapter();
      for (const row of (recentRows ?? []) as unknown as InternalListingRow[]) {
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
        if (!printifyProductId) continue;
        await enrichEtsyListingAfterPublish(
          supabase,
          userId,
          row.id,
          printifyProductId,
          printifyAdapterForHeal,
          { bindingAttempts: 1 },
        );
        // Breathe between listings — stay under Etsy's per-second limit.
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err) {
      result.errors.push(
        `enrich-heal: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  // ---- Produce: keep the factory moving (LAST on purpose) --------------------
  // A full Nova→Forge→publish cycle can take minutes; when it ran mid-pass it
  // regularly ate the function's whole time budget and starved everything
  // after it (self-heal, asset refresh, social poster) — the exact reason
  // enrichment silently stopped happening. Production now goes last: a
  // timeout costs one new product (next hour catches up), never quality.
  const targetListings = Number(
    process.env.AUTOPILOT_TARGET_LISTINGS ?? DEFAULT_TARGET_LISTINGS,
  );

  // Portfolio capacity awareness — RECOMMEND retirement, never execute.
  let publishedCount = 0;
  try {
    const candidates = await gatherTakedownCandidates(supabase, userId);
    publishedCount = candidates.length;
    const atCapacity = publishedCount >= targetListings;
    const cut = selectTakedownCandidate(candidates, { atCapacity });
    if (cut) {
      const age = Math.round(cut.ageDays ?? 0);
      const recTitle = `Consider retiring "${cut.title.slice(0, 60)}"`;
      if (!openRecTitles.has(recTitle)) {
        openRecTitles.add(recTitle);
        await insertRecommendation(supabase, userId, runId, {
          category: "cut",
          title: recTitle,
          rationale: atCapacity
            ? `Shop is at capacity (${publishedCount}/${targetListings}) and this is the weakest non-seller: ${cut.views} views in ${age} days, no sales.`
            : `${cut.views} views in ${age} days with no sales. Retiring is optional — a tag/photo/price fix may be the better move first.`,
          recommendedAction:
            "If you agree, deactivate it on Etsy (Listings → select → Deactivate). Ajax will not retire listings automatically.",
          priority: 2,
          etsyListingId: cut.listingId,
        });
        result.recommended += 1;
      }
    }
  } catch (err) {
    result.errors.push(
      `takedown: ${err instanceof Error ? err.message : "failed"}`,
    );
  }

  const { count: pendingReviews } = await supabase
    .from(TABLES.REVIEW_QUEUE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");

  if ((pendingReviews ?? 0) > 0) {
    // Self-clear the gate: autonomously review the oldest pending item so the
    // factory never freezes waiting on a human. Approve → downstream Etsy draft +
    // video + marketing via runPostApproval; autonomous "revise" counts as reject.
    try {
      const cleared = await autoReviewPending(supabase, userId, {
        reviewId: null,
        act: true,
      });
      if (cleared?.acted) {
        result.reviewsCleared += 1;
        if (cleared.postApproval) await runPostApproval(cleared.postApproval);
      } else if (cleared) {
        result.cycleBlocked = true;
      }
    } catch (err) {
      result.cycleBlocked = true;
      result.errors.push(
        `review: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  } else if (result.takenDown === 0 && publishedCount < targetListings) {
    try {
      const nova = await runNovaStep(supabase, userId);
      const forge = await runForgeStep(supabase, userId, { runId: nova.runId });
      try {
        await runGenerationPodJob(supabase, userId, forge.generationId);
      } catch (fulfillErr) {
        result.errors.push(
          `fulfillment: ${fulfillErr instanceof Error ? fulfillErr.message : "failed"}`,
        );
      }
      result.cycleTriggered = true;
    } catch (err) {
      if (err instanceof CycleBlockedError) {
        result.cycleBlocked = true;
      } else {
        result.errors.push(
          `cycle: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    }
  }

  // ---- Summary ---------------------------------------------------------------
  const acted =
    result.tagsFixed +
    result.shippingFixed +
    result.recommended +
    result.marketingQueued +
    result.reviewsCleared +
    result.takenDown +
    (result.cycleTriggered ? 1 : 0);
  await logEvent(
    supabase,
    userId,
    "autopilot_summary",
    acted > 0
      ? `Autopilot pass: audited ${result.audited} listing(s) — fixed ${result.tagsFixed + result.shippingFixed}, queued ${result.recommended} recommendation(s), ${result.marketingQueued} promo(s)${result.reviewsCleared ? `, cleared ${result.reviewsCleared} review(s) through the AI gate` : ""}${result.takenDown ? `, retired ${result.takenDown} underperforming listing(s)` : ""}${result.cycleTriggered ? ", started a new product cycle" : ""}${result.cycleBlocked ? " (cycle blocked: review failed)" : ""}.`
      : `Autopilot pass: audited ${result.audited} listing(s) — shop is healthy, no action needed${result.cycleBlocked ? " (new product blocked: AI review could not clear the gate)" : ""}.`,
    { runId, ...result } as unknown as Json,
  );

  result.ok = result.errors.length === 0;
  return result;
}

async function insertRecommendation(
  supabase: Supabase,
  userId: string,
  runId: string,
  rec: {
    category: string;
    title: string;
    rationale: string;
    recommendedAction: string;
    priority: number;
    etsyListingId: string;
  },
): Promise<void> {
  await supabase.from(TABLES.STRATEGY).insert({
    user_id: userId,
    run_id: runId,
    category: rec.category,
    title: rec.title,
    rationale: rec.rationale,
    recommended_action: rec.recommendedAction,
    priority: rec.priority,
    confidence: 80,
    evidence: { source: "shop_autopilot", etsyListingId: rec.etsyListingId } as Json,
    status: "proposed",
  });
}
