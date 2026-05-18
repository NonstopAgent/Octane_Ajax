/**
 * Server-only: DALL-E 3 listing mockup generation and Supabase Storage persistence.
 */
import { createOpenAiClient, isOpenAiConfigured } from "@/lib/llm/openai";
import { mapGenerationToDbUpdate } from "@/lib/product/mappers";
import {
  buildProductMockupStoragePath,
  uploadProductMockup,
} from "@/lib/product/pdf-storage";
import type { ProductStructure } from "@/lib/product/domain";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

export type GenerateListingMockupInput = {
  supabase: Supabase;
  userId: string;
  generationId: string;
  listingTitle: string;
  structure?: ProductStructure;
};

function readCoverImagePrompt(structure?: ProductStructure): string | undefined {
  const meta = structure?.metadata;
  if (!meta || typeof meta !== "object") return undefined;
  const prompt = meta.coverImagePrompt;
  return typeof prompt === "string" && prompt.trim() ? prompt.trim() : undefined;
}

export function buildListingMockupPrompt(
  listingTitle: string,
  coverImagePrompt?: string,
): string {
  const title = listingTitle.trim() || "Digital printable product";
  const artDirection =
    coverImagePrompt?.trim() ||
    `A professional Etsy listing hero image for a utility-first digital printable titled "${title}".`;

  return [
    artDirection,
    "Photorealistic product mockup: styled flat-lay or desk scene showing a printable planner or worksheet.",
    "Warm natural lighting, clean background, no text overlays, no watermarks.",
    "No logos, celebrities, copyrighted brands, or trademarked characters.",
  ].join(" ");
}

async function downloadImageFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download DALL-E image (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

/**
 * Generates a listing mockup via DALL-E 3, uploads to `product_pdfs`, and updates the row.
 * Returns the storage path on success, or `null` on any failure (never throws).
 */
export async function generateListingMockup(
  input: GenerateListingMockupInput,
): Promise<string | null> {
  const { supabase, userId, generationId, listingTitle, structure } = input;

  if (!isOpenAiConfigured()) {
    console.warn("[mockup-generator] OPENAI_API_KEY not configured — skipping mockup.");
    return null;
  }

  try {
    const client = createOpenAiClient({ timeout: 60_000 });
    const prompt = buildListingMockupPrompt(
      listingTitle,
      readCoverImagePrompt(structure),
    );

    const imageResponse = await client.images.generate({
      model: "dall-e-3",
      prompt,
      size: "1024x1024",
      quality: "standard",
      n: 1,
    });

    const imageUrl = imageResponse.data?.[0]?.url;
    if (!imageUrl) {
      console.error("[mockup-generator] DALL-E returned no image URL.");
      return null;
    }

    const imageBytes = await downloadImageFromUrl(imageUrl);
    const storagePath = buildProductMockupStoragePath(userId, generationId);

    await uploadProductMockup(storagePath, imageBytes);

    const { error } = await supabase
      .from(TABLES.GENERATIONS)
      .update(mapGenerationToDbUpdate({ mockupStoragePath: storagePath }))
      .eq("id", generationId)
      .eq("user_id", userId);

    if (error) {
      console.error("[mockup-generator] failed to update generation row", error);
      return null;
    }

    return storagePath;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mockup generation failed.";
    console.error("[mockup-generator]", message, err);
    return null;
  }
}
