import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type OpenAI from "openai";
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
      niche: "meal prep for night-shift nurses",
      targetBuyer: "Night-shift RNs who batch-cook between shifts",
      problemSolved:
        "Inconsistent weekly grocery planning leads to expensive takeout during 12-hour shifts",
      productConcept: "Night-Shift Weekly Meal Prep Planner (Printable)",
      format: "planner",
      category: "wellness_tracking",
      suggestedPrice: 6.99,
      keywords: [
        "night shift nurse",
        "meal prep planner",
        "printable",
        "weekly menu",
        "grocery list",
      ],
      reasoning:
        "Specific buyer and shift constraint; printable weekly structure reduces decision fatigue.",
    },
    {
      niche: "homeschool attendance compliance",
      targetBuyer: "Homeschool parents tracking state attendance requirements",
      problemSolved:
        "Parents lose track of instructional hours across multiple children",
      productConcept: "Homeschool Attendance & Hour Log (Printable)",
      format: "logbook",
      category: "education",
      suggestedPrice: 5.49,
      keywords: [
        "homeschool attendance",
        "hour log",
        "printable tracker",
        "state compliance",
      ],
      reasoning: "Clear regulatory-adjacent tracking without legal advice.",
    },
    {
      niche: "ADHD executive function mornings",
      targetBuyer: "Adults with ADHD who struggle with morning task sequencing",
      problemSolved: "Morning overwhelm from unstructured transitions between tasks",
      productConcept: "ADHD-Friendly Visual Morning Routine Checklist",
      format: "checklist",
      category: "productivity",
      suggestedPrice: 4.99,
      keywords: [
        "adhd morning routine",
        "visual checklist",
        "executive function",
        "printable",
      ],
      reasoning: "Utility-first checklist with a defined neurodivergent audience.",
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

describe("Nova LLM schema", () => {
  it("parses valid mocked LLM output", () => {
    const parsed = NovaLlmResponseSchema.parse(validLlmPayload);
    assert.equal(parsed.ideas.length, 3);
    const raw = mapLlmIdeaToRaw(parsed.ideas[0]!);
    assert.equal(normalizeProductFormat("planner"), "planner");
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
