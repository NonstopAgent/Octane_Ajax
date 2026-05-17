/**
 * Product artwork / mockup generation adapter — stub only.
 *
 * Server-side only. Future providers (Gemini, OpenAI, etc.) must be called
 * from the server using IMAGE_GENERATOR_* env vars.
 */

import {
  type AdapterConfig,
  type AdapterResult,
  demoResult,
} from "@/lib/ajax/adapters/types";

export type ProductArtworkInput = {
  productTitle: string;
  niche: string;
  stylePrompt?: string;
  aspectRatio?: "1:1" | "4:5" | "16:9";
};

export type MockupInput = {
  productTitle: string;
  artworkUrl: string;
  mockupTemplate?: "mug" | "poster" | "tshirt" | "phone-case";
};

export type GeneratedArtwork = {
  assetId: string;
  imageUrl: string;
  width: number;
  height: number;
  provider: string;
};

export type GeneratedMockup = {
  mockupId: string;
  imageUrl: string;
  template: string;
  provider: string;
};

export interface ImageGeneratorAdapter {
  generateProductArtwork(
    input: ProductArtworkInput,
  ): Promise<AdapterResult<GeneratedArtwork>>;
  generateMockup(input: MockupInput): Promise<AdapterResult<GeneratedMockup>>;
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
  };
}

export const imageGeneratorAdapter: ImageGeneratorAdapter =
  createDemoImageGeneratorAdapter();
