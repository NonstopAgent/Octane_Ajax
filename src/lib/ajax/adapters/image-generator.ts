/**
 * Product artwork / mockup generation adapter.
 *
 * Server-side only. Uses OpenAI gpt-image-1 when OPENAI_API_KEY is set;
 * otherwise returns deterministic demo assets.
 */

import OpenAI, { toFile } from "openai";
import {
  type AdapterConfig,
  type AdapterResult,
  demoResult,
  liveResult,
} from "@/lib/ajax/adapters/types";

const DEFAULT_IMAGE_MODEL = "gpt-image-1";

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
}

export type ImageGeneratorAdapterOptions = AdapterConfig & {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
  fetchImpl?: typeof fetch;
};

function aspectToSize(aspectRatio?: ProductArtworkInput["aspectRatio"]): string {
  // gpt-image-1 only supports 1024x1024, 1024x1536, 1536x1024.
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
      const prompt = [
        "FLAT 2D GRAPHIC DESIGN for printing onto a product — render ONLY the artwork itself, edge to edge.",
        input.stylePrompt?.trim(),
        input.aestheticStyle ? `Aesthetic: ${input.aestheticStyle}.` : "",
        `Original print-ready artwork for "${input.productTitle}" in the ${input.niche} niche.`,
        "No logos, no copyrighted characters or brands.",
        "CRITICAL: do NOT render any physical product or mockup — no mug, no t-shirt, no sweatshirt, no poster frame, no tote bag, no phone case, no paper edges, no wall, no table, no room scene, no 3D perspective, no drop shadows of a product. Just the flat design on a plain solid background.",
      ]
        .filter(Boolean)
        .join(" ");
      const size = aspectToSize(input.aspectRatio);

      const response = await client.images.generate({
        model,
        prompt,
        size: size as "1024x1024" | "1024x1536" | "1536x1024",
        n: 1,
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
        model,
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
