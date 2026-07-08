import { mapLlmIdeaToRaw, type NovaRawIdea } from "@/lib/ajax/nova/types";

export type FakeIdeaDraft = {
  niche: string;
  title: string;
  description: string;
  seo_keywords: string[];
  trend_score: number;
};

type FallbackIdeaSpec = FakeIdeaDraft & {
  format: string;
  category: string;
  targetBuyer: string;
  problemSolved: string;
  suggestedPrice: number;
};

/**
 * Deterministic fallback specs — PET-PARENT gift products only.
 * GotchaDayGoods is a pet shop: even emergency placeholder ideas must stay
 * on-niche (rescue/adoption, senior pets, gotcha day) so an LLM outage can
 * never flood the store with off-brand products again.
 */
function buildFallbackSpecs(runId: string): FallbackIdeaSpec[] {
  const suffix = runId.slice(0, 8);
  return [
    {
      niche: "senior rescue dog adoption gifts",
      title: `Senior Rescue Dog Mom Coffee Mug Celebrating Gray Muzzle Love — ${suffix}`,
      description:
        "An original illustrated coffee mug for the dog mom who chose the gray-muzzled senior at the shelter. Warm line-art of an old soul dog, a short tribute lockup, and adoption pride on dishwasher-safe drinkware.",
      problemSolved:
        "People who adopt senior dogs rarely find gifts that honor choosing the old dog everyone else overlooked",
      targetBuyer:
        "Senior dog adopters and friends buying an adoption congratulations gift for a rescue dog mom",
      seo_keywords: [
        "senior dog mom mug",
        "rescue dog adoption gift",
        "old dog lover mug",
        "senior dog gift",
        "dog adoption mug",
        "gray muzzle dog",
      ],
      trend_score: 84,
      format: "mug",
      category: "pet_lovers",
      suggestedPrice: 24.99,
    },
    {
      niche: "reactive rescue dog mom apparel",
      title: `Reactive Rescue Dog Mom T-Shirt Celebrating Training Wins — ${suffix}`,
      description:
        "A soft original-design t-shirt for the rescue dog mom whose walks are a daily battle of leash training and small victories. Apparel that says my dog is a work in progress and so am I.",
      problemSolved:
        "Owners of reactive rescue dogs feel judged on walks and struggle to find apparel that celebrates slow training progress",
      targetBuyer:
        "Dog moms of reactive rescue dogs who want apparel celebrating training progress over perfection",
      seo_keywords: [
        "rescue dog mom shirt",
        "reactive dog tshirt",
        "dog mom gift",
        "dog training shirt",
        "rescue dog apparel",
        "adopt dont shop tee",
      ],
      trend_score: 83,
      format: "tshirt",
      category: "pet_lovers",
      suggestedPrice: 29.99,
    },
    {
      niche: "gotcha day celebration keepsakes",
      title: `Personalized Gotcha Day Poster for Rescue Dog Families — ${suffix}`,
      description:
        "A full-bleed illustrated poster that marks the day a rescue dog came home. Celebratory typographic design with room for the pet's name and gotcha date — wall decor for adoption anniversaries.",
      problemSolved:
        "Rescue families want to commemorate their dog's adoption day but generic pet wall art never marks the gotcha day milestone",
      targetBuyer:
        "Rescue dog parents celebrating a gotcha day or buying an adoption anniversary gift for a fellow dog parent",
      seo_keywords: [
        "gotcha day gift",
        "dog adoption poster",
        "rescue dog wall art",
        "adoption anniversary",
        "personalized dog print",
        "gotcha day keepsake",
      ],
      trend_score: 82,
      format: "poster",
      category: "pet_lovers",
      suggestedPrice: 27.99,
    },
  ];
}

/** Deterministic fallback ideas — niche POD gift products for underserved audiences. */
export function buildFakeProductIdeas(runId: string): FakeIdeaDraft[] {
  return buildFallbackSpecs(runId).map((spec) => ({
    niche: spec.niche,
    title: spec.title,
    description: spec.description,
    seo_keywords: spec.seo_keywords,
    trend_score: spec.trend_score,
  }));
}

/** Convert fallback drafts into Nova raw ideas for Product Brain + persistence. */
export function mapFakeDraftsToNovaRaw(runId: string): NovaRawIdea[] {
  return buildFallbackSpecs(runId).map((spec) =>
    mapLlmIdeaToRaw(
      {
        niche: spec.niche,
        targetBuyer: spec.targetBuyer,
        problemSolved: spec.problemSolved,
        productConcept: spec.title,
        format: spec.format,
        category: spec.category,
        suggestedPrice: spec.suggestedPrice,
        keywords: spec.seo_keywords,
        reasoning:
          "Fallback idea from the deterministic pet-niche catalog — used only when every configured LLM provider is unavailable.",
      },
      "fallback",
    ),
  );
}
