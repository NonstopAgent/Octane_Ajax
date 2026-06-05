/**
 * Server-only: POD fulfillment after Forge — artwork → Printify product draft.
 */
import {
  imageGeneratorAdapter,
  printifyAdapter,
} from "@/lib/ajax/adapters";
import type { ForgeGenerationResult } from "@/lib/ajax/forge/types";
import type { PodFulfillmentSnapshot } from "@/lib/product/domain";

export class PodFulfillmentError extends Error {
  readonly code = "POD_FULFILLMENT_ERROR" as const;

  constructor(
    message: string,
    readonly step?: "artwork" | "upload" | "create" | "publish",
  ) {
    super(message);
    this.name = "PodFulfillmentError";
  }
}

export type PodFulfillmentInput = {
  forgeResult: Pick<
    ForgeGenerationResult,
    | "listingTitle"
    | "listingDescription"
    | "podDetails"
    | "coverImagePrompt"
  >;
  niche: string;
  publish?: boolean;
};

export type PodFulfillmentResult = {
  ok: true;
  fulfillment: PodFulfillmentSnapshot;
  adapterModes: {
    artwork: "demo" | "live";
    printify: "demo" | "live";
  };
};

export async function runPodFulfillment(
  input: PodFulfillmentInput,
): Promise<PodFulfillmentResult> {
  const { forgeResult, niche, publish = false } = input;
  const { podDetails, listingTitle, listingDescription } = forgeResult;

  const artworkResult = await imageGeneratorAdapter.generateProductArtwork({
    productTitle: listingTitle,
    niche,
    stylePrompt: podDetails.artworkPrompt,
    aestheticStyle: podDetails.aestheticStyle,
    aspectRatio: "1:1",
  });

  if (!artworkResult.data.imageUrl) {
    throw new PodFulfillmentError(
      "Artwork generation returned no image URL.",
      "artwork",
    );
  }

  const uploadResult = await printifyAdapter.uploadArtwork({
    fileName: `${listingTitle.slice(0, 40).replace(/[^\w.-]+/g, "_") || "artwork"}.png`,
    imageUrl: artworkResult.data.imageUrl,
  });

  const productResult = await printifyAdapter.createProduct({
    title: listingTitle,
    description: listingDescription,
    blueprintId: podDetails.blueprintId,
    printProviderId: podDetails.printProviderId,
    variantIds: podDetails.variantIds,
    artworkUploadId: uploadResult.data.uploadId,
  });

  let printifyStatus: PodFulfillmentSnapshot["printifyStatus"] = "draft";
  let storefrontUrl: string | null = null;

  if (publish) {
    const published = await printifyAdapter.publishProduct(
      productResult.data.productId,
    );
    printifyStatus = "published";
    storefrontUrl = published.data.storefrontUrl;
  }

  return {
    ok: true,
    fulfillment: {
      artworkUrl: artworkResult.data.imageUrl,
      printifyUploadId: uploadResult.data.uploadId,
      printifyProductId: productResult.data.productId,
      printifyStatus,
      storefrontUrl,
      adapterMode:
        artworkResult.mode === "live" || uploadResult.mode === "live"
          ? "live"
          : "demo",
    },
    adapterModes: {
      artwork: artworkResult.mode,
      printify: uploadResult.mode,
    },
  };
}

export type PodFulfillmentJobResult =
  | { ok: true; fulfillment: PodFulfillmentSnapshot; alreadyReady?: boolean }
  | { ok: false; error: string; step?: string };
