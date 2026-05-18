import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type OpenAI from "openai";
import { buildForgeFallbackResult } from "@/lib/ajax/forge/fallback";
import {
  FORGE_LLM_PROVIDER,
  forgeResultToCompliance,
  forgeResultToGenerationLlm,
  guardrailedPrice,
  runForgeGeneration,
} from "@/lib/ajax/forge/service";
import {
  AI_DISCLOSURE_TEXT,
  FORGE_MIN_PAGES,
  FORGE_PROMPT_VERSION,
  ForgeLlmResponseSchema,
  ForgeProductStructureSchema,
  ensureAiDisclosureInCopy,
} from "@/lib/ajax/forge/types";
import { mapGenerationToDbInsert } from "@/lib/product/mappers";
import { runNovaIdeation } from "@/lib/ajax/nova/service";

function sellableForgePages() {
  const worksheet = (
    pageNumber: number,
    title: string,
    extra?: Record<string, unknown>,
  ) => ({
    pageNumber,
    pageKind: "worksheet" as const,
    title,
    purpose: `Worksheet ${pageNumber} purpose`,
    userInstructions: "Print and fill during the week.",
    sections: [
      {
        id: `section_${pageNumber}`,
        heading: title,
        body: "Helper copy for the buyer.",
        fields: [
          { id: `f_${pageNumber}`, label: "Notes", fieldType: "notes" as const },
        ],
        ...extra,
      },
    ],
  });

  return [
    {
      pageNumber: 1,
      pageKind: "cover" as const,
      title: "Night-Shift Nurse Meal Prep Planner",
      purpose: "Cover page",
      userInstructions: "Start here.",
      sections: [
        {
          id: "cover",
          heading: "Cover",
          fields: [{ id: "name", label: "Name", fieldType: "text" as const }],
        },
      ],
    },
    {
      pageNumber: 2,
      pageKind: "instructions" as const,
      title: "How to use",
      purpose: "Instructions",
      userInstructions: "Read before printing worksheets.",
      sections: [
        {
          id: "how",
          heading: "Steps",
          checklist: {
            id: "steps",
            items: ["Print", "Fill", "Review"],
          },
        },
      ],
    },
    worksheet(3, "Weekly overview", {
      table: {
        id: "week",
        headers: ["Day", "Meals", "Prep"],
        rowCount: 7,
      },
    }),
    worksheet(4, "Grocery list A"),
    worksheet(5, "Grocery list B"),
    worksheet(6, "Prep log"),
    {
      pageNumber: 7,
      pageKind: "summary" as const,
      title: "Week in review",
      purpose: "Reflect on the week",
      userInstructions: "Complete on Sunday.",
      sections: [
        {
          id: "summary",
          heading: "Reflection",
          fields: [
            { id: "win", label: "Best win", fieldType: "text" as const },
          ],
        },
      ],
    },
    worksheet(8, "Bonus tracker"),
  ];
}

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
    pages: sellableForgePages(),
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
    assert.ok(parsed.productStructure.pages.length >= FORGE_MIN_PAGES);
    assert.ok(parsed.listingDescription.includes(AI_DISCLOSURE_TEXT));
  });

  it("rejects thin 2-page productStructure", () => {
    assert.throws(() =>
      ForgeProductStructureSchema.parse({
        format: "planner",
        pages: validForgePayload.productStructure.pages.slice(0, 2),
      }),
    );
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
              ...validForgePayload.productStructure.pages[1]!,
              pageNumber: 1,
            },
            ...validForgePayload.productStructure.pages.slice(2),
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

describe("guardrailedPrice", () => {
  it("floors prices below $4.99", () => {
    assert.equal(guardrailedPrice(2.5), 4.99);
  });

  it("caps prices above $19.99 at $14.99", () => {
    assert.equal(guardrailedPrice(24.99), 14.99);
  });

  it("passes through prices in range", () => {
    assert.equal(guardrailedPrice(6.99), 6.99);
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
    assert.ok(result.productStructure.pages.length >= FORGE_MIN_PAGES);
    assert.ok(result.productStructure.pages[0]?.userInstructions);
    assert.equal(result.suggestedPrice, 6.99);
    assert.equal(result.llmProvider, FORGE_LLM_PROVIDER);
    assert.equal(result.llmModel, "gpt-4o-mini");
    assert.equal(result.promptVersion, FORGE_PROMPT_VERSION);
    assert.equal(result.tokenEstimateInput, 500);
    assert.equal(result.tokenEstimateOutput, 900);
  });

  it("guardrails LLM suggested prices above $19.99", async () => {
    const client = createMockOpenAiClient(
      JSON.stringify({ ...validForgePayload, suggestedPrice: 24.99 }),
    );
    const idea = await sampleEvaluatedIdea();
    const result = await runForgeGeneration(
      { runId: "forge-price-cap", idea },
      { client },
    );

    assert.equal(result.mode, "llm");
    assert.equal(result.suggestedPrice, 14.99);
  });

  it("guardrails LLM suggested prices below $4.99", async () => {
    const client = createMockOpenAiClient(
      JSON.stringify({ ...validForgePayload, suggestedPrice: 2.99 }),
    );
    const idea = await sampleEvaluatedIdea();
    const result = await runForgeGeneration(
      { runId: "forge-price-floor", idea },
      { client },
    );

    assert.equal(result.mode, "llm");
    assert.equal(result.suggestedPrice, 4.99);
  });

  it("falls back deterministically when forceFallback is set", async () => {
    const idea = await sampleEvaluatedIdea();
    const result = await runForgeGeneration(
      { runId: "forge-fallback", idea },
      { forceFallback: true },
    );

    assert.equal(result.mode, "fallback");
    assert.equal(result.suggestedPrice, 9.99);
    assert.equal(result.seoTags.length, 13);
    assert.ok(result.productStructure.pages.length >= FORGE_MIN_PAGES);
    assert.equal(result.llmProvider, undefined);
    assert.equal(result.llmModel, undefined);
    assert.equal(result.promptVersion, undefined);
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
      assert.ok(result.productStructure.pages.length >= FORGE_MIN_PAGES);
    } finally {
      if (previous !== undefined) {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});

describe("forgeResultToGenerationLlm", () => {
  it("maps LLM runs to product_generations LLM columns", async () => {
    const client = createMockOpenAiClient(JSON.stringify(validForgePayload));
    const idea = await sampleEvaluatedIdea();
    const result = await runForgeGeneration(
      { runId: "forge-llm-db", idea },
      { client },
    );

    const llm = forgeResultToGenerationLlm(result);
    assert.equal(llm.provider, "openai");
    assert.equal(llm.model, "gpt-4o-mini");
    assert.equal(llm.promptVersion, FORGE_PROMPT_VERSION);

    const insert = mapGenerationToDbInsert({
      productIdeaId: "idea-1",
      productListingId: "listing-1",
      structure: result.productStructure,
      llm,
      generationStatus: "queued",
      pdf: { storagePath: null, publicUrl: null },
      mockupStoragePath: null,
      complianceFlags: [],
      complianceWarnings: [],
    });

    assert.equal(insert.llm_provider, "openai");
    assert.equal(insert.llm_model, "gpt-4o-mini");
    assert.equal(insert.prompt_version, FORGE_PROMPT_VERSION);
    assert.equal(insert.token_estimate_input, 500);
    assert.equal(insert.token_estimate_output, 900);
  });

  it("leaves LLM columns null for fallback runs", async () => {
    const idea = await sampleEvaluatedIdea();
    const result = await runForgeGeneration(
      { runId: "forge-fallback-db", idea },
      { forceFallback: true },
    );

    const llm = forgeResultToGenerationLlm(result);
    assert.equal(llm.provider, null);
    assert.equal(llm.model, null);
    assert.equal(llm.promptVersion, null);

    const insert = mapGenerationToDbInsert({
      productIdeaId: "idea-1",
      productListingId: "listing-1",
      structure: result.productStructure,
      llm,
      generationStatus: "queued",
      pdf: { storagePath: null, publicUrl: null },
      mockupStoragePath: null,
      complianceFlags: [],
      complianceWarnings: [],
    });

    assert.equal(insert.llm_provider, null);
    assert.equal(insert.llm_model, null);
    assert.equal(insert.prompt_version, null);
  });
});

describe("Forge compliance mapping", () => {
  it("does not persist forge review notes as compliance artifacts", async () => {
    const idea = await sampleEvaluatedIdea();
    const result = buildForgeFallbackResult(idea);
    const { flags, warnings } = forgeResultToCompliance(result);

    assert.ok(result.aiDisclosure.includes(AI_DISCLOSURE_TEXT));
    assert.equal(flags.length, 0);
    assert.equal(warnings.length, 0);
    assert.equal(result.complianceNotes.length, 0);
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
