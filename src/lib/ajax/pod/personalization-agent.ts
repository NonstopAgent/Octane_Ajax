/**
 * Room 2 — Personalization Agent: customer photo + style → Printify artwork upload.
 */
import {
  imageGeneratorAdapter,
  printifyAdapter,
} from "@/lib/ajax/adapters";
import type { ImageGeneratorAdapter } from "@/lib/ajax/adapters/image-generator";
import type { PrintifyAdapter } from "@/lib/ajax/adapters/printify";
import {
  type OrderQueueRow,
  sanitizeStylePrompt,
} from "@/lib/ajax/pod/order-types";

export class PersonalizationAgentError extends Error {
  readonly code = "PERSONALIZATION_AGENT_ERROR" as const;

  constructor(
    message: string,
    readonly step?: "sanitize" | "portrait" | "upload",
  ) {
    super(message);
    this.name = "PersonalizationAgentError";
  }
}

export type PersonalizationAgentResult = {
  artworkUrl: string;
  printifyUploadId: string;
  sanitizedStylePrompt: string;
  adapterModes: {
    portrait: "demo" | "live";
    printify: "demo" | "live";
  };
};

export type PersonalizationAgentDeps = {
  imageGenerator?: ImageGeneratorAdapter;
  printify?: PrintifyAdapter;
};

export async function runPersonalizationAgent(
  order: Pick<
    OrderQueueRow,
    "id" | "customer_photo_url" | "style_prompt" | "etsy_order_id"
  >,
  deps: PersonalizationAgentDeps = {},
): Promise<PersonalizationAgentResult> {
  const imageGen = deps.imageGenerator ?? imageGeneratorAdapter;
  const printify = deps.printify ?? printifyAdapter;

  const sanitized = sanitizeStylePrompt(order.style_prompt);
  if (!sanitized.ok) {
    throw new PersonalizationAgentError(sanitized.reason, "sanitize");
  }

  const portraitResult = await imageGen.generatePersonalizedPortrait({
    customerPhotoUrl: order.customer_photo_url,
    stylePrompt: sanitized.prompt,
    aestheticStyle: sanitized.preset ?? undefined,
    productTitle: `Etsy order ${order.etsy_order_id}`,
  });

  if (!portraitResult.data.imageUrl) {
    throw new PersonalizationAgentError(
      "Portrait generation returned no image URL.",
      "portrait",
    );
  }

  const fileStem = `order-${order.etsy_order_id.replace(/[^\w.-]+/g, "_")}`;
  const uploadResult = await printify.uploadArtwork({
    fileName: `${fileStem}.png`,
    imageUrl: portraitResult.data.imageUrl,
  });

  return {
    artworkUrl: portraitResult.data.imageUrl,
    printifyUploadId: uploadResult.data.uploadId,
    sanitizedStylePrompt: sanitized.prompt,
    adapterModes: {
      portrait: portraitResult.mode,
      printify: uploadResult.mode,
    },
  };
}
