import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type OpenAI from "openai";
import { buildForgeFallbackResult } from "@/lib/ajax/forge/fallback";
import {
  forgeResultToCompliance,
  runForgeGeneration,
} from "@/lib/ajax/forge/service";
import {
  AI_DISCLOSURE_TEXT,
  ForgeLlmResponseSchema,
  ensureAiDisclosureInCopy,
} from "@/lib/ajax/forge/types";
import { runNovaIdeation } from "@/lib/ajax/nova/service";

const validForgePayload = {
  listingTitle: "Night-Shift Nurse Meal Prep Planner (Printable PDF)",
  listingDescription: `Weekly grocery and meal prep planner for night-shift nurses.\n\n${AI_DISCLOSURE_TEXT}`,
  seoTags: [
    "night shift nurse",
    "meal prep planner",
    "printable pdf",
    "weekly menu",
    "grocery list",
    "instant download",
    "digital planner",
    "hospital worker",
    "batch cooking",
    "meal tracker",
    "shift work",
    "etsy printable",
    "wellness planner",
  ],
  suggestedPrice: 6.99,
  productStructure: {
    format: "planner",
    pages: [
      {
        pageNumber: 1,
        title: "Weekly overview",
        purpose: "Plan groceries and prep blocks for the week",
        userInstructions: "Print and fill at the start of your work week.",
        sections: [
          {
            id: "week_plan",
            heading: "This week",
            body: "List shifts and prep windows.",
            fields: [
              { id: "focus", label: "Focus meals", fieldType: "text" },
            ],
          },
        ],
      },
      {
        pageNumber: 2,
        title: "Grocery list",
        purpose: "Shop once with a structured list",
        userInstructions: "Check items as you shop; duplicate for biweekly runs.",
        sections: [
          {
            id: "groceries",
            heading: "Items",
            fields: [
              { id: "item", label: "Item", fieldType: "text" },
              { id: "got_it", label: "Purchased", fieldType: "checkbox" },
            ],
          },
        ],
      },
    ],
  },
  complianceNotes: ["Verify no medical claims in listing copy."],
  aiDisclosure: AI_DISCLOSURE_TEXT,
  coverImagePrompt:
    "Flat lay meal prep planner cover, soft teal and cream, no logos",
  revisionNotes: ["Confirm price tier against niche comps."],
};

function createMockOpenAiClient(content: string): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => ({
          model: "gpt-4o-mini",
          choices: [{ message: { content } }],
          usage: {
            prompt_tokens: 500,
            completion_tokens: 900,
            total_tokens: 1400,
          },
        }),
      },
    },
  } as unknown as OpenAI;
}

async function sampleEvaluatedIdea() {
  const nova = await runNovaIdeation("forge-test-run", { forceFallback: true });
  assert.ok(nova.ideas[0]);
  return nova.ideas[0]!;
}

describe("Forge LLM schema", () => {
  it("parses valid mocked Forge output with exactly 13 seo tags", () => {
    const parsed = ForgeLlmResponseSchema.parse(validForgePayload);
    assert.equal(parsed.seoTags.length, 13);
    assert.equal(parsed.productStructure.pages.length, 2);
    assert.ok(parsed.listingDescription.includes(AI_DISCLOSURE_TEXT));
  });

  it("rejects malformed productStructure (duplicate page numbers)", () => {
    assert.throws(() =>
      ForgeLlmResponseSchema.parse({
        ...validForgePayload,
        productStructure: {
          format: "planner",
          pages: [
            validForgePayload.productStructure.pages[0],
            {
              ...validForgePayload.productStructure.pages[1],
              pageNumber: 1,
            },
          ],
        },
      }),
    );
  });

  it("rejects wrong seoTags count", () => {
    assert.throws(() =>
      ForgeLlmResponseSchema.parse({
        ...validForgePayload,
        seoTags: validForgePayload.seoTags.slice(0, 5),
      }),
    );
  });
});

describe("runForgeGeneration", () => {
  it("uses mocked LLM output when a client is injected", async () => {
    const client = createMockOpenAiClient(JSON.stringify(validForgePayload));
    const idea = await sampleEvaluatedIdea();
    const result = await runForgeGeneration(
      { runId: "forge-llm-001", idea },
      { client },
    );

    assert.equal(result.mode, "llm");
    assert.equal(result.seoTags.length, 13);
    assert.ok(result.listingDescription.includes(AI_DISCLOSURE_TEXT));
    assert.equal(result.aiDisclosure, AI_DISCLOSURE_TEXT);
    assert.equal(result.productStructure.pages.length, 2);
    assert.ok(result.productStructure.pages[0]?.userInstructions);
  });

  it("falls back deterministically when forceFallback is set", async () => {
    const idea = await sampleEvaluatedIdea();
    const result = await runForgeGeneration(
      { runId: "forge-fallback", idea },
      { forceFallback: true },
    );

    assert.equal(result.mode, "fallback");
    assert.equal(result.suggestedPrice, 24.99);
    assert.equal(result.seoTags.length, 13);
    assert.ok(result.productStructure.pages.length >= 2);
  });

  it("falls back when OPENAI_API_KEY is missing", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const idea = await sampleEvaluatedIdea();
      const result = await runForgeGeneration({
        runId: "forge-no-key",
        idea,
      });
      assert.equal(result.mode, "fallback");
    } finally {
      if (previous !== undefined) {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});

describe("Forge compliance mapping", () => {
  it("maps compliance notes without treating AI disclosure as a warning flag", async () => {
    const idea = await sampleEvaluatedIdea();
    const result = buildForgeFallbackResult(idea);
    const { flags, warnings } = forgeResultToCompliance(result);

    assert.ok(result.aiDisclosure.includes(AI_DISCLOSURE_TEXT));
    assert.equal(
      flags.some((f) => f.code === "ai_disclosure"),
      false,
    );
    assert.ok(warnings.length > 0);
    assert.ok(flags.some((f) => f.code === "review_note"));
  });
});

describe("AI disclosure helper", () => {
  it("appends disclosure when missing from copy", () => {
    const withDisclosure = ensureAiDisclosureInCopy("Short listing body.");
    assert.ok(withDisclosure.includes(AI_DISCLOSURE_TEXT));
  });
});

describe("Forge security boundary", () => {
  it("simulator imports forge, not llm directly", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
    const simulator = readFileSync(join(root, "lib/ajax/simulator.ts"), "utf8");

    assert.match(simulator, /from ["']@\/lib\/ajax\/forge/);
    assert.doesNotMatch(simulator, /from ["']@\/lib\/llm/);
  });
});
