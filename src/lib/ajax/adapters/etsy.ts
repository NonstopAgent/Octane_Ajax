/**
 * Etsy Open API v3 adapter — server-side only.
 *
 * Uses ETSY_CLIENT_ID for x-api-key and per-user OAuth Bearer tokens.
 * Never import from Client Components.
 */

import { listingPriceToCents } from "@/lib/ajax/adapters/gumroad";

// Etsy v3 resource endpoints are served from openapi.etsy.com (api.etsy.com only
// hosts the OAuth token endpoint). Using api.etsy.com here causes a misleading
// 403 "Shared secret is required in x-api-key header".
const ETSY_API_BASE = "https://openapi.etsy.com/v3/application";

/** Digital downloads taxonomy (user-specified). */
export const ETSY_DIGITAL_TAXONOMY_ID = 2078;

export class EtsyAdapterError extends Error {
  readonly code = "ETSY_ADAPTER_ERROR" as const;

  constructor(
    message: string,
    readonly statusCode?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EtsyAdapterError";
  }
}

export type EtsyCreateDraftListingInput = {
  title: string;
  description: string;
  price_cents: number;
  /** Optional Etsy taxonomy id. Omitted by default (no hardcoded digital category). */
  taxonomy_id?: number;
  /** Physical listings require a shipping profile; auto-resolved if omitted. */
  shipping_profile_id?: number;
  /** Etsy requires a return policy for physical listings; auto-resolved if omitted. */
  return_policy_id?: number;
  tags?: string[];
  shopId: string;
  accessToken: string;
};

export type EtsyCreateDraftListingResult = {
  listing_id: string;
  url: string;
};

export type EtsyAdapterOptions = {
  clientId?: string;
  /** Etsy app shared secret; combined with the keystring for the x-api-key header. */
  sharedSecret?: string;
  fetchImpl?: typeof fetch;
};

/** A shop's own listing with lifetime engagement counters (analytics poller). */
export type EtsyShopListing = {
  listingId: string;
  title: string;
  views: number;
  favorites: number;
};

/** Orders + revenue attributed per Etsy listing id from recent receipts. */
export type EtsyReceiptsByListing = Record<
  string,
  { orders: number; revenueCents: number }
>;

/** SEO-relevant fields of a single listing (autopilot audit). */
export type EtsyListingDetails = {
  listingId: string;
  state: string;
  title: string;
  description: string;
  tags: string[];
  shippingProfileId: number | null;
  returnPolicyId: number | null;
  priceCents: number | null;
};

/** Shipping profile with its US buyer cost (autopilot free-shipping audit). */
export type EtsyShippingProfileSummary = {
  profileId: number;
  title: string;
  /** Primary cost in cents for US destination; null when no US destination. */
  usPrimaryCostCents: number | null;
};

/** Fields the autopilot may patch on a live listing. */
export type EtsyListingPatch = {
  tags?: string[];
  title?: string;
  description?: string;
  shipping_profile_id?: number;
  return_policy_id?: number;
  /** Shop section (storefront navigation category). */
  shop_section_id?: number;
  /** 1-4 puts the listing in the shop's Featured row; 0/absent leaves it. */
  featured_rank?: number;
  /** Listing lifecycle state — deactivate broken listings / reactivate fixed ones. */
  state?: "active" | "inactive";
  /** Buyer personalization (the moat: name/date/photo-link customization). */
  personalization_is_required?: boolean;
  personalization_char_count_max?: number;
  personalization_instructions?: string;
  /** Etsy seller-policy compliance: POD listings must disclose their production partner(s). */
  production_partner_ids?: number[];
};

/** Raw receipt slice for the personalization order intake poller. */
export type EtsyReceiptRaw = {
  receiptId: string;
  createdTimestamp: number | null;
  buyerName: string | null;
  shipping: {
    name?: string;
    first_line?: string;
    second_line?: string;
    city?: string;
    state?: string;
    zip?: string;
    country_iso?: string;
  };
  transactions: {
    listingId: string | null;
    quantity: number;
    variations: { formatted_name?: string; formatted_value?: string }[];
  }[];
};

/** A node in Etsy's seller taxonomy tree. */
export type EtsyTaxonomyNode = {
  id: number;
  name: string;
  level?: number;
  children?: EtsyTaxonomyNode[];
};

let taxonomyCache: EtsyTaxonomyNode[] | null = null;

function flattenTaxonomy(
  nodes: EtsyTaxonomyNode[],
  acc: EtsyTaxonomyNode[] = [],
): EtsyTaxonomyNode[] {
  for (const n of nodes) {
    acc.push(n);
    if (n.children?.length) flattenTaxonomy(n.children, acc);
  }
  return acc;
}

/** Picks a valid LEAF taxonomy id matching hints, with print/first-leaf fallbacks. */
function pickTaxonomyLeaf(nodes: EtsyTaxonomyNode[], hints: string[]): number {
  const leaves = flattenTaxonomy(nodes).filter(
    (n) => !n.children || n.children.length === 0,
  );
  for (const hint of hints.map((h) => h.toLowerCase()).filter(Boolean)) {
    const match = leaves.find((n) => n.name.toLowerCase().includes(hint));
    if (match) return match.id;
  }
  const printLeaf = leaves.find((n) => n.name.toLowerCase().includes("print"));
  if (printLeaf) return printLeaf.id;
  if (leaves[0]) return leaves[0].id;
  throw new EtsyAdapterError("Etsy seller taxonomy returned no categories.");
}

async function loadSellerTaxonomy(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<EtsyTaxonomyNode[]> {
  if (taxonomyCache) return taxonomyCache;
  const response = await fetchImpl(`${ETSY_API_BASE}/seller-taxonomy/nodes`, {
    headers: { "x-api-key": apiKey, Accept: "application/json" },
  });
  const parsed = await parseEtsyJson<{ results?: EtsyTaxonomyNode[] }>(response);
  taxonomyCache = parsed.results ?? [];
  return taxonomyCache;
}

/** Reads the first numeric `key` from a shop sub-resource list. Never throws. */
async function firstShopResourceId(
  url: string,
  key: string,
  headers: HeadersInit,
  fetchImpl: typeof fetch,
): Promise<number | undefined> {
  try {
    const res = await fetchImpl(url, { headers });
    if (!res.ok) return undefined;
    const parsed = (await res.json()) as { results?: Record<string, unknown>[] };
    const val = parsed.results?.[0]?.[key];
    return typeof val === "number" ? val : undefined;
  } catch {
    return undefined;
  }
}

function getClientId(explicit?: string): string {
  const clientId = explicit ?? process.env.ETSY_CLIENT_ID?.trim();
  if (!clientId) {
    throw new EtsyAdapterError("ETSY_CLIENT_ID is not configured.");
  }
  return clientId;
}

function authHeaders(apiKey: string, accessToken: string): HeadersInit {
  return {
    "x-api-key": apiKey,
    Authorization: `Bearer ${accessToken}`,
  };
}

async function parseEtsyJson<T extends Record<string, unknown>>(
  response: Response,
): Promise<T> {
  const text = await response.text();
  let body: T & { error?: string } = {} as T;
  if (text) {
    try {
      body = JSON.parse(text) as T & { error?: string };
    } catch {
      throw new EtsyAdapterError(
        `Etsy returned non-JSON (${response.status}).`,
        response.status,
      );
    }
  }

  if (!response.ok) {
    throw new EtsyAdapterError(
      (body.error as string | undefined) ??
        `Etsy API error (${response.status}).`,
      response.status,
    );
  }

  return body;
}

function listingUrlFromResponse(
  listingId: string,
  body: { url?: string },
): string {
  const url = body.url?.trim();
  if (url) return url;
  return `https://www.etsy.com/listing/${listingId}`;
}

export function createEtsyAdapter(options: EtsyAdapterOptions = {}) {
  const clientId = getClientId(options.clientId);
  const sharedSecret =
    options.sharedSecret ?? process.env.ETSY_CLIENT_SECRET?.trim();
  // Etsy v3 requires x-api-key = "keystring:shared_secret" (colon-separated).
  const apiKeyHeader = sharedSecret ? `${clientId}:${sharedSecret}` : clientId;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async createDraftListing(
      input: EtsyCreateDraftListingInput,
    ): Promise<EtsyCreateDraftListingResult> {
      const body = new URLSearchParams();
      body.set("quantity", "999");
      body.set("title", input.title.trim() || "Print-on-demand product");
      body.set(
        "description",
        input.description.trim() || "Made-to-order print-on-demand product.",
      );
      body.set("price", String((input.price_cents / 100).toFixed(2)));
      // Physical POD produced by a partner (Printify) — not a digital download.
      body.set("who_made", "someone_else");
      body.set("when_made", "2020_2026");
      if (input.taxonomy_id != null) {
        body.set("taxonomy_id", String(input.taxonomy_id));
      }

      // Physical listings require a shipping profile (and Etsy requires a return
      // policy). Use the ones provided, else the shop's first of each.
      const shippingProfileId =
        input.shipping_profile_id ??
        (await firstShopResourceId(
          `${ETSY_API_BASE}/shops/${input.shopId}/shipping-profiles`,
          "shipping_profile_id",
          authHeaders(apiKeyHeader, input.accessToken),
          fetchImpl,
        ));
      if (shippingProfileId != null) {
        body.set("shipping_profile_id", String(shippingProfileId));
      }

      const returnPolicyId =
        input.return_policy_id ??
        (await firstShopResourceId(
          `${ETSY_API_BASE}/shops/${input.shopId}/policies/return`,
          "return_policy_id",
          authHeaders(apiKeyHeader, input.accessToken),
          fetchImpl,
        ));
      if (returnPolicyId != null) {
        body.set("return_policy_id", String(returnPolicyId));
      }

      body.set("type", "physical");
      // CRITICAL: drafts only. Never auto-publish live — the human Review Gate decides.
      body.set("state", "draft");
      body.set("is_supply", "false");

      const tags = (input.tags ?? [])
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 13);
      for (const tag of tags) {
        body.append("tags[]", tag);
      }

      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${input.shopId}/listings`,
        {
          method: "POST",
          headers: {
            ...authHeaders(apiKeyHeader, input.accessToken),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
      );

      const parsed = await parseEtsyJson<{
        listing_id?: number;
        url?: string;
      }>(response);

      const listingId =
        parsed.listing_id != null ? String(parsed.listing_id) : null;
      if (!listingId) {
        throw new EtsyAdapterError("Etsy response missing listing_id.");
      }

      return {
        listing_id: listingId,
        url: listingUrlFromResponse(listingId, parsed),
      };
    },

    async uploadListingFile(
      listingId: string,
      fileBuffer: Buffer,
      filename: string,
      shopId: string,
      accessToken: string,
    ): Promise<void> {
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(fileBuffer)], { type: "application/pdf" }),
        filename,
      );

      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/files`,
        {
          method: "POST",
          headers: authHeaders(apiKeyHeader, accessToken),
          body: form,
        },
      );

      if (!response.ok) {
        await parseEtsyJson(response);
      }
    },

    async uploadListingImage(
      listingId: string,
      imageBuffer: Buffer,
      filename: string,
      shopId: string,
      accessToken: string,
      rank?: number,
    ): Promise<{ listing_image_id: string }> {
      const form = new FormData();
      form.append(
        "image",
        new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" }),
        filename,
      );
      form.append("rank", String(rank ?? 1));

      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/images`,
        {
          method: "POST",
          headers: authHeaders(apiKeyHeader, accessToken),
          body: form,
        },
      );

      const parsed = await parseEtsyJson<{ listing_image_id?: number }>(response);
      const imageId =
        parsed.listing_image_id != null
          ? String(parsed.listing_image_id)
          : "unknown";
      return { listing_image_id: imageId };
    },

    /** Ids of the videos currently on a listing (Etsy allows at most one). */
    async getListingVideos(
      listingId: string,
      accessToken: string,
    ): Promise<string[]> {
      const response = await fetchImpl(
        `${ETSY_API_BASE}/listings/${listingId}/videos`,
        { headers: authHeaders(apiKeyHeader, accessToken) },
      );
      const parsed = await parseEtsyJson<{
        results?: { video_id?: number }[];
      }>(response);
      return (parsed.results ?? [])
        .map((r) => (r.video_id != null ? String(r.video_id) : ""))
        .filter(Boolean);
    },

    /**
     * Remove a listing's video. Repaired listings whose fresh render hasn't
     * cleared the daily cap still carry the OLD clip showing the broken
     * design — no video beats a broken video.
     */
    async deleteListingVideo(
      listingId: string,
      videoId: string,
      shopId: string,
      accessToken: string,
    ): Promise<void> {
      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/videos/${videoId}`,
        {
          method: "DELETE",
          headers: authHeaders(apiKeyHeader, accessToken),
        },
      );
      if (!response.ok && response.status !== 404) {
        const body = await response.text();
        throw new Error(
          `Etsy video delete failed (${response.status}): ${body.slice(0, 200)}`,
        );
      }
    },

    /**
     * Remove one image from a listing. Used by the gallery wipe-and-rebuild:
     * Printify regenerates mockups SLOWLY after a placement fix, so galleries
     * synced at publish time can mix fresh fronts with stale broken context
     * shots — those stale photos never self-heal and must be deleted after
     * the fresh set uploads.
     */
    async deleteListingImage(
      listingId: string,
      listingImageId: string,
      shopId: string,
      accessToken: string,
    ): Promise<void> {
      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/images/${listingImageId}`,
        {
          method: "DELETE",
          headers: authHeaders(apiKeyHeader, accessToken),
        },
      );
      if (!response.ok && response.status !== 404) {
        const body = await response.text();
        throw new Error(
          `Etsy image delete failed (${response.status}): ${body.slice(0, 200)}`,
        );
      }
    },

    /** Ids of the images currently on a listing (gallery idempotency check). */
    async getListingImages(
      listingId: string,
      accessToken: string,
    ): Promise<string[]> {
      const response = await fetchImpl(
        `${ETSY_API_BASE}/listings/${listingId}/images`,
        { headers: authHeaders(apiKeyHeader, accessToken) },
      );
      const parsed = await parseEtsyJson<{
        results?: { listing_image_id?: number }[];
      }>(response);
      return (parsed.results ?? [])
        .map((r) =>
          r.listing_image_id != null ? String(r.listing_image_id) : "",
        )
        .filter(Boolean);
    },

    /**
     * Public CDN URLs (full size, rank order) of a listing's images. Etsy
     * serves these as JPEG — which TikTok's photo posts require (it rejects
     * PNG) — so social posts prefer these over raw Printify mockup PNGs.
     */
    async getListingImageUrls(
      listingId: string,
      accessToken: string,
    ): Promise<string[]> {
      const response = await fetchImpl(
        `${ETSY_API_BASE}/listings/${listingId}/images`,
        { headers: authHeaders(apiKeyHeader, accessToken) },
      );
      const parsed = await parseEtsyJson<{
        results?: { url_fullxfull?: string; rank?: number }[];
      }>(response);
      return (parsed.results ?? [])
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
        .map((r) => r.url_fullxfull ?? "")
        .filter((u) => u.startsWith("https://"));
    },

    /**
     * Attach a product video to a listing (Etsy allows one; audio is stripped;
     * 5–15s, ≤100MB, mp4/h264, 1:1 recommended). Mirrors uploadListingImage.
     */
    async uploadListingVideo(
      listingId: string,
      videoBuffer: Buffer,
      filename: string,
      shopId: string,
      accessToken: string,
      name?: string,
    ): Promise<{ listing_video_id: string }> {
      const form = new FormData();
      form.append(
        "video",
        new Blob([new Uint8Array(videoBuffer)], { type: "video/mp4" }),
        filename,
      );
      form.append("name", (name ?? filename).slice(0, 70));

      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}/videos`,
        {
          method: "POST",
          headers: authHeaders(apiKeyHeader, accessToken),
          body: form,
        },
      );

      const parsed = await parseEtsyJson<{ listing_video_id?: number }>(
        response,
      );
      const videoId =
        parsed.listing_video_id != null
          ? String(parsed.listing_video_id)
          : "unknown";
      return { listing_video_id: videoId };
    },

    /**
     * Reads the shop's active listings with lifetime views + favorites. Etsy
     * exposes only lifetime counters (no daily series), so the analytics poller
     * snapshots these daily and derives velocity from the deltas.
     */
    /** Storefront navigation sections ({id, title} pairs). */
    async getShopSections(
      shopId: string,
      accessToken: string,
    ): Promise<{ shopSectionId: number; title: string }[]> {
      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/sections`,
        { headers: authHeaders(apiKeyHeader, accessToken) },
      );
      const parsed = await parseEtsyJson<{
        results?: { shop_section_id?: number; title?: string }[];
      }>(response);
      return (parsed.results ?? [])
        .filter((s) => s.shop_section_id != null)
        .map((s) => ({
          shopSectionId: s.shop_section_id!,
          title: s.title ?? "",
        }));
    },

    /** Shop-level production partners (e.g. Printify) for listing compliance. */
    async getProductionPartnerIds(
      shopId: string,
      accessToken: string,
    ): Promise<number[]> {
      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/production-partners`,
        { headers: authHeaders(apiKeyHeader, accessToken) },
      );
      const parsed = await parseEtsyJson<{
        results?: { production_partner_id?: number }[];
      }>(response);
      return (parsed.results ?? [])
        .map((p) => p.production_partner_id)
        .filter((id): id is number => id != null);
    },

    /** Create a storefront section; returns its id. */
    async createShopSection(
      shopId: string,
      accessToken: string,
      title: string,
    ): Promise<number> {
      const body = new URLSearchParams({ title });
      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/sections`,
        {
          method: "POST",
          headers: {
            ...authHeaders(apiKeyHeader, accessToken),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
      );
      const parsed = await parseEtsyJson<{ shop_section_id?: number }>(
        response,
      );
      if (parsed.shop_section_id == null) {
        throw new Error("Etsy createShopSection returned no id.");
      }
      return parsed.shop_section_id;
    },

    async getShopListings(
      shopId: string,
      accessToken: string,
      limit = 100,
    ): Promise<EtsyShopListing[]> {
      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/listings/active?limit=${limit}`,
        { headers: authHeaders(apiKeyHeader, accessToken) },
      );
      const parsed = await parseEtsyJson<{
        results?: {
          listing_id?: number;
          title?: string;
          views?: number;
          num_favorers?: number;
        }[];
      }>(response);
      return (parsed.results ?? [])
        .map((r) => ({
          listingId: r.listing_id != null ? String(r.listing_id) : "",
          title: (r.title ?? "").trim(),
          views: Number(r.views ?? 0),
          favorites: Number(r.num_favorers ?? 0),
        }))
        .filter((r) => r.listingId);
    },

    /**
     * Sums orders + revenue per listing from receipts created since `minCreated`
     * (unix seconds). Requires the `transactions_r` scope — shops authorized
     * before it was added will 403 here until they reconnect Etsy.
     */
    /** SEO-relevant fields of one listing — tags, shipping, returns, price. */
    async getListingDetails(
      listingId: string,
      accessToken: string,
    ): Promise<EtsyListingDetails> {
      const response = await fetchImpl(`${ETSY_API_BASE}/listings/${listingId}`, {
        headers: authHeaders(apiKeyHeader, accessToken),
      });
      const r = await parseEtsyJson<{
        listing_id?: number;
        state?: string;
        title?: string;
        description?: string;
        tags?: string[];
        shipping_profile_id?: number | null;
        return_policy_id?: number | null;
        price?: { amount?: number; divisor?: number };
      }>(response);
      const amount = Number(r.price?.amount ?? 0);
      const divisor = Number(r.price?.divisor ?? 100) || 100;
      return {
        listingId: r.listing_id != null ? String(r.listing_id) : listingId,
        state: (r.state ?? "").trim(),
        title: (r.title ?? "").trim(),
        description: (r.description ?? "").trim(),
        tags: (r.tags ?? []).map((t) => String(t)),
        shippingProfileId: r.shipping_profile_id ?? null,
        returnPolicyId: r.return_policy_id ?? null,
        priceCents: amount > 0 ? Math.round((amount / divisor) * 100) : null,
      };
    },

    /** Shop shipping profiles with their US primary cost (free-shipping audit). */
    async getShippingProfiles(
      shopId: string,
      accessToken: string,
    ): Promise<EtsyShippingProfileSummary[]> {
      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/shipping-profiles`,
        { headers: authHeaders(apiKeyHeader, accessToken) },
      );
      const parsed = await parseEtsyJson<{
        results?: {
          shipping_profile_id?: number;
          title?: string;
          shipping_profile_destinations?: {
            destination_country_iso?: string;
            primary_cost?: { amount?: number; divisor?: number };
          }[];
        }[];
      }>(response);
      return (parsed.results ?? [])
        .filter((p) => p.shipping_profile_id != null)
        .map((p) => {
          const us = (p.shipping_profile_destinations ?? []).find(
            (d) => (d.destination_country_iso ?? "").toUpperCase() === "US",
          );
          const amount = Number(us?.primary_cost?.amount ?? NaN);
          const divisor = Number(us?.primary_cost?.divisor ?? 100) || 100;
          return {
            profileId: Number(p.shipping_profile_id),
            title: (p.title ?? "").trim(),
            usPrimaryCostCents: Number.isFinite(amount)
              ? Math.round((amount / divisor) * 100)
              : null,
          };
        });
    },

    /** Patches a live listing (tags / shipping profile / return policy). */
    async updateListing(
      shopId: string,
      listingId: string,
      accessToken: string,
      patch: EtsyListingPatch,
    ): Promise<void> {
      const body = new URLSearchParams();
      if (patch.tags) body.set("tags", patch.tags.join(","));
      if (patch.title) body.set("title", patch.title);
      if (patch.description) body.set("description", patch.description);
      if (patch.personalization_is_required != null) {
        body.set(
          "personalization_is_required",
          String(patch.personalization_is_required),
        );
      }
      if (patch.personalization_char_count_max != null) {
        body.set(
          "personalization_char_count_max",
          String(patch.personalization_char_count_max),
        );
      }
      if (patch.personalization_instructions) {
        body.set(
          "personalization_instructions",
          patch.personalization_instructions,
        );
      }
      if (patch.shipping_profile_id != null) {
        body.set("shipping_profile_id", String(patch.shipping_profile_id));
      }
      if (patch.return_policy_id != null) {
        body.set("return_policy_id", String(patch.return_policy_id));
      }
      if (patch.shop_section_id != null) {
        body.set("shop_section_id", String(patch.shop_section_id));
      }
      if (patch.featured_rank != null) {
        body.set("featured_rank", String(patch.featured_rank));
      }
      if (patch.state) {
        body.set("state", patch.state);
      }
      if (patch.production_partner_ids?.length) {
        body.set(
          "production_partner_ids",
          patch.production_partner_ids.join(","),
        );
      }
      if ([...body.keys()].length === 0) return;

      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/listings/${listingId}`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(apiKeyHeader, accessToken),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
      );
      await parseEtsyJson(response);
    },

    async getShopReceipts(
      shopId: string,
      accessToken: string,
      minCreated?: number,
    ): Promise<EtsyReceiptsByListing> {
      const params = new URLSearchParams({ limit: "100" });
      if (minCreated && minCreated > 0) {
        params.set("min_created", String(Math.floor(minCreated)));
      }
      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/receipts?${params.toString()}`,
        { headers: authHeaders(apiKeyHeader, accessToken) },
      );
      const parsed = await parseEtsyJson<{
        results?: {
          transactions?: {
            listing_id?: number;
            quantity?: number;
            price?: { amount?: number; divisor?: number };
          }[];
        }[];
      }>(response);

      const byListing: EtsyReceiptsByListing = {};
      for (const receipt of parsed.results ?? []) {
        for (const txn of receipt.transactions ?? []) {
          if (txn.listing_id == null) continue;
          const lid = String(txn.listing_id);
          const qty = Number(txn.quantity ?? 1) || 1;
          const amount = Number(txn.price?.amount ?? 0);
          const divisor = Number(txn.price?.divisor ?? 100) || 100;
          const lineCents = Math.round((amount / divisor) * 100) * qty;
          const entry = (byListing[lid] ??= { orders: 0, revenueCents: 0 });
          entry.orders += qty;
          entry.revenueCents += lineCents;
        }
      }
      return byListing;
    },

    /**
     * Raw receipts with per-transaction variations — the intake poller scans
     * these for buyer personalization (Etsy has no order webhooks, so Room 2's
     * entry point is this hourly poll).
     */
    async getShopReceiptsRaw(
      shopId: string,
      accessToken: string,
      minCreated?: number,
    ): Promise<EtsyReceiptRaw[]> {
      const params = new URLSearchParams({ limit: "100" });
      if (minCreated && minCreated > 0) {
        params.set("min_created", String(Math.floor(minCreated)));
      }
      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/receipts?${params.toString()}`,
        { headers: authHeaders(apiKeyHeader, accessToken) },
      );
      const parsed = await parseEtsyJson<{
        results?: {
          receipt_id?: number;
          created_timestamp?: number;
          name?: string;
          first_line?: string;
          second_line?: string;
          city?: string;
          state?: string;
          zip?: string;
          country_iso?: string;
          transactions?: {
            listing_id?: number;
            quantity?: number;
            variations?: {
              formatted_name?: string;
              formatted_value?: string;
            }[];
          }[];
        }[];
      }>(response);

      return (parsed.results ?? [])
        .filter((r) => r.receipt_id != null)
        .map((r) => ({
          receiptId: String(r.receipt_id),
          createdTimestamp: r.created_timestamp ?? null,
          buyerName: r.name ?? null,
          shipping: {
            name: r.name,
            first_line: r.first_line,
            second_line: r.second_line,
            city: r.city,
            state: r.state,
            zip: r.zip,
            country_iso: r.country_iso,
          },
          transactions: (r.transactions ?? []).map((t) => ({
            listingId: t.listing_id != null ? String(t.listing_id) : null,
            quantity: Number(t.quantity ?? 1) || 1,
            variations: t.variations ?? [],
          })),
        }));
    },

    /**
     * Resolves a valid LEAF taxonomy_id for a new listing by matching hints
     * (e.g., "mug", "print") against Etsy's live seller taxonomy, with sensible
     * fallbacks. Etsy rejects listing creation without a leaf taxonomy_id.
     */
    async resolveTaxonomyId(hints: string[]): Promise<number> {
      const nodes = await loadSellerTaxonomy(apiKeyHeader, fetchImpl);
      return pickTaxonomyLeaf(nodes, hints);
    },
  };
}

export { listingPriceToCents };
