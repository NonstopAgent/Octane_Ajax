/**
 * Product artwork / mockup generation adapter.
 *
 * Server-side only. Uses OpenAI image generation when OPENAI_API_KEY is set;
 * otherwise returns deterministic demo assets.
 */

import OpenAI, { toFile } from "openai";
import {
  type AdapterConfig,
  type AdapterResult,
  demoResult,
  liveResult,
} from "@/lib/ajax/adapters/types";

/**
 * OpenAI's current flagship image model (released 2026-04-21) — sharper
 * detail and far better text rendering than gpt-image-1, which matters for
 * typographic gift designs. Used for OPAQUE full-bleed art (posters).
 * Override via IMAGE_GENERATOR_MODEL if needed.
 */
const DEFAULT_IMAGE_MODEL = "gpt-image-2";

/**
 * gpt-image-2 does NOT support transparent backgrounds (the API rejects
 * background:"transparent" — scene-completion architecture). Isolated
 * apparel/mug designs therefore use gpt-image-1.5, the newest OpenAI image
 * model WITH alpha support. Override via IMAGE_GENERATOR_TRANSPARENT_MODEL.
 */
const DEFAULT_TRANSPARENT_IMAGE_MODEL = "gpt-image-1.5";

/**
 * Hard ceiling for a single OpenAI image call. Kept below the serverless
 * function budget so a slow `gpt-image-1` call fails cleanly (and records a
 * `failed` status) instead of being killed mid-await and orphaning the row.
 */
const IMAGE_GENERATION_TIMEOUT_MS = (() => {
  const raw = Number(process.env.IMAGE_GENERATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 45_000;
})();

export type ProductArtworkInput = {
  productTitle: string;
  niche: string;
  stylePrompt?: string;
  aestheticStyle?: string;
  aspectRatio?: "1:1" | "4:5" | "16:9";
  /**
   * "transparent" → isolated design for compositing onto apparel/mugs (no
   * background fill); "opaque" (default) → full-bleed art (posters).
   */
  background?: "transparent" | "opaque";
};

export type MockupInput = {
  productTitle: string;
  artworkUrl: string;
  mockupTemplate?: "mug" | "poster" | "tshirt" | "phone-case";
};

export type PersonalizedPortraitInput = {
  customerPhotoUrl: string;
  stylePrompt: string;
  aestheticStyle?: string;
  productTitle?: string;
};

export type LifestyleSceneInput = {
  /** The product mockup to place into a scene (raw bytes). */
  productImage: Buffer;
  productTitle: string;
};

export type PortraitExtendInput = {
  /** The square artwork to extend (raw bytes). */
  artImage: Buffer;
  productTitle?: string;
};

export type GeneratedLifestyleScene = {
  sceneId: string;
  imageBase64: string;
  provider: string;
  model: string;
};

export type GeneratedArtwork = {
  assetId: string;
  imageUrl: string;
  /** Raw base64 payload (gpt-image-1 returns b64_json) for Storage persistence. */
  imageBase64?: string;
  mimeType?: string;
  width: number;
  height: number;
  provider: string;
  model: string;
};

export type GeneratedMockup = {
  mockupId: string;
  imageUrl: string;
  template: string;
  provider: string;
};

export type GeneratedPortrait = {
  portraitId: string;
  imageUrl: string;
  provider: string;
  model: string;
};

export interface ImageGeneratorAdapter {
  generateProductArtwork(
    input: ProductArtworkInput,
  ): Promise<AdapterResult<GeneratedArtwork>>;
  generateMockup(input: MockupInput): Promise<AdapterResult<GeneratedMockup>>;
  generatePersonalizedPortrait(
    input: PersonalizedPortraitInput,
  ): Promise<AdapterResult<GeneratedPortrait>>;
  /**
   * Place a product mockup into a warm real-life scene (worn, hung, on a
   * table) — the source frame for listing/social videos, so clips feel like
   * lifestyle footage instead of a camera zooming into a catalog photo.
   */
  generateLifestyleScene(
    input: LifestyleSceneInput,
  ): Promise<AdapterResult<GeneratedLifestyleScene>>;
  /**
   * Extend square artwork to a 2:3 portrait canvas (1024x1536) by continuing
   * its background — poster/print blueprints have 2:3 print areas, and square
   * art on them either floats with empty bands or gets cropped. The original
   * composition must survive untouched.
   */
  extendArtToPortrait(
    input: PortraitExtendInput,
  ): Promise<AdapterResult<GeneratedLifestyleScene>>;
}

/** Scene direction per product type — inferred from the listing title. */
export function lifestyleSceneDirection(productTitle: string): string {
  const t = productTitle.toLowerCase();
  if (t.includes("sweatshirt") || t.includes("hoodie")) {
    return "The sweatshirt is worn by a person with a relaxed pose in a cozy, sunlit living room, a happy dog resting beside them; OR displayed hanging on a rustic wooden door with warm morning light. Show the garment naturally draped on a body or hanger — NOT floating.";
  }
  if (t.includes("t-shirt") || t.includes("tshirt") || t.includes("shirt")) {
    return "The t-shirt is worn by a person outdoors at golden hour with a dog on a leash beside them, candid lifestyle photography feel. Show the garment naturally on a body — NOT floating.";
  }
  if (t.includes("mug")) {
    return "The mug sits on a wooden kitchen table beside a steaming coffee pot, with a cozy sleeping dog visible in the soft-focus background, warm morning window light.";
  }
  if (t.includes("print") || t.includes("poster") || t.includes("art")) {
    return "The art print hangs framed on a warmly lit living room wall above a couch, with a cat curled up on the couch below, cozy home interior photography.";
  }
  return "The product is styled in a warm, cozy home scene with a pet nearby, natural window light, lifestyle photography feel.";
}

export type ImageGeneratorAdapterOptions = AdapterConfig & {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
  fetchImpl?: typeof fetch;
};

function aspectToSize(aspectRatio?: ProductArtworkInput["aspectRatio"]): string {
  // Sizes supported across gpt-image-1/-2: 1024x1024, 1024x1536, 1536x1024.
  switch (aspectRatio) {
    case "4:5":
      return "1024x1536";
    case "16:9":
      return "1536x1024";
    default:
      return "1024x1024";
  }
}

export function isImageGeneratorConfigured(
  options?: ImageGeneratorAdapterOptions,
): boolean {
  const provider =
    process.env.IMAGE_GENERATOR_PROVIDER?.trim().toLowerCase() ?? "openai";
  if (provider === "demo") return false;
  const key = options?.apiKey ?? process.env.OPENAI_API_KEY?.trim();
  return Boolean(key);
}

function getOpenAiClient(options?: ImageGeneratorAdapterOptions): OpenAI {
  if (options?.client) return options.client;
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return new OpenAI({
    apiKey,
    timeout: IMAGE_GENERATION_TIMEOUT_MS,
    maxRetries: 0,
  });
}

function resolveModel(options?: ImageGeneratorAdapterOptions): string {
  return (
    options?.model ??
    process.env.IMAGE_GENERATOR_MODEL?.trim() ??
    DEFAULT_IMAGE_MODEL
  );
}

/** Model for isolated transparent-background art (apparel, mugs). */
function resolveTransparentModel(
  options?: ImageGeneratorAdapterOptions,
): string {
  return (
    options?.model ??
    process.env.IMAGE_GENERATOR_TRANSPARENT_MODEL?.trim() ??
    DEFAULT_TRANSPARENT_IMAGE_MODEL
  );
}

async function fetchImageBuffer(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status}).`);
  }
  const mimeType = response.headers.get("content-type") ?? "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, mimeType };
}

export function createDemoImageGeneratorAdapter(
  _config?: AdapterConfig,
): ImageGeneratorAdapter {
  const provider =
    process.env.IMAGE_GENERATOR_PROVIDER ?? "demo";

  return {
    async generateProductArtwork(input) {
      const assetId = `art-${crypto.randomUUID().slice(0, 8)}`;
      void input;
      return demoResult("Product artwork generated in demo mode (no LLM call).", {
        assetId,
        imageUrl: `demo://octane-ajax/artwork/${assetId}.png`,
        width: 1024,
        height: 1024,
        provider,
        model: DEFAULT_IMAGE_MODEL,
      });
    },

    async generateMockup(input) {
      const mockupId = `mock-${crypto.randomUUID().slice(0, 8)}`;
      const template = input.mockupTemplate ?? "poster";
      void input;
      return demoResult("Product mockup generated in demo mode.", {
        mockupId,
        imageUrl: `demo://octane-ajax/mockups/${mockupId}.png`,
        template,
        provider,
      });
    },

    async generatePersonalizedPortrait(input) {
      const portraitId = `portrait-${crypto.randomUUID().slice(0, 8)}`;
      void input;
      return demoResult("Personalized portrait generated in demo mode.", {
        portraitId,
        imageUrl: `demo://octane-ajax/portraits/${portraitId}.png`,
        provider,
        model: DEFAULT_IMAGE_MODEL,
      });
    },

    async generateLifestyleScene(input) {
      const sceneId = `scene-${crypto.randomUUID().slice(0, 8)}`;
      void input;
      return demoResult("Lifestyle scene generated in demo mode.", {
        sceneId,
        imageBase64: "",
        provider,
        model: DEFAULT_IMAGE_MODEL,
      });
    },

    async extendArtToPortrait(input) {
      void input;
      return demoResult("Portrait extension simulated in demo mode.", {
        sceneId: `extend-${crypto.randomUUID().slice(0, 8)}`,
        imageBase64: "",
        provider,
        model: DEFAULT_IMAGE_MODEL,
      });
    },
  };
}

export function createLiveImageGeneratorAdapter(
  options?: ImageGeneratorAdapterOptions,
): ImageGeneratorAdapter {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const model = resolveModel(options);
  const client = getOpenAiClient(options);

  return {
    async generateProductArtwork(input) {
      const transparent = input.background === "transparent";
      // Per-call model: transparent designs need alpha support, which the
      // flagship model lacks — see DEFAULT_TRANSPARENT_IMAGE_MODEL.
      const artworkModel = transparent
        ? resolveTransparentModel(options)
        : model;
      const prompt = [
        transparent
          ? "FLAT 2D GRAPHIC DESIGN to be printed directly onto a product — render ONLY the isolated design elements."
          : "FLAT 2D GRAPHIC DESIGN for printing onto a product — render ONLY the artwork itself, edge to edge.",
        input.stylePrompt?.trim(),
        input.aestheticStyle ? `Aesthetic: ${input.aestheticStyle}.` : "",
        `Original print-ready artwork for "${input.productTitle}" in the ${input.niche} niche.`,
        "No logos, no copyrighted characters or brands.",
        transparent
          ? "CRITICAL: the design must be ISOLATED on a fully transparent background — no background color, no rectangle or box behind it, no scene, no product mockup (no mug, shirt, frame, wall, or table). Only the design's own shapes and text, with an organic silhouette, as if made for screen printing."
          : "CRITICAL: do NOT render any physical product or mockup — no mug, no t-shirt, no sweatshirt, no poster frame, no tote bag, no phone case, no paper edges, no wall, no table, no room scene, no 3D perspective, no drop shadows of a product. Just the flat design filling the frame.",
      ]
        .filter(Boolean)
        .join(" ");
      const size = aspectToSize(input.aspectRatio);

      const response = await client.images.generate({
        model: artworkModel,
        prompt,
        size: size as "1024x1024" | "1024x1536" | "1536x1024",
        n: 1,
        ...(transparent ? { background: "transparent" as const } : {}),
      });

      const image = response.data?.[0];
      if (!image?.url && !image?.b64_json) {
        throw new Error("OpenAI image generation returned no image.");
      }

      const assetId = `art-${crypto.randomUUID().slice(0, 8)}`;
      const b64 = image.b64_json ?? null;
      const url = image.url ?? (b64 ? `data:image/png;base64,${b64}` : "");

      return liveResult("Product artwork generated.", {
        assetId,
        imageUrl: url,
        imageBase64: b64 ?? undefined,
        mimeType: "image/png",
        width: 1024,
        height: 1024,
        provider: "openai",
        model: artworkModel,
      });
    },

    async generateMockup(input) {
      const template = input.mockupTemplate ?? "poster";
      const mockupId = `mock-${crypto.randomUUID().slice(0, 8)}`;
      return liveResult("Mockup URL passthrough (Printify generates mockups).", {
        mockupId,
        imageUrl: input.artworkUrl,
        template,
        provider: "openai",
      });
    },

    async generatePersonalizedPortrait(input) {
      if (input.customerPhotoUrl.startsWith("demo://")) {
        return createDemoImageGeneratorAdapter().generatePersonalizedPortrait(
          input,
        );
      }

      const { buffer, mimeType } = await fetchImageBuffer(
        input.customerPhotoUrl,
        fetchImpl,
      );
      const extension = mimeType.includes("jpeg") ? "jpg" : "png";
      const imageFile = await toFile(buffer, `customer.${extension}`, {
        type: mimeType,
      });

      const prompt = [
        input.stylePrompt.trim(),
        input.aestheticStyle
          ? `Style: ${input.aestheticStyle}.`
          : "",
        "Transform into a high-quality portrait suitable for print-on-demand.",
        "No copyrighted characters, brands, or logos.",
      ]
        .filter(Boolean)
        .join(" ");

      const response = await client.images.edit({
        model,
        image: imageFile,
        prompt,
        n: 1,
        size: "1024x1024",
      });

      const image = response.data?.[0];
      if (!image?.url && !image?.b64_json) {
        throw new Error("OpenAI portrait edit returned no image.");
      }

      const portraitId = `portrait-${crypto.randomUUID().slice(0, 8)}`;
      const imageUrl =
        image.url ?? `data:image/png;base64,${image.b64_json ?? ""}`;

      return liveResult("Personalized portrait generated.", {
        portraitId,
        imageUrl,
        provider: "openai",
        model,
      });
    },

    async generateLifestyleScene(input) {
      const imageFile = await toFile(input.productImage, "product.png", {
        type: "image/png",
      });

      const prompt = [
        "Professional lifestyle product photograph.",
        lifestyleSceneDirection(input.productTitle),
        "CRITICAL: the product and its printed design must remain EXACTLY as shown in the input image — same artwork, same text, same colors, unaltered and clearly readable.",
        "Photorealistic, warm and inviting, shallow depth of field, no added text or watermarks, no brand logos.",
      ].join(" ");

      const response = await client.images.edit(
        {
          model,
          image: imageFile,
          prompt,
          n: 1,
          size: "1024x1024",
        },
        // gpt-image-1 edits routinely run 50-90s — the 45s client default
        // timed out EVERY scene render on 2026-07-18 and silently downgraded
        // all repair videos to product-style zooms.
        { timeout: 150_000 },
      );

      const image = response.data?.[0];
      if (!image?.b64_json && !image?.url) {
        throw new Error("OpenAI lifestyle scene returned no image.");
      }
      let b64 = image.b64_json ?? "";
      if (!b64 && image.url) {
        const { buffer } = await fetchImageBuffer(image.url, fetchImpl);
        b64 = buffer.toString("base64");
      }

      return liveResult("Lifestyle scene generated.", {
        sceneId: `scene-${crypto.randomUUID().slice(0, 8)}`,
        imageBase64: b64,
        provider: "openai",
        model,
      });
    },

    async extendArtToPortrait(input) {
      const imageFile = await toFile(input.artImage, "art.png", {
        type: "image/png",
      });

      const prompt = [
        "Extend this artwork to fill a taller 2:3 portrait canvas.",
        "CRITICAL: the original artwork — every subject, line, color, and especially any TEXT — must remain EXACTLY as-is, unaltered, centered horizontally.",
        "Continue the existing background style seamlessly above and below the original composition. Do NOT add new subjects, text, borders, or watermarks.",
        input.productTitle ? `This is print art for "${input.productTitle}".` : "",
      ]
        .filter(Boolean)
        .join(" ");

      const response = await client.images.edit(
        {
          model,
          image: imageFile,
          prompt,
          n: 1,
          size: "1024x1536",
        },
        // Portrait canvases render even slower than square edits — same
        // rationale as the lifestyle-scene per-call timeout above.
        { timeout: 150_000 },
      );

      const image = response.data?.[0];
      if (!image?.b64_json && !image?.url) {
        throw new Error("OpenAI portrait extension returned no image.");
      }
      let b64 = image.b64_json ?? "";
      if (!b64 && image.url) {
        const { buffer } = await fetchImageBuffer(image.url, fetchImpl);
        b64 = buffer.toString("base64");
      }

      return liveResult("Artwork extended to 2:3 portrait.", {
        sceneId: `extend-${crypto.randomUUID().slice(0, 8)}`,
        imageBase64: b64,
        provider: "openai",
        model,
      });
    },
  };
}

export function createImageGeneratorAdapter(
  options?: ImageGeneratorAdapterOptions,
): ImageGeneratorAdapter {
  if (isImageGeneratorConfigured(options)) {
    return createLiveImageGeneratorAdapter(options);
  }
  return createDemoImageGeneratorAdapter(options);
}

export const imageGeneratorAdapter: ImageGeneratorAdapter =
  createImageGeneratorAdapter();
