import type OpenAI from "openai";
import { z } from "zod";
import {
  buildPixelMarketingUserPrompt,
  PIXEL_MARKETING_JSON_INSTRUCTIONS,
  PIXEL_MARKETING_SYSTEM_PROMPT,
  PIXEL_PROMPT_VERSION,
} from "@/lib/ajax/pixel/prompts";
import {
  buildPixelPromoPackage,
  parseStructure,
  type PixelPromoInput,
  type PixelPromoMetadata,
  type PixelPromoPackage,
} from "@/lib/ajax/pixel-promo-package";
import { completeJson } from "@/lib/llm/json";
import { isOpenAiConfigured } from "@/lib/llm/openai";

export { PIXEL_PROMPT_VERSION };

export const PixelMarketingLlmSchema = z.object({
  shortCaption: z.string().min(1),
  longCaption: z.string().min(1),
  pinterestTitle: z.string().min(1).max(100),
  pinterestDescription: z.string().min(1).max(500),
  tiktokHookIdeas: z.array(z.string().min(1)).length(3),
  hashtags: z.array(z.string().min(1)).min(8).max(12),
});

export type PixelMarketingLlmOutput = z.infer<typeof PixelMarketingLlmSchema>;

export type PixelMarketingOptions = {
  client?: OpenAI;
  forceFallback?: boolean;
};

function normalizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim().replace(/^#+/, "");
    if (!trimmed) continue;
    const normalized = `#${trimmed}`;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(normalized);
    }
    if (out.length >= 12) break;
  }
  return out;
}

function promoContextFromInput(input: PixelPromoInput) {
  const structure = input.structure ?? null;
  const podDetails = input.podDetails ?? null;
  const displayTitle =
    input.listingTitle.trim() ||
    input.ideaTitle?.trim() ||
    "Your new product";
  const niche = input.niche?.trim() || null;
  const format =
    podDetails?.aestheticStyle?.trim() ||
    structure?.format?.trim() ||
    null;
  const pageCount = structure?.pageCount ?? structure?.pages?.length ?? null;
  const pageTitles =
    structure?.pages
      ?.map((p) => p.title?.trim())
      .filter((t): t is string => Boolean(t))
      .slice(0, 6) ?? [];

  return {
    displayTitle,
    niche,
    format,
    pageCount,
    pageTitles,
  };
}

function mapLlmToPromoPackage(
  input: PixelPromoInput,
  llm: PixelMarketingLlmOutput,
): PixelPromoPackage {
  const base = buildPixelPromoPackage(input);
  const { displayTitle, niche, format, pageCount, pageTitles } =
    promoContextFromInput(input);
  const hashtags = normalizeHashtags(llm.hashtags);

  const metadata: PixelPromoMetadata = {
    shortCaption: llm.shortCaption.trim(),
    longCaption: llm.longCaption.trim(),
    pinterestTitle: llm.pinterestTitle.trim(),
    pinterestDescription: llm.pinterestDescription.trim(),
    tiktokHookIdeas: llm.tiktokHookIdeas.map((h) => h.trim()),
    hashtags,
    source: {
      ...base.metadata.source,
      listingTitle: displayTitle,
      listingDescription: input.listingDescription?.trim() || null,
      niche,
      ideaTitle: input.ideaTitle?.trim() || null,
      format,
      pageCount,
      pageTitles,
      seoKeywords: input.seoKeywords ?? [],
    },
  };

  return {
    caption: metadata.shortCaption,
    metadata,
    hashtags,
    assetUrl: base.assetUrl,
    scheduledFor: base.scheduledFor,
  };
}

async function fetchLlmMarketing(
  input: PixelPromoInput,
  options?: PixelMarketingOptions,
): Promise<PixelPromoPackage> {
  const ctx = promoContextFromInput(input);
  const result = await completeJson({
    messages: [
      { role: "system", content: PIXEL_MARKETING_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildPixelMarketingUserPrompt({
          listingTitle: ctx.displayTitle,
          listingDescription: input.listingDescription,
          niche: input.niche,
          ideaTitle: input.ideaTitle,
          ideaDescription: input.ideaDescription,
          seoKeywords: input.seoKeywords,
          format: ctx.format,
          pageCount: ctx.pageCount,
          pageTitles: ctx.pageTitles,
        }),
      },
    ],
    schema: PixelMarketingLlmSchema,
    jsonInstructions: PIXEL_MARKETING_JSON_INSTRUCTIONS,
    options: { temperature: 0.75, maxTokens: 1800 },
    client: options?.client,
  });

  return mapLlmToPromoPackage(input, result.data);
}

/**
 * Pixel marketing: LLM when configured, otherwise deterministic templates.
 */
export async function generatePixelMarketing(
  input: PixelPromoInput,
  options?: PixelMarketingOptions,
): Promise<PixelPromoPackage> {
  const useLlm =
    !options?.forceFallback &&
    (options?.client != null || isOpenAiConfigured());

  if (useLlm) {
    try {
      return await fetchLlmMarketing(input, options);
    } catch {
      // LLM failure → deterministic fallback (demo continuity)
    }
  }

  return buildPixelPromoPackage(input);
}

export { parseStructure };
