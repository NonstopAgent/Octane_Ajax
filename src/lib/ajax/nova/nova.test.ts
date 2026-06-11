import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type OpenAI from "openai";
import { buildNovaIdeationUserPrompt } from "@/lib/ajax/nova/prompts";
import {
  buildNovaPastContext,
  dedupePreserveOrder,
  extractNicheFromIdea,
  extractNichesFromListings,
} from "@/lib/ajax/nova/past-context";
import {
  mapNovaIdeasToDbInserts,
  pickForgeIdeaCandidate,
  runNovaIdeation,
} from "@/lib/ajax/nova/service";
import {
  NovaLlmResponseSchema,
  mapLlmIdeaToRaw,
  normalizeProductFormat,
} from "@/lib/ajax/nova/types";
import { buildFakeProductIdeas } from "@/lib/ajax/nova/fallback";

const validLlmPayload = {
  ideas: [
    {
      niche: "night shift nurse humor gifts",
      targetBuyer: "Night shift nurses and coworkers buying unit gift exchange presents",
      problemSolved:
        "Night shift nurses face burnout and chaos yet appreciation gifts always ignore the night crew",
      productConcept: "Night Shift Nurse Coffee Mug Powered by Caffeine and Chaos",
      format: "mug",
      category: "occupation_gifts",
      suggestedPrice: 16.99,
      keywords: [
        "night shift nurse",
        "nurse mug gift",
        "funny nurse mug",
        "nurse week",
        "er nurse gift",
      ],
      reasoning:
        "Specific buyer and occupation identity; giftable mug format with proven Etsy demand.",
    },
    {
      niche: "backyard beekeeper hobby gifts",
      targetBuyer: "Hobby beekeepers and family members shopping for beekeeper birthdays",
      problemSolved:
        "Backyard beekeepers struggle to find original art that celebrates hive life without generic bee clichés",
      productConcept: "Vintage Botanical Beekeeper Art Print for Apiary Enthusiasts",
      format: "art_print",
      category: "hobby_leisure",
      suggestedPrice: 24.99,
      keywords: [
        "beekeeper gift",
        "bee wall art",
        "apiary print",
        "for beekeepers",
      ],
      reasoning: "Clear hobby identity with giftable wall art format.",
    },
    {
      niche: "reactive rescue dog mom apparel",
      targetBuyer: "Dog moms of reactive rescue dogs celebrating training progress",
      problemSolved:
        "Owners of reactive rescue dogs feel judged on walks and struggle to find apparel celebrating training wins",
      productConcept: "Reactive Rescue Dog Mom T-Shirt Celebrating Training Wins",
      format: "tshirt",
      category: "pet_lovers",
      suggestedPrice: 26.99,
      keywords: [
        "rescue dog mom",
        "reactive dog shirt",
        "dog mom gift",
        "dog training tee",
      ],
      reasoning: "Emotionally resonant pet identity with a defined niche audience.",
    },
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
            prompt_tokens: 100,
            completion_tokens: 200,
            total_tokens: 300,
          },
        }),
      },
    },
  } as unknown as OpenAI;
}

describe("buildNovaIdeationUserPrompt", () => {
  it("omits past-cycle block when pastContext is absent", () => {
    const prompt = buildNovaIdeationUserPrompt("run-abc-123");
    assert.doesNotMatch(prompt, /IMPORTANT CONTEXT FROM PAST CYCLES/);
    assert.match(prompt, /cycle run run-abc-/);
  });

  it("appends IMPORTANT CONTEXT when pastContext is provided", () => {
    const prompt = buildNovaIdeationUserPrompt("run-abc-123", {
      rejectedNiches: ["generic daily planner"],
      approvedNiches: ["night-shift nurse meal prep"],
      recentTitles: ["Night-Shift Weekly Meal Prep Planner"],
    });

    assert.match(prompt, /IMPORTANT CONTEXT FROM PAST CYCLES/);
    assert.match(prompt, /REJECTED niches.*generic daily planner/);
    assert.match(prompt, /APPROVED niches.*night-shift nurse meal prep/);
    assert.match(prompt, /Recent product titles.*Night-Shift Weekly Meal Prep Planner/);
    assert.match(prompt, /DIFFERENT from all of the above/);
  });
});

describe("Nova past context extraction", () => {
  it("prefers product_ideas.niche over raw_payload", () => {
    assert.equal(
      extractNicheFromIdea("homeschool attendance", { niche: "payload niche" }),
      "homeschool attendance",
    );
  });

  it("falls back to raw_payload.niche when column is empty", () => {
    assert.equal(
      extractNicheFromIdea(null, { niche: "  ADHD mornings  " }),
      "ADHD mornings",
    );
  });

  it("extracts niches from joined listing rows and dedupes", () => {
    const niches = extractNichesFromListings([
      {
        product_ideas: { niche: "niche A", raw_payload: {} },
      },
      {
        product_ideas: { niche: null, raw_payload: { niche: "niche B" } },
      },
      {
        product_ideas: { niche: "niche A", raw_payload: {} },
      },
    ]);

    assert.deepEqual(niches, ["niche A", "niche B"]);
    assert.deepEqual(dedupePreserveOrder(["Foo", "foo", "Bar"]), ["Foo", "Bar"]);
  });

  it("buildNovaPastContext returns undefined when all inputs are empty", () => {
    assert.equal(buildNovaPastContext([], [], [{ title: null }]), undefined);
  });
});

describe("Nova LLM schema", () => {
  it("parses valid mocked LLM output", () => {
    const parsed = NovaLlmResponseSchema.parse(validLlmPayload);
    assert.equal(parsed.ideas.length, 3);
    const raw = mapLlmIdeaToRaw(parsed.ideas[0]!);
    assert.equal(normalizeProductFormat("mug"), "mug");
    assert.equal(raw.productConcept, validLlmPayload.ideas[0].productConcept);
  });
});

describe("runNovaIdeation", () => {
  it("uses mocked LLM output when a client is injected", async () => {
    const client = createMockOpenAiClient(JSON.stringify(validLlmPayload));
    const result = await runNovaIdeation("test-run-llm-001", { client });

    assert.equal(result.mode, "llm");
    assert.ok(result.ideas.length > 0);
    assert.ok(result.llmModel);
    assert.ok(result.ideas.every((i) => i.verdict !== "blocked"));
  });

  it("filters blocked ideas from LLM output", async () => {
    const blockedPayload = {
      ideas: [
        {
          ...validLlmPayload.ideas[0],
          productConcept: "Disney Princess Daily Planner for Kids",
          keywords: ["disney", "princess", "planner"],
        },
        ...validLlmPayload.ideas.slice(1),
      ],
    };
    const client = createMockOpenAiClient(JSON.stringify(blockedPayload));
    const result = await runNovaIdeation("test-run-blocked", { client });

    assert.ok(
      result.ideas.every((i) => !/disney/i.test(i.productConcept)),
      "blocked Disney idea must not appear in saved ideas",
    );
  });

  it("falls back deterministically when forceFallback is set", async () => {
    const result = await runNovaIdeation("test-run-fallback", {
      forceFallback: true,
    });

    assert.equal(result.mode, "fallback");
    assert.equal(result.ideas.length, 3);
    const fakeTitles = buildFakeProductIdeas("test-run-fallback").map((d) => d.title);
    assert.ok(
      result.ideas.some((i) => fakeTitles.includes(i.productConcept)),
    );
  });

  it("falls back when OPENAI_API_KEY is missing", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const result = await runNovaIdeation("test-run-no-key");
      assert.equal(result.mode, "fallback");
    } finally {
      if (previous !== undefined) {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});

describe("Product Brain persistence mapping", () => {
  it("maps brain_score, brain_validation, brain_verdict, brain_evaluated_at", async () => {
    const result = await runNovaIdeation("test-run-map", { forceFallback: true });
    const rows = mapNovaIdeasToDbInserts("user-1", "test-run-map", result);

    assert.equal(rows.length, result.ideas.length);
    for (const row of rows) {
      assert.ok(row.brain_verdict);
      assert.ok(row.brain_evaluated_at);
      assert.equal(typeof row.brain_score, "object");
      assert.equal(typeof row.brain_validation, "object");
      const score = row.brain_score as { totalScore?: number };
      assert.equal(typeof score.totalScore, "number");
    }
  });
});

describe("Forge idea selection", () => {
  const safeValidation = { riskLevel: "safe" as const, violations: [] };
  const cautionValidation = { riskLevel: "caution" as const, violations: ["vague"] };

  it("prefers approve_for_generation over needs_revision", () => {
    const chosen = pickForgeIdeaCandidate([
      {
        verdict: "needs_revision",
        trendScore: 99,
        validation: safeValidation,
      },
      {
        verdict: "approve_for_generation",
        trendScore: 10,
        validation: safeValidation,
      },
    ]);

    assert.equal(chosen.verdict, "approve_for_generation");
  });

  it("picks highest trend score within the same verdict tier", () => {
    const chosen = pickForgeIdeaCandidate([
      {
        verdict: "needs_revision",
        trendScore: 40,
        validation: safeValidation,
      },
      {
        verdict: "needs_revision",
        trendScore: 75,
        validation: safeValidation,
      },
    ]);

    assert.equal(chosen.trendScore, 75);
  });

  it("allows safe needs_revision only when no approved ideas exist", () => {
    const chosen = pickForgeIdeaCandidate([
      {
        verdict: "needs_revision",
        trendScore: 80,
        validation: safeValidation,
      },
    ]);

    assert.equal(chosen.verdict, "needs_revision");
  });

  it("rejects needs_revision when risk level is not safe", () => {
    assert.throws(
      () =>
        pickForgeIdeaCandidate([
          {
            verdict: "needs_revision",
            trendScore: 99,
            validation: cautionValidation,
          },
        ]),
      /No Forge-eligible ideas/,
    );
  });

  it("never selects blocked ideas", () => {
    assert.throws(
      () =>
        pickForgeIdeaCandidate([
          {
            verdict: "blocked",
            trendScore: 99,
            validation: safeValidation,
          },
        ]),
      /No Forge-eligible ideas/,
    );
  });
});

describe("Nova security boundary", () => {
  it("nova service module is server-only and not re-exported from client paths", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
    const simulator = readFileSync(join(root, "lib/ajax/simulator.ts"), "utf8");

    assert.doesNotMatch(simulator, /from ["']@\/lib\/llm/);
    assert.match(simulator, /from ["']@\/lib\/ajax\/nova/);
  });
});
