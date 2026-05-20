import { mapLlmIdeaToRaw, type NovaRawIdea } from "@/lib/ajax/nova/types";

export type FakeIdeaDraft = {
  niche: string;
  title: string;
  description: string;
  seo_keywords: string[];
  trend_score: number;
};

/** Deterministic fallback ideas — real printable digital downloads for underserved niches. */
export function buildFakeProductIdeas(runId: string): FakeIdeaDraft[] {
  const suffix = runId.slice(0, 8);
  return [
    {
      niche: "ADHD adult productivity",
      title: `ADHD Daily Routine Planner for Adults — ${suffix}`,
      description:
        "A structured printable planner for adults with ADHD who struggle to maintain morning and evening routines. Includes time-blocking, priority ranking, brain-dump section, and habit check-ins. Solves the chaos of unstructured days.",
      seo_keywords: [
        "adhd planner",
        "adhd daily routine",
        "executive function",
        "printable planner adhd",
        "adult adhd tools",
        "routine tracker",
      ],
      trend_score: 88,
    },
    {
      niche: "Small business owner finances",
      title: `Small Business Weekly Income Tracker — ${suffix}`,
      description:
        "A printable weekly tracker for small business owners and Etsy sellers who need a simple way to log sales, expenses, and profit without complex software. Designed for non-accountants who run solo shops.",
      seo_keywords: [
        "small business tracker",
        "etsy seller income log",
        "business expense tracker",
        "printable income worksheet",
        "solo business planner",
        "weekly profit tracker",
      ],
      trend_score: 82,
    },
    {
      niche: "Homeschool parent planning",
      title: `Homeschool Year Planner Bundle — ${suffix}`,
      description:
        "A complete printable planning bundle for homeschool parents covering curriculum scheduling, daily lesson blocks, attendance records, and subject progress tracking. Built for the overwhelmed parent managing multiple grade levels.",
      seo_keywords: [
        "homeschool planner",
        "homeschool curriculum tracker",
        "lesson plan template",
        "homeschool attendance",
        "printable homeschool bundle",
        "homeschool schedule",
      ],
      trend_score: 76,
    },
  ];
}

type FallbackIdeaSpec = FakeIdeaDraft & {
  format: string;
  category: string;
  targetBuyer: string;
  suggestedPrice: number;
};

const FALLBACK_SPECS: Omit<FallbackIdeaSpec, "title">[] = [
  {
    niche: "ADHD adult productivity",
    description:
      "A structured printable planner for adults with ADHD who struggle to maintain morning and evening routines. Includes time-blocking, priority ranking, brain-dump section, and habit check-ins.",
    seo_keywords: ["adhd planner", "adhd daily routine", "executive function", "printable planner adhd", "adult adhd tools", "routine tracker"],
    trend_score: 88,
    format: "planner",
    category: "wellness_tracking",
    targetBuyer: "Adults with ADHD looking for structured daily routine support",
    suggestedPrice: 5.99,
  },
  {
    niche: "Small business owner finances",
    description:
      "A printable weekly tracker for small business owners and Etsy sellers who need a simple way to log sales, expenses, and profit without complex software.",
    seo_keywords: ["small business tracker", "etsy seller income log", "business expense tracker", "printable income worksheet", "solo business planner", "weekly profit tracker"],
    trend_score: 82,
    format: "tracker",
    category: "small_business",
    targetBuyer: "Solo Etsy sellers and small business owners managing finances manually",
    suggestedPrice: 4.99,
  },
  {
    niche: "Homeschool parent planning",
    description:
      "A complete printable planning bundle for homeschool parents covering curriculum scheduling, daily lesson blocks, attendance records, and subject progress tracking.",
    seo_keywords: ["homeschool planner", "homeschool curriculum tracker", "lesson plan template", "homeschool attendance", "printable homeschool bundle", "homeschool schedule"],
    trend_score: 76,
    format: "bundle",
    category: "parenting_support",
    targetBuyer: "Homeschool parents managing multiple children across grade levels",
    suggestedPrice: 8.99,
  },
];

/** Convert fallback drafts into Nova raw ideas for Product Brain + persistence. */
export function mapFakeDraftsToNovaRaw(runId: string): NovaRawIdea[] {
  const suffix = runId.slice(0, 8);
  return FALLBACK_SPECS.map((spec, i) =>
    mapLlmIdeaToRaw(
      {
        niche: spec.niche,
        targetBuyer: spec.targetBuyer,
        problemSolved: spec.description,
        productConcept: `${spec.niche.split(" ").map(w => w[0]!.toUpperCase() + w.slice(1)).join(" ")} — ${suffix}-${i + 1}`,
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
