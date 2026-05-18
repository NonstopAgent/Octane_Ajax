import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type OpenAI from "openai";
import { generatePixelMarketing, PixelMarketingLlmSchema } from "@/lib/ajax/pixel/service";
import { buildPixelPromoPackage } from "@/lib/ajax/pixel-promo-package";

const validLlmPayload = {
  shortCaption: "✨ Night-shift meal prep made easy — printable planner for busy RNs.",
  longCaption:
    "Stop winging grocery runs between 12-hour shifts. This printable weekly planner helps night-shift nurses batch meals with less stress.",
  pinterestTitle: "Night-Shift Nurse Meal Prep Planner | Printable Weekly Menu",
  pinterestDescription:
    "Printable weekly meal prep planner for night-shift nurses. Grocery lists, batch-cook grids, and shift-friendly recipes structure. Instant digital download.",
  tiktokHookIdeas: [
    "POV: you finally meal-prepped before a 12-hour night shift",
    "Stop scrolling if you work nights and hate takeout guilt",
    "I printed this planner in 2 minutes — here's what's inside",
  ],
  hashtags: [
    "nightshiftnurse",
    "mealprep",
    "printableplanner",
    "digitaldownload",
    "etsyshop",
    "nurseplanner",
    "weeklymenu",
    "batchcooking",
  ],
};

function createMockOpenAiClient(content: string): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => ({
          model: "gpt-4o-mini",
          choices: [{ message: { content } }],
          usage: {
            prompt_tokens: 80,
            completion_tokens: 120,
            total_tokens: 200,
          },
        }),
      },
    },
  } as unknown as OpenAI;
}

describe("PixelMarketingLlmSchema", () => {
  it("parses valid mocked LLM output", () => {
    const parsed = PixelMarketingLlmSchema.parse(validLlmPayload);
    assert.equal(parsed.tiktokHookIdeas.length, 3);
    assert.ok(parsed.hashtags.length >= 8);
  });
});

describe("generatePixelMarketing", () => {
  const input = {
    jobId: "job-pixel-llm",
    listingTitle: "Night-Shift Nurse Meal Prep Planner",
    listingDescription: "Weekly printable meal prep for 12-hour shifts.",
    niche: "night shift nurses",
    seoKeywords: ["meal prep", "nurse planner"],
  };

  it("uses mocked LLM output when a client is injected", async () => {
    const client = createMockOpenAiClient(JSON.stringify(validLlmPayload));
    const promo = await generatePixelMarketing(input, { client });

    assert.match(promo.caption, /Night-shift meal prep/i);
    assert.equal(promo.metadata.tiktokHookIdeas.length, 3);
    assert.ok(promo.metadata.hashtags.every((t) => t.startsWith("#")));
    assert.match(promo.assetUrl, /job-pixel-llm/);
  });

  it("falls back to deterministic package when forceFallback is set", async () => {
    const promo = await generatePixelMarketing(input, { forceFallback: true });
    const fallback = buildPixelPromoPackage(input);

    assert.equal(promo.caption, fallback.caption);
    assert.deepEqual(promo.metadata.hashtags, fallback.metadata.hashtags);
  });

  it("falls back when LLM returns invalid JSON", async () => {
    const client = createMockOpenAiClient("not json");
    const promo = await generatePixelMarketing(input, { client });
    const fallback = buildPixelPromoPackage(input);

    assert.equal(promo.caption, fallback.caption);
  });
});
