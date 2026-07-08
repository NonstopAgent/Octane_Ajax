/**
 * Printify fulfillment adapter — live HTTP when configured, demo fallback otherwise.
 *
 * Server-side only. Requires PRINTIFY_API_TOKEN and PRINTIFY_SHOP_ID for live mode.
 */

import {
  type AdapterConfig,
  type AdapterResult,
  demoResult,
  liveResult,
} from "@/lib/ajax/adapters/types";

const PRINTIFY_API_BASE = "https://api.printify.com/v1";

export type PrintifyArtworkInput = {
  fileName: string;
  imageUrl: string;
  mimeType?: string;
};

export type PrintifyArtwork = {
  uploadId: string;
  previewUrl: string;
};

export type PrintifyProductInput = {
  title: string;
  description: string;
  blueprintId?: number;
  printProviderId?: number;
  variantIds?: number[];
  artworkUploadId: string;
  /** Retail price in USD cents per variant (defaults to 1999). */
  priceCents?: number;
  /** Etsy SEO tags (synced to the listing on publish). */
  tags?: string[];
  /** Per-variant retail price (USD cents) keyed by variant id. */
  variantPrices?: Record<number, number>;
};

export type PrintifyProduct = {
  productId: string;
  title: string;
  status: "unpublished";
};

/** Mockup image on a Printify product (GET /products/{id}.json → images[]). */
export type PrintifyProductImage = {
  src: string;
  variant_ids?: number[];
  position?: string;
  is_default?: boolean;
  is_selected_for_publishing?: boolean;
};

export type PrintifyPublishedProduct = {
  productId: string;
  externalId: string;
  status: "published";
  storefrontUrl: string;
};

export type PrintifyShippingAddress = {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  country: string;
  region?: string | null;
  address1: string;
  address2?: string | null;
  city: string;
  zip: string;
};

export type PrintifyOrderLineItem = {
  productId: string;
  variantId: number;
  quantity: number;
};

export type PrintifyOrderInput = {
  externalId: string;
  lineItems: PrintifyOrderLineItem[];
  shippingAddress: PrintifyShippingAddress;
  /** Printify shipping_method id (1 = standard). */
  shippingMethod?: number;
  sendShippingNotification?: boolean;
};

export type PrintifyOrder = {
  orderId: string;
  externalId: string;
  status: string;
};

export type PrintifyProductContentUpdate = {
  /** New product title (synced to the sales channel on next publish). */
  title?: string;
  /** Replace every print-area image with this uploaded artwork id
   * (positions/scale preserved; Printify regenerates mockups async). */
  artworkUploadId?: string;
};

export interface PrintifyAdapter {
  uploadArtwork(
    input: PrintifyArtworkInput,
  ): Promise<AdapterResult<PrintifyArtwork>>;
  createProduct(
    input: PrintifyProductInput,
  ): Promise<AdapterResult<PrintifyProduct>>;
  /** Update title and/or swap the print-area artwork on an existing product. */
  updateProductContent(
    productId: string,
    update: PrintifyProductContentUpdate,
  ): Promise<AdapterResult<{ productId: string; updated: string[] }>>;
  publishProduct(
    productId: string,
  ): Promise<AdapterResult<PrintifyPublishedProduct>>;
  /** Remove a product from the connected Etsy shop (reversible — republish restores it). */
  unpublishProduct(
    productId: string,
  ): Promise<AdapterResult<{ productId: string; status: string }>>;
  submitOrder(
    input: PrintifyOrderInput,
  ): Promise<AdapterResult<PrintifyOrder>>;
}

export type PrintifyAdapterOptions = AdapterConfig & {
  apiToken?: string;
  shopId?: string;
  fetchImpl?: typeof fetch;
};

function isDemoImageUrl(url: string): boolean {
  return url.startsWith("demo://");
}

export function isPrintifyConfigured(options?: PrintifyAdapterOptions): boolean {
  const token = options?.apiToken ?? process.env.PRINTIFY_API_TOKEN?.trim();
  const shopId = options?.shopId ?? process.env.PRINTIFY_SHOP_ID?.trim();
  return Boolean(token && shopId);
}

function getCredentials(options?: PrintifyAdapterOptions): {
  token: string;
  shopId: string;
} {
  const token = options?.apiToken ?? process.env.PRINTIFY_API_TOKEN?.trim();
  const shopId = options?.shopId ?? process.env.PRINTIFY_SHOP_ID?.trim();
  if (!token || !shopId) {
    throw new Error("PRINTIFY_API_TOKEN and PRINTIFY_SHOP_ID are required.");
  }
  return { token, shopId };
}

/** Etsy tag rules: max 13 tags, each <= 20 chars, unique, non-empty. */
function sanitizeEtsyTags(tags?: string[]): string[] {
  if (!tags?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = (raw ?? "").trim().slice(0, 20);
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
    if (out.length >= 13) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mockup gallery selection — Etsy listings need 5+ photos to rank; Printify's
// default publish syncs only the single default mockup, which is why every
// autopilot listing went live with ONE photo. Before publishing we select a
// varied set of the auto-generated mockups (front + angles + lifestyle) so the
// Etsy listing gets a full gallery. Best-effort by design: any failure here
// falls through to the normal publish.
// ---------------------------------------------------------------------------

/** Max mockups to sync to the sales channel (Etsy allows 10 photos). */
export const MAX_PUBLISH_MOCKUPS = 8;

/** Preferred camera angles, best first (labels observed on Printify mockups). */
const CAMERA_PRIORITY = [
  "front",
  "context-1",
  "context-2",
  "context-3",
  "left",
  "right",
  "back",
  "flat-lay",
  "hanging",
  "lifestyle",
];

/** Printify encodes the mockup camera angle in the image URL query string. */
export function cameraLabelFromSrc(src: string): string | null {
  const match = /[?&]camera_label=([^&]+)/.exec(src);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

/**
 * Pick up to `max` varied mockups (one per camera angle, best angles first)
 * and return the FULL images array with `is_selected_for_publishing` /
 * `is_default` flags set — ready for a product PUT. Returns null when there
 * is nothing to change (0–1 images, or the selection already matches).
 */
export function selectMockupsForPublishing(
  images: PrintifyProductImage[],
  max: number = MAX_PUBLISH_MOCKUPS,
): PrintifyProductImage[] | null {
  if (!Array.isArray(images) || images.length <= 1) return null;

  type Candidate = {
    image: PrintifyProductImage;
    priority: number;
    index: number;
  };
  const byAngle = new Map<string, Candidate>();
  images.forEach((image, index) => {
    if (!image?.src) return;
    const angle =
      cameraLabelFromSrc(image.src) ??
      image.position?.toLowerCase() ??
      `img-${index}`;
    const priorityIndex = CAMERA_PRIORITY.indexOf(angle);
    const priority =
      priorityIndex === -1 ? CAMERA_PRIORITY.length + index : priorityIndex;
    const existing = byAngle.get(angle);
    // One image per angle; within an angle prefer the current default.
    if (!existing || (image.is_default && !existing.image.is_default)) {
      byAngle.set(angle, { image, priority, index });
    }
  });

  const picks = [...byAngle.values()]
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .slice(0, max);
  if (picks.length <= 1) return null;

  // Index-based selection: srcs are not guaranteed unique across mockups.
  const selectedIndexes = new Set(picks.map((p) => p.index));
  const currentDefaultIndex = images.findIndex(
    (img, i) => img.is_default && selectedIndexes.has(i),
  );
  const defaultIndex =
    currentDefaultIndex !== -1 ? currentDefaultIndex : picks[0]!.index;

  const next = images.map((image, i) => ({
    ...image,
    is_default: i === defaultIndex,
    is_selected_for_publishing: selectedIndexes.has(i),
  }));

  const unchanged = images.every(
    (image, i) =>
      Boolean(image.is_selected_for_publishing) ===
        next[i]!.is_selected_for_publishing &&
      Boolean(image.is_default) === next[i]!.is_default,
  );
  return unchanged ? null : next;
}

type PrintifyUploadResponse = {
  id?: string;
  preview_url?: string;
  file_name?: string;
};

type PrintifyProductResponse = {
  id?: string;
  title?: string;
};

type PrintifyOrderResponse = {
  id?: string;
  external_id?: string;
  status?: string;
};

function mapShippingAddress(
  address: PrintifyShippingAddress,
): Record<string, string> {
  const payload: Record<string, string> = {
    first_name: address.firstName,
    last_name: address.lastName,
    country: address.country,
    address1: address.address1,
    city: address.city,
    zip: address.zip,
  };
  if (address.email) payload.email = address.email;
  if (address.phone) payload.phone = address.phone;
  if (address.region) payload.region = address.region;
  if (address.address2) payload.address2 = address.address2;
  return payload;
}

async function fetchImageAsBase64(
  imageUrl: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch artwork (${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}

export function createDemoPrintifyAdapter(
  _config?: AdapterConfig,
): PrintifyAdapter {
  return {
    async uploadArtwork(input) {
      const uploadId = `pfy-art-${crypto.randomUUID().slice(0, 8)}`;
      return demoResult("Printify artwork upload simulated.", {
        uploadId,
        previewUrl: input.imageUrl || `demo://printify/art/${uploadId}.png`,
      });
    },

    async createProduct(input) {
      const productId = `pfy-prod-${crypto.randomUUID().slice(0, 8)}`;
      return demoResult("Printify product created in demo mode.", {
        productId,
        title: input.title,
        status: "unpublished",
      });
    },

    async updateProductContent(productId, update) {
      const updated = [
        ...(update.title?.trim() ? ["title"] : []),
        ...(update.artworkUploadId?.trim() ? ["artwork"] : []),
      ];
      return demoResult("Printify product update simulated.", {
        productId,
        updated,
      });
    },

    async publishProduct(productId) {
      return demoResult("Printify product publish simulated.", {
        productId,
        externalId: `ext-${productId}`,
        status: "published",
        storefrontUrl: `https://demo.printify.com/products/${productId}`,
      });
    },

    async unpublishProduct(productId) {
      return demoResult("Printify product unpublish simulated.", {
        productId,
        status: "unpublished",
      });
    },

    async submitOrder(input) {
      const orderId = `pfy-ord-${crypto.randomUUID().slice(0, 8)}`;
      return demoResult("Printify fulfillment order simulated.", {
        orderId,
        externalId: input.externalId,
        status: "pending",
      });
    },
  };
}

export function createLivePrintifyAdapter(
  options?: PrintifyAdapterOptions,
): PrintifyAdapter {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const { token, shopId } = getCredentials(options);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  return {
    async uploadArtwork(input) {
      if (isDemoImageUrl(input.imageUrl)) {
        return createDemoPrintifyAdapter().uploadArtwork(input);
      }

      let body: Record<string, string>;
      if (input.imageUrl.startsWith("http")) {
        body = {
          file_name: input.fileName,
          url: input.imageUrl,
        };
      } else {
        const contents = await fetchImageAsBase64(input.imageUrl, fetchImpl);
        body = {
          file_name: input.fileName,
          contents,
        };
      }

      const response = await fetchImpl(`${PRINTIFY_API_BASE}/uploads/images.json`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as PrintifyUploadResponse;
      if (!response.ok || !payload.id) {
        throw new Error(
          `Printify upload failed (${response.status}): ${JSON.stringify(payload)}`,
        );
      }

      return liveResult("Printify artwork uploaded.", {
        uploadId: payload.id,
        previewUrl: payload.preview_url ?? input.imageUrl,
      });
    },

    async createProduct(input) {
      const blueprintId = input.blueprintId ?? 68;
      const printProviderId = input.printProviderId ?? 1;
      const variantIds = input.variantIds?.length ? input.variantIds : [33719];
      const priceCents = input.priceCents ?? 1999;
      const variantPrices = input.variantPrices ?? {};

      const productPayload = {
        title: input.title,
        description: input.description,
        tags: sanitizeEtsyTags(input.tags),
        blueprint_id: blueprintId,
        print_provider_id: printProviderId,
        variants: variantIds.map((id) => ({
          id,
          price: variantPrices[id] ?? priceCents,
          is_enabled: true,
        })),
        print_areas: [
          {
            variant_ids: variantIds,
            placeholders: [
              {
                position: "front",
                images: [
                  {
                    id: input.artworkUploadId,
                    x: 0.5,
                    y: 0.5,
                    scale: 1,
                    angle: 0,
                  },
                ],
              },
            ],
          },
        ],
      };

      const response = await fetchImpl(
        `${PRINTIFY_API_BASE}/shops/${shopId}/products.json`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(productPayload),
        },
      );

      const payload = (await response.json()) as PrintifyProductResponse;
      if (!response.ok || !payload.id) {
        throw new Error(
          `Printify create product failed (${response.status}): ${JSON.stringify(payload)}`,
        );
      }

      return liveResult("Printify product draft created.", {
        productId: payload.id,
        title: payload.title ?? input.title,
        status: "unpublished",
      });
    },

    async updateProductContent(productId, update) {
      const productUrl = `${PRINTIFY_API_BASE}/shops/${shopId}/products/${productId}.json`;
      const updated: string[] = [];
      const body: Record<string, unknown> = {};

      if (update.title?.trim()) {
        body.title = update.title.trim();
        updated.push("title");
      }

      if (update.artworkUploadId?.trim()) {
        const uploadId = update.artworkUploadId.trim();
        const res = await fetchImpl(productUrl, { headers });
        if (!res.ok) {
          throw new Error(
            `Printify product fetch failed (${res.status}) for artwork swap.`,
          );
        }
        type PrintAreaImage = Record<string, unknown> & {
          id?: string;
          x?: number;
          y?: number;
          scale?: number;
          angle?: number;
        };
        type Placeholder = Record<string, unknown> & {
          position?: string;
          images?: PrintAreaImage[];
        };
        type PrintArea = Record<string, unknown> & {
          variant_ids?: number[];
          placeholders?: Placeholder[];
        };
        const product = (await res.json()) as { print_areas?: PrintArea[] };
        const printAreas = Array.isArray(product.print_areas)
          ? product.print_areas
          : [];
        if (printAreas.length === 0) {
          throw new Error("Product has no print areas to update.");
        }
        // Swap the image id, keep placement — and send ONLY the writable
        // print-area shape (variant_ids + placeholders.position/images with
        // id/x/y/scale/angle). GET returns extra read-only fields (src, name,
        // dimensions) that the PUT endpoint rejects.
        body.print_areas = printAreas.map((area) => ({
          variant_ids: area.variant_ids ?? [],
          placeholders: (area.placeholders ?? []).map((ph) => ({
            position: ph.position ?? "front",
            images: (ph.images ?? []).map((img) => ({
              id: uploadId,
              x: typeof img.x === "number" ? img.x : 0.5,
              y: typeof img.y === "number" ? img.y : 0.5,
              scale: typeof img.scale === "number" ? img.scale : 1,
              angle: typeof img.angle === "number" ? img.angle : 0,
            })),
          })),
        }));
        updated.push("artwork");
      }

      if (updated.length === 0) {
        return liveResult("Nothing to update on the Printify product.", {
          productId,
          updated,
        });
      }

      const putRes = await fetchImpl(productUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });
      if (!putRes.ok) {
        const errBody = await putRes.text();
        throw new Error(
          `Printify product update failed (${putRes.status}): ${errBody}`,
        );
      }

      return liveResult("Printify product updated.", { productId, updated });
    },

    async publishProduct(productId) {
      // Best-effort: select a varied mockup gallery (front + angles +
      // lifestyle) so the Etsy listing publishes with 5+ photos instead of 1.
      // Never blocks or fails the publish — worst case Printify's default
      // single mockup syncs exactly as before.
      try {
        const productUrl = `${PRINTIFY_API_BASE}/shops/${shopId}/products/${productId}.json`;
        const productResponse = await fetchImpl(productUrl, { headers });
        if (productResponse.ok) {
          const product = (await productResponse.json()) as {
            images?: PrintifyProductImage[];
          };
          const selection = selectMockupsForPublishing(product.images ?? []);
          if (selection) {
            const putResponse = await fetchImpl(productUrl, {
              method: "PUT",
              headers,
              body: JSON.stringify({ images: selection }),
            });
            if (!putResponse.ok) {
              console.warn(
                `[printify] mockup selection PUT failed (${putResponse.status}) for ${productId} — publishing with default mockups.`,
              );
            }
          }
        }
      } catch (mockupErr) {
        console.warn(
          `[printify] mockup selection skipped for ${productId}:`,
          mockupErr instanceof Error ? mockupErr.message : mockupErr,
        );
      }

      const publishResponse = await fetchImpl(
        `${PRINTIFY_API_BASE}/shops/${shopId}/products/${productId}/publish.json`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: true,
            description: true,
            images: true,
            variants: true,
            tags: true,
          }),
        },
      );

      if (!publishResponse.ok) {
        const errBody = await publishResponse.text();
        throw new Error(
          `Printify publish failed (${publishResponse.status}): ${errBody}`,
        );
      }

      await fetchImpl(
        `${PRINTIFY_API_BASE}/shops/${shopId}/products/${productId}/publishing_succeeded.json`,
        { method: "POST", headers, body: JSON.stringify({}) },
      );

      return liveResult("Printify product published.", {
        productId,
        externalId: productId,
        status: "published",
        storefrontUrl: `https://printify.com/app/products/${productId}`,
      });
    },

    async unpublishProduct(productId) {
      const res = await fetchImpl(
        `${PRINTIFY_API_BASE}/shops/${shopId}/products/${productId}/unpublish.json`,
        { method: "POST", headers, body: JSON.stringify({}) },
      );
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(
          `Printify unpublish failed (${res.status}): ${errBody}`,
        );
      }
      return liveResult("Printify product unpublished.", {
        productId,
        status: "unpublished",
      });
    },

    async submitOrder(input) {
      const orderPayload = {
        external_id: input.externalId,
        line_items: input.lineItems.map((item) => ({
          product_id: item.productId,
          variant_id: item.variantId,
          quantity: item.quantity,
        })),
        shipping_method: input.shippingMethod ?? 1,
        send_shipping_notification: input.sendShippingNotification ?? false,
        address_to: mapShippingAddress(input.shippingAddress),
      };

      const response = await fetchImpl(
        `${PRINTIFY_API_BASE}/shops/${shopId}/orders.json`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(orderPayload),
        },
      );

      const payload = (await response.json()) as PrintifyOrderResponse;
      if (!response.ok || !payload.id) {
        throw new Error(
          `Printify submit order failed (${response.status}): ${JSON.stringify(payload)}`,
        );
      }

      return liveResult("Printify fulfillment order submitted.", {
        orderId: payload.id,
        externalId: payload.external_id ?? input.externalId,
        status: payload.status ?? "pending",
      });
    },
  };
}

export function createPrintifyAdapter(
  options?: PrintifyAdapterOptions,
): PrintifyAdapter {
  if (isPrintifyConfigured(options)) {
    return createLivePrintifyAdapter(options);
  }
  return createDemoPrintifyAdapter(options);
}

export const printifyAdapter: PrintifyAdapter = createPrintifyAdapter();
