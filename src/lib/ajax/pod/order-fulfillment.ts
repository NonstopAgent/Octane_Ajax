/**
 * Room 2 — Printify production fulfillment after personalized artwork upload.
 */
import {
  printifyAdapter,
  type PrintifyAdapter,
  type PrintifyShippingAddress,
} from "@/lib/ajax/adapters/printify";
import {
  type EtsyOrderShippingInfo,
  type OrderQueueRow,
  demoShippingForOrder,
} from "@/lib/ajax/pod/order-types";
import { parsePodDetails } from "@/lib/product/mappers";
import type { PodDetails } from "@/lib/product/domain";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export class OrderFulfillmentError extends Error {
  readonly code = "ORDER_FULFILLMENT_ERROR" as const;

  constructor(
    message: string,
    readonly step?: "listing" | "product" | "order",
  ) {
    super(message);
    this.name = "OrderFulfillmentError";
  }
}

export type ListingPodContext = {
  listingId: string;
  title: string;
  description: string;
  podDetails: PodDetails;
  printifyProductId: string | null;
};

export type OrderProductionResult = {
  printifyProductId: string;
  printifyOrderId: string;
  variantId: number;
  quantity: number;
  adapterModes: {
    printify: "demo" | "live";
  };
};

const DEFAULT_POD_DETAILS: PodDetails = {
  blueprintId: 68,
  printProviderId: 1,
  variantIds: [33719],
  artworkPrompt: "Original personalized portrait artwork for print.",
  aestheticStyle: "minimalist-line-art",
};

export function mapEtsyShippingToPrintify(
  shipping: EtsyOrderShippingInfo,
): PrintifyShippingAddress {
  return {
    firstName: shipping.firstName,
    lastName: shipping.lastName,
    email: shipping.email,
    phone: shipping.phone,
    country: shipping.country,
    region: shipping.region,
    address1: shipping.address1,
    address2: shipping.address2,
    city: shipping.city,
    zip: shipping.zip,
  };
}

export function resolveShippingFromOrderMetadata(
  order: Pick<OrderQueueRow, "etsy_order_id" | "metadata">,
): EtsyOrderShippingInfo {
  const raw = order.metadata.etsyShipping;
  if (raw && typeof raw === "object" && raw !== null) {
    const ship = raw as Record<string, unknown>;
    const address1 = typeof ship.address1 === "string" ? ship.address1.trim() : "";
    const city = typeof ship.city === "string" ? ship.city.trim() : "";
    const zip = typeof ship.zip === "string" ? ship.zip.trim() : "";
    const country = typeof ship.country === "string" ? ship.country.trim() : "";
    if (address1 && city && zip && country) {
      return {
        firstName:
          typeof ship.firstName === "string" ? ship.firstName : "Customer",
        lastName: typeof ship.lastName === "string" ? ship.lastName : "Order",
        email: typeof ship.email === "string" ? ship.email : null,
        phone: typeof ship.phone === "string" ? ship.phone : null,
        country,
        region: typeof ship.region === "string" ? ship.region : null,
        address1,
        address2: typeof ship.address2 === "string" ? ship.address2 : null,
        city,
        zip,
      };
    }
  }

  return demoShippingForOrder(order.etsy_order_id);
}

/**
 * Resolves internal product_listings + podDetails from Etsy listing id.
 */
export async function resolveListingPodContext(
  supabase: Supabase,
  userId: string,
  etsyListingId: string | null,
): Promise<ListingPodContext | null> {
  if (!etsyListingId?.trim()) return null;

  const listingId = etsyListingId.trim();

  const { data: listing, error: listingError } = await supabase
    .from(TABLES.LISTINGS)
    .select("id, title, description, gumroad_product_id, external_listing_id")
    .eq("user_id", userId)
    .or(
      `gumroad_product_id.eq.${listingId},external_listing_id.eq.${listingId}`,
    )
    .maybeSingle();

  if (listingError || !listing) {
    return null;
  }

  const { data: generation, error: generationError } = await supabase
    .from(TABLES.GENERATIONS)
    .select("structure")
    .eq("user_id", userId)
    .eq("product_listing_id", listing.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (generationError) {
    throw new OrderFulfillmentError(
      `Failed to load generation for listing: ${generationError.message}`,
      "listing",
    );
  }

  const podDetails = generation?.structure
    ? parsePodDetails(generation.structure)
    : DEFAULT_POD_DETAILS;

  const fulfillmentMeta =
    podDetails.metadata?.fulfillment &&
    typeof podDetails.metadata.fulfillment === "object"
      ? (podDetails.metadata.fulfillment as Record<string, unknown>)
      : null;

  const printifyProductId =
    typeof fulfillmentMeta?.printifyProductId === "string"
      ? fulfillmentMeta.printifyProductId
      : null;

  return {
    listingId: listing.id,
    title: listing.title?.trim() || `Etsy listing ${listingId}`,
    description:
      listing.description?.trim() ||
      "Personalized print-on-demand order from Octane Ajax.",
    podDetails:
      podDetails.blueprintId > 0 && podDetails.variantIds.length > 0
        ? podDetails
        : DEFAULT_POD_DETAILS,
    printifyProductId,
  };
}

export type OrderProductionInput = {
  order: OrderQueueRow;
  listingContext?: ListingPodContext | null;
  quantity?: number;
};

export type OrderProductionDeps = {
  printify?: PrintifyAdapter;
};

/**
 * Creates a Printify product from uploaded artwork + blueprint, then submits
 * a fulfillment order with Etsy shipping linked via external_id (etsy_order_id).
 */
export async function runOrderProductionFulfillment(
  supabase: Supabase,
  userId: string,
  input: OrderProductionInput,
  deps: OrderProductionDeps = {},
): Promise<OrderProductionResult> {
  const printify = deps.printify ?? printifyAdapter;
  const { order } = input;

  if (!order.printify_upload_id?.trim()) {
    throw new OrderFulfillmentError(
      "Missing Printify upload id — personalization must complete first.",
      "product",
    );
  }

  const listingContext =
    input.listingContext ??
    (await resolveListingPodContext(
      supabase,
      userId,
      typeof order.metadata.etsyListingId === "string"
        ? order.metadata.etsyListingId
        : null,
    ));

  // When listingContext wasn't pre-resolved, use defaults from order metadata
  const podDetails =
    listingContext?.podDetails ??
    (isRecord(order.metadata.podDetails)
      ? parsePodDetails(order.metadata.podDetails)
      : DEFAULT_POD_DETAILS);

  const variantId =
    podDetails.variantIds[0] ??
    DEFAULT_POD_DETAILS.variantIds[0]!;
  const quantity =
    typeof input.quantity === "number" && input.quantity > 0
      ? input.quantity
      : typeof order.metadata.quantity === "number"
        ? order.metadata.quantity
        : 1;

  const title =
    listingContext?.title ?? `Personalized order ${order.etsy_order_id}`;
  const description =
    listingContext?.description ??
    "Personalized print-on-demand portrait fulfillment.";

  let printifyProductId = order.printify_product_id?.trim() || null;

  if (!printifyProductId) {
    const existingCatalogProduct = listingContext?.printifyProductId?.trim();
    if (existingCatalogProduct) {
      printifyProductId = existingCatalogProduct;
    } else {
      const productResult = await printify.createProduct({
        title,
        description,
        blueprintId: podDetails.blueprintId,
        printProviderId: podDetails.printProviderId,
        variantIds: podDetails.variantIds.length
          ? podDetails.variantIds
          : [variantId],
        artworkUploadId: order.printify_upload_id,
      });
      printifyProductId = productResult.data.productId;
    }
  }

  const shipping = mapEtsyShippingToPrintify(
    resolveShippingFromOrderMetadata(order),
  );

  const orderResult = await printify.submitOrder({
    externalId: `etsy-${order.etsy_order_id}`,
    lineItems: [
      {
        productId: printifyProductId,
        variantId,
        quantity,
      },
    ],
    shippingAddress: shipping,
  });

  return {
    printifyProductId,
    printifyOrderId: orderResult.data.orderId,
    variantId,
    quantity,
    adapterModes: {
      printify: orderResult.mode,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
