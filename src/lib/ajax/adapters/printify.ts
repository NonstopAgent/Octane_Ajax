/**
 * Printify fulfillment adapter — stub only.
 *
 * Server-side only. Requires PRINTIFY_API_TOKEN and PRINTIFY_SHOP_ID
 * when switching from demo to live.
 */

import {
  type AdapterConfig,
  type AdapterResult,
  demoResult,
} from "@/lib/ajax/adapters/types";

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

export const printifyAdapter: PrintifyAdapter = createDemoPrintifyAdapter();
