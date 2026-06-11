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

/** Deterministic fallback specs — niche print-on-demand gift products. */
function buildFallbackSpecs(runId: string): FallbackIdeaSpec[] {
  const suffix = runId.slice(0, 8);
  return [
    {
      niche: "backyard chicken keeper humor gifts",
      title: `Chicken Math Club Member Coffee Mug for Backyard Flock Keepers — ${suffix}`,
      description:
        "An original illustrated coffee mug celebrating chicken math — the inside joke every backyard flock keeper lives by. Hand-drawn hens, coop-to-cup humor, and hobby farm pride on dishwasher-safe drinkware.",
      problemSolved:
        "Backyard flock keepers struggle to find birthday gifts that get the chicken math inside joke instead of generic farm clichés",
      targetBuyer:
        "Backyard chicken keepers and gift-givers shopping for hobby farm friends who joke about chicken math",
      seo_keywords: [
        "chicken math mug",
        "backyard chicken gift",
        "hobby farm mug",
        "chicken keeper gift",
        "funny farmer mug",
        "crazy chicken lady",
      ],
      trend_score: 86,
      format: "mug",
      category: "hobby_leisure",
      suggestedPrice: 16.99,
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
      suggestedPrice: 26.99,
    },
    {
      niche: "night shift nurse appreciation gifts",
      title: `Night Shift Nurse Sweatshirt Powered by Caffeine and Chaos — ${suffix}`,
      description:
        "A cozy crewneck sweatshirt made for nurses surviving the night shift on coffee, dark humor, and teamwork. An original typographic design for nurses week, graduation, and unit gift exchanges.",
      problemSolved:
        "Night shift nurses face burnout and chaos yet most appreciation gifts ignore the night crew entirely",
      targetBuyer:
        "Night shift nurses and coworkers buying unit gifts for nurses week and graduation",
      seo_keywords: [
        "night shift nurse gift",
        "nurse sweatshirt",
        "nurse week gift",
        "funny nurse crewneck",
        "nurse graduation gift",
        "er nurse apparel",
      ],
      trend_score: 81,
      format: "sweatshirt",
      category: "occupation_gifts",
      suggestedPrice: 29.99,
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
          "Fallback idea from deterministic catalog. OpenAI key not configured — set OPENAI_API_KEY to enable live LLM ideation.",
      },
      "fallback",
    ),
  );
}
