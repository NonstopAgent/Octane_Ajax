/**
 * Etsy marketplace adapter — stub only.
 *
 * Server-side only. Wire `createEtsyAdapter()` from API routes after
 * ETSY_* env vars are set. Do not call from the browser.
 */

import {
  type AdapterConfig,
  type AdapterResult,
  demoResult,
} from "@/lib/ajax/adapters/types";

export type EtsyListingInput = {
  title: string;
  description: string;
  price: number;
  tags?: string[];
  quantity?: number;
  taxonomyId?: number;
};

export type EtsyListingUpdateInput = Partial<EtsyListingInput>;

export type EtsyDraftListing = {
  listingId: string;
  shopId: string;
  status: "draft";
  url: string;
};

export type EtsyPublishedListing = {
  listingId: string;
  shopId: string;
  status: "active";
  url: string;
};

export interface EtsyAdapter {
  createDraftListing(
    input: EtsyListingInput,
  ): Promise<AdapterResult<EtsyDraftListing>>;
  publishListing(
    listingId: string,
  ): Promise<AdapterResult<EtsyPublishedListing>>;
  updateListing(
    listingId: string,
    input: EtsyListingUpdateInput,
  ): Promise<AdapterResult<EtsyPublishedListing>>;
}

function mockListingId() {
  return `etsy-demo-${crypto.randomUUID().slice(0, 8)}`;
}

export function createDemoEtsyAdapter(
  _config?: AdapterConfig,
): EtsyAdapter {
  const shopId = process.env.ETSY_SHOP_ID ?? "demo-shop";

  return {
    async createDraftListing(input) {
      const listingId = mockListingId();
      return demoResult("Etsy draft listing created (not sent to Etsy).", {
        listingId,
        shopId,
        status: "draft",
        url: `https://demo.etsy.com/listing/${listingId}`,
      });
    },

    async publishListing(listingId) {
      return demoResult("Etsy listing publish simulated.", {
        listingId,
        shopId,
        status: "active",
        url: `https://demo.etsy.com/listing/${listingId}`,
      });
    },

    async updateListing(listingId, input) {
      void input;
      return demoResult("Etsy listing update simulated.", {
        listingId,
        shopId,
        status: "active",
        url: `https://demo.etsy.com/listing/${listingId}`,
      });
    },
  };
}

/** Default demo adapter — import only from server code. */
export const etsyAdapter: EtsyAdapter = createDemoEtsyAdapter();
