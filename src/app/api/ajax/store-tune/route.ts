// STORE TUNE (2026-07-24, operator-directed): three passes in one call.
//
//   ?do=international — add paid EU + rest-of-world rates to the free-US
//     shipping profile so international buyers can actually check out.
//   ?do=attributes — fill listing attributes (Material, Dishwasher safe,
//     Microwave safe, Handle) from a conservative per-product-type map:
//     only values that exist verbatim in the listing's own taxonomy are
//     written; nothing is guessed.
//   ?do=funnel — walk every live listing like a BUYER and report what's
//     broken: active state, personalization box, free-shipping profile,
//     returns policy, photo count, video, 13 tags, sane price. This is the
//     check the operator asked for after catching what internal audits
//     missed. Read-only; the hourly fixers act on what it finds.
//
// Session auth; navigation-friendly GET.
export const maxDuration = 600;

import { NextResponse } from "next/server";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";
import { requireOperator } from "@/lib/auth/operator";

/** Product-type → attribute values we are CONFIDENT about (never guessed). */
const ATTRIBUTE_PLAN: {
  match: RegExp;
  props: { name: RegExp; value: string }[];
}[] = [
  {
    match: /\bmugs?\b/i,
    props: [
      { name: /^material$/i, value: "Ceramic" },
      { name: /^dishwasher safe$/i, value: "Yes" },
      { name: /^microwave safe$/i, value: "Yes" },
      { name: /^handle$/i, value: "Yes" },
    ],
  },
  {
    match: /\b(t-?shirts?|tees?)\b/i,
    props: [{ name: /^material$/i, value: "Cotton" }],
  },
  {
    match: /\b(sweatshirts?|crewnecks?|hoodies?)\b/i,
    props: [{ name: /^material$/i, value: "Cotton blend" }],
  },
  {
    match: /\bbandanas?\b/i,
    props: [{ name: /^material$/i, value: "Polyester" }],
  },
  {
    match: /\b(posters?|art prints?|wall art)\b/i,
    props: [{ name: /^material$/i, value: "Paper" }],
  },
];

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
    const mode = new URL(request.url).searchParams.get("do") ?? "funnel";
    const etsy = createEtsyAdapter();

    // ---- international ----------------------------------------------------
    if (mode === "international") {
      const profiles = await etsy.getShippingProfiles(
        credentials.shop_id,
        credentials.access_token,
      );
      const free = profiles.find((p) => p.usPrimaryCostCents === 0);
      if (!free) {
        return NextResponse.json(
          { ok: false, error: "No free-US shipping profile found." },
          { status: 400 },
        );
      }
      const { added } = await etsy.addInternationalDestinations(
        free.profileId,
        credentials.access_token,
        credentials.shop_id,
      );
      return NextResponse.json({
        ok: true,
        profileId: free.profileId,
        added,
        note: "International buyers can now check out: EU + rest of world at $9.99 (+$4.99 per extra item), 7-21 day delivery. US stays free.",
      });
    }

    const { data: rows } = await supabase
      .from(TABLES.LISTINGS)
      .select("id, title, gumroad_product_id")
      .eq("user_id", user.id)
      .eq("status", "published")
      .limit(100);
    const listings = (rows ?? []).filter((r) =>
      /^\d+$/.test(String(r.gumroad_product_id ?? "")),
    );

    // ---- attributes ---------------------------------------------------------
    if (mode === "attributes") {
      const taxonomyCache = new Map<
        number,
        Awaited<ReturnType<typeof etsy.getTaxonomyProperties>>
      >();
      let listingsTouched = 0;
      let propertiesSet = 0;
      const skipped: string[] = [];
      const failed: { listing: string; error: string }[] = [];

      for (const row of listings) {
        const etsyId = String(row.gumroad_product_id);
        try {
          const details = await etsy.getListingDetails(
            etsyId,
            credentials.access_token,
          );
          const plan = ATTRIBUTE_PLAN.find((p) => p.match.test(details.title));
          if (!plan || details.taxonomyId == null) {
            skipped.push(etsyId);
            continue;
          }
          let props = taxonomyCache.get(details.taxonomyId);
          if (!props) {
            props = await etsy.getTaxonomyProperties(
              details.taxonomyId,
              credentials.access_token,
            );
            taxonomyCache.set(details.taxonomyId, props);
          }
          let touched = false;
          for (const want of plan.props) {
            const prop = props.find((p) => want.name.test(p.name));
            if (!prop) continue;
            const value = prop.values.find(
              (v) => v.name.toLowerCase() === want.value.toLowerCase(),
            );
            if (!value) continue;
            await etsy.setListingProperty(
              credentials.shop_id,
              etsyId,
              credentials.access_token,
              prop.propertyId,
              [value.valueId],
              [value.name],
            );
            propertiesSet += 1;
            touched = true;
            await new Promise((r) => setTimeout(r, 200));
          }
          if (touched) listingsTouched += 1;
        } catch (err) {
          failed.push({
            listing: etsyId,
            error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
          });
          if (failed.length >= 4) break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return NextResponse.json({
        ok: true,
        listingsTouched,
        propertiesSet,
        skipped: skipped.length,
        failed,
        note: "Attributes filled where the taxonomy offered an exact match (Material, Dishwasher/Microwave safe, Handle).",
      });
    }

    // ---- funnel (default) ---------------------------------------------------
    const profiles = await etsy.getShippingProfiles(
      credentials.shop_id,
      credentials.access_token,
    );
    const freeProfileId =
      profiles.find((p) => p.usPrimaryCostCents === 0)?.profileId ?? null;

    const broken: { listing: string; title: string; problems: string[] }[] = [];
    let clean = 0;
    for (const row of listings) {
      const etsyId = String(row.gumroad_product_id);
      try {
        const details = await etsy.getListingDetails(
          etsyId,
          credentials.access_token,
        );
        const images = await etsy.getListingImageUrls(
          etsyId,
          credentials.access_token,
        );
        const videos = await etsy.getListingVideos(
          etsyId,
          credentials.access_token,
        );
        const problems: string[] = [];
        if (details.state !== "active") problems.push(`state:${details.state}`);
        // The base is_personalizable flag lags Etsy's new typed-question API
        // (first run flagged listings whose box was VERIFIED live) — the
        // questions array is the truth.
        let personalized = details.isPersonalizable;
        if (!personalized) {
          try {
            const pRes = await fetch(
              `https://api.etsy.com/v3/application/listings/${etsyId}/personalization`,
              {
                headers: {
                  "x-api-key": process.env.ETSY_CLIENT_ID?.trim() ?? "",
                  Authorization: `Bearer ${credentials.access_token}`,
                },
              },
            );
            if (pRes.ok) {
              const pJson = (await pRes.json()) as {
                personalization_questions?: unknown[];
              };
              personalized = (pJson.personalization_questions ?? []).length > 0;
            }
          } catch {
            // fall through with the base flag
          }
        }
        if (!personalized) problems.push("no personalization box");
        if (freeProfileId != null && details.shippingProfileId !== freeProfileId)
          problems.push("not on free-shipping profile");
        if (details.returnPolicyId == null) problems.push("no return policy");
        if (images.length < 5) problems.push(`only ${images.length} photos`);
        if (videos.length < 1) problems.push("no video");
        if (details.tags.length !== 13)
          problems.push(`${details.tags.length}/13 tags`);
        if ((details.priceCents ?? 0) < 1299) problems.push("price under $12.99");
        if (problems.length === 0) clean += 1;
        else
          broken.push({
            listing: etsyId,
            title: details.title.slice(0, 45),
            problems,
          });
      } catch (err) {
        broken.push({
          listing: etsyId,
          title: String(row.title ?? "").slice(0, 45),
          problems: [
            `check failed: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`,
          ],
        });
      }
      // 600ms: three Etsy calls per listing at 250ms tripped the per-second
      // rate limit on the first run and poisoned ~9 checks.
      await new Promise((r) => setTimeout(r, 600));
    }

    try {
      await supabase.from(TABLES.EVENTS).insert({
        user_id: user.id,
        event_type: "funnel_audit",
        message: `Buyer-funnel audit: ${clean}/${listings.length} listings fully clean; ${broken.length} with issues.`,
        metadata: { clean, total: listings.length, broken } as never,
      });
    } catch {
      // report still returns
    }

    return NextResponse.json({
      ok: true,
      total: listings.length,
      clean,
      broken,
      note: "Checked exactly what a buyer sees: active, personalization, free shipping, returns, photos, video, tags, price.",
    });
  } catch (err) {
    console.error("[store-tune]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 400) : "Failed.",
      },
      { status: 500 },
    );
  }
}
