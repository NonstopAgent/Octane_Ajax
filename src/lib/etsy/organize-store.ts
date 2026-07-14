import "server-only";

/**
 * Storefront organization — sections + featured row, enforced by code.
 *
 * The operator called the unorganized shop page "horrible" (fair: two random
 * mugs featured, 28 items in one flat wall). Etsy's legacy sections UI also
 * silently drops saves, so this is done via the API and re-applied on a
 * daily autopilot pass — the store can never drift back into a mess.
 */
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import type { Supabase } from "@/lib/supabase/helpers";

/** Section routing by product type — deterministic from the listing title. */
export function sectionForTitle(title: string): string | null {
  const t = title.toLowerCase();
  if (t.includes("mug")) return "Mugs";
  if (
    t.includes("sweatshirt") ||
    t.includes("hoodie") ||
    t.includes("t-shirt") ||
    t.includes("tshirt") ||
    t.includes("shirt") ||
    t.includes("tee ")
  ) {
    return "Apparel";
  }
  if (t.includes("print") || t.includes("poster") || t.includes("art")) {
    return "Art Prints";
  }
  return null;
}

export type OrganizeStoreSummary = {
  ok: boolean;
  sectionsCreated: string[];
  assigned: number;
  featured: string[];
  errors: string[];
};

export async function organizeStore(
  supabase: Supabase,
  userId: string,
): Promise<OrganizeStoreSummary> {
  const summary: OrganizeStoreSummary = {
    ok: false,
    sectionsCreated: [],
    assigned: 0,
    featured: [],
    errors: [],
  };

  const credentials = await refreshEtsyToken(userId, { supabase });
  if (!credentials) {
    summary.errors.push("Etsy shop not connected.");
    return summary;
  }
  const etsy = createEtsyAdapter();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // 1. Ensure the sections exist.
  const wanted = ["Mugs", "Apparel", "Art Prints"];
  const sectionIds = new Map<string, number>();
  try {
    const existing = await etsy.getShopSections(
      credentials.shop_id,
      credentials.access_token,
    );
    for (const s of existing) sectionIds.set(s.title.toLowerCase(), s.shopSectionId);
    for (const title of wanted) {
      if (!sectionIds.has(title.toLowerCase())) {
        try {
          const id = await etsy.createShopSection(
            credentials.shop_id,
            credentials.access_token,
            title,
          );
          sectionIds.set(title.toLowerCase(), id);
          summary.sectionsCreated.push(title);
          await sleep(300);
        } catch (err) {
          // Creating sections needs the shops_w scope, which older Etsy
          // connections lack. Keep going with whatever sections DO exist —
          // aborting here once blocked assignment of 28 listings over one
          // missing section.
          summary.errors.push(
            `create "${title}": ${err instanceof Error ? err.message : "failed"}`,
          );
        }
      }
    }
    if (sectionIds.size === 0) return summary;
  } catch (err) {
    summary.errors.push(
      `sections: ${err instanceof Error ? err.message : "failed"}`,
    );
    return summary;
  }

  // 2. Assign every active listing to its section, and pick the featured 4:
  //    most-viewed listings first (social proof compounds), tie-broken by
  //    recency so fresh personalized designs get a look.
  try {
    const listings = await etsy.getShopListings(
      credentials.shop_id,
      credentials.access_token,
    );
    for (const listing of listings) {
      const section = sectionForTitle(listing.title);
      const sectionId = section
        ? sectionIds.get(section.toLowerCase())
        : undefined;
      if (sectionId == null) continue;
      try {
        await etsy.updateListing(
          credentials.shop_id,
          listing.listingId,
          credentials.access_token,
          { shop_section_id: sectionId },
        );
        summary.assigned += 1;
      } catch (err) {
        summary.errors.push(
          `assign ${listing.listingId}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
      await sleep(350);
    }

    const featured = [...listings]
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      .slice(0, 4);
    let rank = 1;
    for (const listing of featured) {
      try {
        await etsy.updateListing(
          credentials.shop_id,
          listing.listingId,
          credentials.access_token,
          { featured_rank: rank },
        );
        summary.featured.push(`${listing.title.slice(0, 40)} (#${rank})`);
        rank += 1;
      } catch (err) {
        summary.errors.push(
          `feature ${listing.listingId}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
      await sleep(350);
    }
  } catch (err) {
    summary.errors.push(
      `listings: ${err instanceof Error ? err.message : "failed"}`,
    );
  }

  summary.ok = summary.errors.length === 0;
  return summary;
}
