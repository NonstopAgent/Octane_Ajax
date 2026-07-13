import "server-only";

/**
 * Affiliate link registry — every outbound product link in a guide goes
 * through /go/{slug} so clicks are tracked and networks are swappable.
 *
 * Phase 1: our own Etsy listings (etsy_own) + affiliate networks that
 * decorate URLs from env tags (dormant until the operator adds them):
 *   AFFILIATE_AMAZON_TAG   → Amazon Associates tag ("gotchaday-20")
 *   AFFILIATE_AWIN_ETSY_ID → Awin publisher id for Etsy's program
 * Phase 2: shop_affiliate rows carry partner_code + commission_pct so
 * creators promoting GotchaDayGoods reuse the same rails.
 */
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type AffiliateNetwork =
  | "etsy_own"
  | "amazon"
  | "chewy"
  | "awin_etsy"
  | "generic"
  | "shop_affiliate";

export function slugify(value: string, maxLen = 60): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
}

/**
 * Append the network's tracking parameters when configured. Idempotent —
 * safe to run at both link-creation time and redirect time, so env tags
 * added later apply retroactively to already-stored links.
 */
export function decorateUrl(url: string, network: AffiliateNetwork): string {
  try {
    const u = new URL(url);
    // Already wrapped by a network deep-link (e.g. Awin) — leave untouched.
    if (u.hostname === "www.awin1.com" || u.hostname === "awin1.com") {
      return url;
    }
    if (network === "amazon") {
      const tag = process.env.AFFILIATE_AMAZON_TAG?.trim();
      if (tag) u.searchParams.set("tag", tag);
    }
    if (network === "etsy_own" || network === "shop_affiliate") {
      u.searchParams.set("utm_source", "gotchaday_guides");
      u.searchParams.set("utm_medium", "affiliate_site");
    }
    if (network === "awin_etsy") {
      const awinId = process.env.AFFILIATE_AWIN_ETSY_ID?.trim();
      if (awinId) {
        // Awin deep link wrapper for Etsy's affiliate program.
        return `https://www.awin1.com/cread.php?awinmid=6220&awinaffid=${encodeURIComponent(
          awinId,
        )}&ued=${encodeURIComponent(u.toString())}`;
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** Upsert a tracked link; returns the public /go path. */
export async function ensureLink(
  supabase: Supabase,
  userId: string,
  input: {
    destinationUrl: string;
    network: AffiliateNetwork;
    label?: string;
    slug?: string;
  },
): Promise<string> {
  const slug =
    input.slug?.trim() ||
    slugify(input.label ?? new URL(input.destinationUrl).pathname) ||
    `link-${Date.now().toString(36)}`;
  const destination = decorateUrl(input.destinationUrl, input.network);

  const { data: existing } = await supabase
    .from(TABLES.AFFILIATE_LINKS)
    .select("id, slug")
    .eq("user_id", userId)
    .eq("slug", slug)
    .maybeSingle();

  if (existing?.slug) {
    await supabase
      .from(TABLES.AFFILIATE_LINKS)
      .update({ destination_url: destination, network: input.network })
      .eq("id", existing.id);
    return `/go/${existing.slug}`;
  }

  const { error } = await supabase.from(TABLES.AFFILIATE_LINKS).insert({
    user_id: userId,
    slug,
    destination_url: destination,
    network: input.network,
    label: input.label ?? null,
  });
  if (error) {
    // Slug collision under another label — fall back to a unique suffix.
    const fallback = `${slug}-${Date.now().toString(36).slice(-4)}`;
    await supabase.from(TABLES.AFFILIATE_LINKS).insert({
      user_id: userId,
      slug: fallback,
      destination_url: destination,
      network: input.network,
      label: input.label ?? null,
    });
    return `/go/${fallback}`;
  }
  return `/go/${slug}`;
}
