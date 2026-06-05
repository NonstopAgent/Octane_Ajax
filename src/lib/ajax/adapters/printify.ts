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
};

export type PrintifyProduct = {
  productId: string;
  title: string;
  status: "unpublished";
};

export type PrintifyPublishedProduct = {
  productId: string;
  externalId: string;
  status: "published";
  storefrontUrl: string;
};

export interface PrintifyAdapter {
  uploadArtwork(
    input: PrintifyArtworkInput,
  ): Promise<AdapterResult<PrintifyArtwork>>;
  createProduct(
    input: PrintifyProductInput,
  ): Promise<AdapterResult<PrintifyProduct>>;
  publishProduct(
    productId: string,
  ): Promise<AdapterResult<PrintifyPublishedProduct>>;
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

type PrintifyUploadResponse = {
  id?: string;
  preview_url?: string;
  file_name?: string;
};

type PrintifyProductResponse = {
  id?: string;
  title?: string;
};

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

    async publishProduct(productId) {
      return demoResult("Printify product publish simulated.", {
        productId,
        externalId: `ext-${productId}`,
        status: "published",
        storefrontUrl: `https://demo.printify.com/products/${productId}`,
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

      const productPayload = {
        title: input.title,
        description: input.description,
        blueprint_id: blueprintId,
        print_provider_id: printProviderId,
        variants: variantIds.map((id) => ({
          id,
          price: priceCents,
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

    async publishProduct(productId) {
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
