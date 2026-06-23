/**
 * Etsy Open API v3 adapter — server-side only.
 *
 * Uses ETSY_CLIENT_ID for x-api-key and per-user OAuth Bearer tokens.
 * Never import from Client Components.
 */

import { listingPriceToCents } from "@/lib/ajax/adapters/gumroad";

const ETSY_API_BASE = "https://api.etsy.com/v3/application";

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

function getClientId(explicit?: string): string {
  const clientId = explicit ?? process.env.ETSY_CLIENT_ID?.trim();
  if (!clientId) {
    throw new EtsyAdapterError("ETSY_CLIENT_ID is not configured.");
  }
  return clientId;
}

function authHeaders(clientId: string, accessToken: string): HeadersInit {
  return {
    "x-api-key": clientId,
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
            ...authHeaders(clientId, input.accessToken),
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
          headers: authHeaders(clientId, accessToken),
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
          headers: authHeaders(clientId, accessToken),
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

    /**
     * Reads the shop's active listings with lifetime views + favorites. Etsy
     * exposes only lifetime counters (no daily series), so the analytics poller
     * snapshots these daily and derives velocity from the deltas.
     */
    async getShopListings(
      shopId: string,
      accessToken: string,
      limit = 100,
    ): Promise<EtsyShopListing[]> {
      const response = await fetchImpl(
        `${ETSY_API_BASE}/shops/${shopId}/listings/active?limit=${limit}`,
        { headers: authHeaders(clientId, accessToken) },
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
     * (unix seconds). Requires the optional `transactions_r` scope; callers should
     * treat 401/403 responses as missing revenue access.
     */
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
        { headers: authHeaders(clientId, accessToken) },
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
  };
}

export { listingPriceToCents };
