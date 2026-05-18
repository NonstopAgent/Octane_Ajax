import { mapLlmIdeaToRaw, type NovaRawIdea } from "@/lib/ajax/nova/types";

export type FakeIdeaDraft = {
  niche: string;
  title: string;
  description: string;
  seo_keywords: string[];
  trend_score: number;
};

/** Deterministic demo ideas; scores differ so Forge has a clear winner in fallback mode. */
export function buildFakeProductIdeas(runId: string): FakeIdeaDraft[] {
  const suffix = runId.slice(0, 8);
  return [
    {
      niche: "Cottagecore desk accessories",
      title: `Mushroom Desk Organizer — ${suffix}`,
      description:
        "Ceramic-style organizer with soft earth tones. Targets remote workers who want calm, aesthetic workspaces.",
      seo_keywords: [
        "cottagecore",
        "desk organizer",
        "mushroom decor",
        "WFH aesthetic",
      ],
      trend_score: 72,
    },
    {
      niche: "Pet parent humor",
      title: `Dog CEO Mug — ${suffix}`,
      description:
        "Playful mug positioning the pet as company leadership. Strong gift potential for dog owners.",
      seo_keywords: ["dog mom", "funny mug", "pet gift", "office humor"],
      trend_score: 88,
    },
    {
      niche: "Retro gaming nostalgia",
      title: `Pixel Heart Poster — ${suffix}`,
      description:
        "Minimal 8-bit heart print for game rooms and streaming setups. Pairs with neon LED decor trends.",
      seo_keywords: [
        "retro gaming",
        "pixel art",
        "streamer room",
        "nostalgia decor",
      ],
      trend_score: 65,
    },
  ];
}

/** Convert legacy fake drafts into Nova raw ideas for Product Brain + persistence. */
export function mapFakeDraftsToNovaRaw(runId: string): NovaRawIdea[] {
  return buildFakeProductIdeas(runId).map((draft) =>
    mapLlmIdeaToRaw(
      {
        niche: draft.niche,
        targetBuyer: `Shoppers exploring ${draft.niche} trends on Etsy`,
        problemSolved: draft.description,
        productConcept: draft.title,
        format: "template",
        category: "creator_tools",
        suggestedPrice: 19.99,
        keywords: draft.seo_keywords,
        reasoning:
          "Deterministic fallback idea (demo mode). Preserves the original Ajax simulator catalog.",
      },
      "fallback",
    ),
  );
}
