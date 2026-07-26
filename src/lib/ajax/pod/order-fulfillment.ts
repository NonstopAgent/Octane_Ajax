/**
 * Room 2 — Printify production fulfillment after personalized artwork upload.
 */
import {
  printifyAdapter,
  type PrintifyAdapter,
  type PrintifyShippingAddress,
} from "@/lib/ajax/adapters/printify";
import {
  type BuyerVariation,
  type EtsyOrderShippingInfo,
  type OrderQueueRow,
  MAX_ORDER_QUANTITY,
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
  /** How the variant was chosen: the buyer's Size/Color match, or default #1. */
  variantMatch: "buyer" | "default";
  /** Set when the buyer chose options but no catalog variant matched them. */
  variantWarning: string | null;
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
  opts: { allowDemoFallback?: boolean } = {},
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

  // NEVER at production-submit time (2026-07-25 audit, C3): the insert path
  // parks address-less orders, but a row whose stored shipping is missing or
  // partial could still reach THIS second fallback and bill a real Printify
  // production shipped to "123 Demo Street". Outside production the demo
  // address remains available for local runs and tests.
  const allowDemo =
    opts.allowDemoFallback ?? process.env.NODE_ENV !== "production";
  if (!allowDemo) {
    throw new OrderFulfillmentError(
      `Order ${order.etsy_order_id} has no complete shipping address on file — refusing to submit production to a placeholder address. Fix the address in order metadata and retry.`,
      "order",
    );
  }

  return demoShippingForOrder(order.etsy_order_id);
}

/**
 * Maps the buyer's Size/Color choices onto one of the listing's enabled
 * Printify variants (2026-07-25 audit, H6). Before this, EVERY order shipped
 * `variantIds[0]` — a buyer who paid the 2XL upcharge got Size S.
 *
 * Matching is segment-exact against catalog titles ("Aqua / 2XL"), so "XL"
 * can never match "2XL". Returns matched=false when the buyer chose nothing
 * or nothing lines up — the caller decides how loudly to fall back.
 */
export function pickVariantForBuyer(
  enabledVariantIds: number[],
  catalogVariants: { id: number; title: string }[],
  buyerVariations: BuyerVariation[],
): { variantId: number | null; matched: boolean } {
  const fallback = enabledVariantIds[0] ?? null;
  if (enabledVariantIds.length <= 1 || buyerVariations.length === 0) {
    return { variantId: fallback, matched: false };
  }

  // "12x18", "12 x 18", and `12" x 18"` must all agree, while "XL" must never
  // token-match "2XL" — so: strip punctuation, split digit-x-digit dimension
  // forms into tokens, and require every token of the buyer's value to appear
  // in one title segment.
  const normalize = (s: string): string[] =>
    s
      .toLowerCase()
      .replace(/(\d)\s*[x×]\s*(\d)/g, "$1 x $2")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);

  const values = buyerVariations
    .map((v) => normalize(v.value))
    .filter((tokens) => tokens.length > 0);
  if (values.length === 0) return { variantId: fallback, matched: false };

  const titleById = new Map(catalogVariants.map((v) => [v.id, v.title]));

  let best: { id: number; score: number } | null = null;
  for (const id of enabledVariantIds) {
    const title = titleById.get(id);
    if (!title) continue;
    const segments = title
      .split("/")
      .map((seg) => new Set(normalize(seg)))
      .filter((seg) => seg.size > 0);
    const score = values.filter((tokens) =>
      segments.some((seg) => tokens.every((t) => seg.has(t))),
    ).length;
    if (score > 0 && (best === null || score > best.score)) {
      best = { id, score };
    }
  }

  return best
    ? { variantId: best.id, matched: true }
    : { variantId: fallback, matched: false };
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

  const enabledVariantIds = podDetails.variantIds.length
    ? podDetails.variantIds
    : DEFAULT_POD_DETAILS.variantIds;

  // Honor the buyer's Size/Color choice (2026-07-25 audit, H6). The old
  // `variantIds[0]` shipped variant #1 to every buyer — wrong garment for
  // anyone who picked (and often paid extra for) another size.
  let variantId = enabledVariantIds[0] ?? DEFAULT_POD_DETAILS.variantIds[0]!;
  let variantMatch: "buyer" | "default" = "default";
  let variantWarning: string | null = null;

  const buyerVariations: BuyerVariation[] = Array.isArray(
    order.metadata.buyerVariations,
  )
    ? (order.metadata.buyerVariations as unknown[])
        .filter(
          (v): v is BuyerVariation =>
            isRecord(v) &&
            typeof v.name === "string" &&
            typeof v.value === "string",
        )
        .slice(0, 5)
    : [];

  if (buyerVariations.length > 0 && enabledVariantIds.length > 1) {
    try {
      const catalog = await printify.listCatalogVariants(
        podDetails.blueprintId,
        podDetails.printProviderId,
      );
      const picked = pickVariantForBuyer(
        enabledVariantIds,
        catalog.data,
        buyerVariations,
      );
      if (picked.matched && picked.variantId != null) {
        variantId = picked.variantId;
        variantMatch = "buyer";
      } else {
        variantWarning = `Buyer chose ${buyerVariations
          .map((v) => `${v.name}: ${v.value}`)
          .join(", ")} but no catalog variant matched — submitted default variant ${variantId}. Verify before it ships.`;
      }
    } catch (err) {
      variantWarning = `Variant lookup failed (${err instanceof Error ? err.message : "unknown"}) — submitted default variant ${variantId}. Verify before it ships.`;
    }
  }

  const rawQuantity =
    typeof input.quantity === "number" && input.quantity > 0
      ? input.quantity
      : typeof order.metadata.quantity === "number"
        ? order.metadata.quantity
        : 1;
  // Defense in depth on billable quantity (C2): intake clamps too, but this
  // is the last line before money moves.
  const quantity = Math.min(Math.max(1, Math.round(rawQuantity)), MAX_ORDER_QUANTITY);

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

  // Per-line-item external id (H5): with one order row per transaction, two
  // items on the same receipt must not collide on Printify's external_id.
  const externalId = order.transaction_id
    ? `etsy-${order.etsy_order_id}-${order.transaction_id}`
    : `etsy-${order.etsy_order_id}`;

  const orderResult = await printify.submitOrder({
    externalId,
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
    variantMatch,
    variantWarning,
    quantity,
    adapterModes: {
      printify: orderResult.mode,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
