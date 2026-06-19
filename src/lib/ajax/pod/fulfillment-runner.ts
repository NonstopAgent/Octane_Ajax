/**
 * Server-only: POD fulfillment after Forge — artwork → Printify product draft.
 *
 * Room 2 personalized orders use `@/lib/ajax/pod/order-fulfillment` after
 * personalization uploads artwork to Printify.
 */
export {
  OrderFulfillmentError,
  mapEtsyShippingToPrintify,
  resolveListingPodContext,
  resolveShippingFromOrderMetadata,
  runOrderProductionFulfillment,
} from "@/lib/ajax/pod/order-fulfillment";
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

/**
 * Hard ceiling for a single live Printify API call so a hung request fails
 * cleanly. Printify product creation can legitimately take 30-60s, so this is
 * generous (and overridable via PRINTIFY_TIMEOUT_MS) while still staying well
 * under the /fulfill route's function budget.
 */
const PRINTIFY_TIMEOUT_MS = (() => {
  const raw = Number(process.env.PRINTIFY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 90_000;
})();

/**
 * Rejects with a PodFulfillmentError if `promise` doesn't settle within `ms`.
 * The underlying request is abandoned (not awaited) so the caller can record a
 * `failed` status instead of wedging until the serverless function is killed.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  step: "upload" | "create",
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PodFulfillmentError(`${label} timed out after ${ms}ms.`, step)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
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
  /** Raw artwork bytes (gpt-image-1 base64) for the caller to persist to Storage. */
  artwork?: { base64?: string; mimeType?: string };
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

  const uploadResult = await withTimeout(
    printifyAdapter.uploadArtwork({
      fileName: `${listingTitle.slice(0, 40).replace(/[^\w.-]+/g, "_") || "artwork"}.png`,
      imageUrl: artworkResult.data.imageUrl,
    }),
    PRINTIFY_TIMEOUT_MS,
    "upload",
    "Printify artwork upload",
  );

  const productResult = await withTimeout(
    printifyAdapter.createProduct({
      title: listingTitle,
      description: listingDescription,
      blueprintId: podDetails.blueprintId,
      printProviderId: podDetails.printProviderId,
      variantIds: podDetails.variantIds,
      artworkUploadId: uploadResult.data.uploadId,
    }),
    PRINTIFY_TIMEOUT_MS,
    "create",
    "Printify product creation",
  );

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
    artwork: {
      base64: artworkResult.data.imageBase64,
      mimeType: artworkResult.data.mimeType,
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
