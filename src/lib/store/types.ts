import type { ProductIdea, ProductListing } from "@/lib/ajax/types";
import type { ListingStatus } from "@/lib/ajax/status";
import type {
  ProductGeneration,
  ProductIdeaBrainSnapshot,
} from "@/lib/product/domain";

/** Listing visible on the internal storefront (post–Review Gate). */
export const STORE_LISTING_STATUSES = ["approved", "published"] as const;

export type StoreListingStatus = (typeof STORE_LISTING_STATUSES)[number];

export function isStoreListingStatus(
  status: string,
): status is StoreListingStatus {
  return (STORE_LISTING_STATUSES as readonly string[]).includes(status);
}

export type StoreListingDetail = {
  listing: ProductListing;
  idea: ProductIdea | null;
  brain: ProductIdeaBrainSnapshot | null;
  generation: ProductGeneration | null;
  tags: string[];
  displayStatus: ListingStatus;
};
