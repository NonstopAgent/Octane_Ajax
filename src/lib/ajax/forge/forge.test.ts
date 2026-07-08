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
  FORGE_PROMPT_VERSION,
  ForgeLlmResponseSchema,
  ForgePodDetailsSchema,
  ensureAiDisclosureInCopy,
  reconcileListingCopyWithProduct,
} from "@/lib/ajax/forge/types";
import { PRINTIFY_CATALOG } from "@/lib/ajax/pod/printify-catalog";
import { mapGenerationToDbInsert } from "@/lib/product/mappers";
import { runNovaIdeation } from "@/lib/ajax/nova/service";

const validForgePayload = {
  listingTitle: "Night-Shift Nurse Gift Mug — Meal Prep Theme",
  listingDescription: `A thoughtful gift mug for night-shift nurses who meal prep.\n\n${AI_DISCLOSURE_TEXT}`,
  seoTags: [
    "night shift nurse",
    "meal prep gift",
    "nurse mug",
    "print on demand",
    "gift idea",
    "custom mug",
    "hospital worker",
    "shift work",
    "etsy gift",
    "made to order",
    "unique design",
    "nurse appreciation",
    "wellness gift",
  ],
  suggestedPrice: 19.99,
  podDetails: {
    catalogKey: "MUG_11OZ" as const,
    artworkPrompt:
      "Minimalist line art mug design with meal prep icons, soft teal palette, no logos or characters, print-ready centered composition for night-shift nurses",
    aestheticStyle: "minimalist-line-art" as const,
  },
  complianceNotes: ["Verify no medical claims in listing copy."],
  aiDisclosure: AI_DISCLOSURE_TEXT,
  coverImagePrompt:
    "White mug mockup with minimalist meal prep artwork, soft teal and cream, no logos",
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
    assert.ok(parsed.podDetails.artworkPrompt.length >= 20);
    assert.ok(parsed.listingDescription.includes(AI_DISCLOSURE_TEXT));
  });

  it("rejects invalid podDetails (short artwork prompt)", () => {
    assert.throws(() =>
      ForgePodDetailsSchema.parse({
        ...validForgePayload.podDetails,
        artworkPrompt: "too short",
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
  it("floors prices below $9.99", () => {
    assert.equal(guardrailedPrice(2.5), 9.99);
  });

  it("caps prices above $149.99 at $49.99", () => {
    assert.equal(guardrailedPrice(199.99), 49.99);
  });

  it("passes through prices in range", () => {
    assert.equal(guardrailedPrice(19.99), 19.99);
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
    assert.equal(
      result.podDetails.blueprintId,
      PRINTIFY_CATALOG.MUG_11OZ.blueprintId,
    );
    assert.ok(result.podDetails.artworkPrompt.length >= 20);
    assert.equal(result.suggestedPrice, 19.99);
    assert.equal(result.llmProvider, FORGE_LLM_PROVIDER);
    assert.equal(result.llmModel, "gpt-4o-mini");
    assert.equal(result.promptVersion, FORGE_PROMPT_VERSION);
    assert.equal(result.tokenEstimateInput, 500);
    assert.equal(result.tokenEstimateOutput, 900);
  });

  it("falls back when LLM suggested price violates the schema cap", async () => {
    // ForgeLlmResponseSchema rejects prices above $149.99, so an
    // out-of-range LLM price triggers the deterministic fallback.
    const client = createMockOpenAiClient(
      JSON.stringify({ ...validForgePayload, suggestedPrice: 199.99 }),
    );
    const idea = await sampleEvaluatedIdea();
    const result = await runForgeGeneration(
      { runId: "forge-price-cap", idea },
      { client },
    );

    assert.equal(result.mode, "fallback");
    assert.ok(result.suggestedPrice <= 49.99);
  });

  it("guardrails LLM suggested prices below $9.99", async () => {
    const client = createMockOpenAiClient(
      JSON.stringify({ ...validForgePayload, suggestedPrice: 2.99 }),
    );
    const idea = await sampleEvaluatedIdea();
    const result = await runForgeGeneration(
      { runId: "forge-price-floor", idea },
      { client },
    );

    assert.equal(result.mode, "llm");
    assert.equal(result.suggestedPrice, 9.99);
  });

  it("falls back deterministically when forceFallback is set", async () => {
    const idea = await sampleEvaluatedIdea();
    const result = await runForgeGeneration(
      { runId: "forge-fallback", idea },
      { forceFallback: true },
    );

    assert.equal(result.mode, "fallback");
    // Fallback price comes from the Printify catalog entry for the idea's format.
    assert.ok(result.suggestedPrice >= 9.99 && result.suggestedPrice <= 49.99);
    assert.equal(result.seoTags.length, 13);
    assert.ok(result.podDetails.blueprintId > 0);
    assert.ok(
      typeof result.podDetails.metadata?.catalogKey === "string",
      "fallback podDetails must record the catalogKey",
    );
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
      assert.ok(result.podDetails.blueprintId > 0);
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
      podDetails: result.podDetails,
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
      podDetails: result.podDetails,
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

describe("reconcileListingCopyWithProduct (product-type guard)", () => {
  it("rewrites a tote-bag title when the product is a t-shirt", () => {
    const result = reconcileListingCopyWithProduct(
      {
        title: "Custom Pet Portrait Tote Bag | Dog Mom Gift",
        description: "A beautiful tote bag featuring your pet's portrait.",
      },
      "TEE_UNISEX",
    );
    assert.equal(result.changed, true);
    assert.doesNotMatch(result.title, /tote/i);
    assert.match(result.title, /T-Shirt/);
    assert.doesNotMatch(result.description, /tote/i);
    assert.match(result.description, /T-Shirt/);
  });

  it("rewrites cross-type words (mug title on a poster product)", () => {
    const result = reconcileListingCopyWithProduct(
      {
        title: "Gotcha Day Mug for Rescue Dog Families",
        description: "This mug celebrates adoption day.",
      },
      "POSTER_MATTE_VERTICAL",
    );
    assert.doesNotMatch(result.title, /\bmug\b/i);
    assert.match(result.title, /Poster/);
  });

  it("appends the product name when the title never names a product", () => {
    const result = reconcileListingCopyWithProduct(
      {
        title: "Adopted and Loved | Gotcha Day Keepsake",
        description: "Celebrates the day your rescue came home.",
      },
      "MUG_11OZ",
    );
    assert.match(result.title, /Mug$/);
    assert.ok(result.title.length <= 140);
  });

  it("leaves correct copy untouched (idempotent)", () => {
    const copy = {
      title: "Senior Rescue Dog Mom Coffee Mug | Gotcha Day Gift",
      description: "An 11oz ceramic mug for senior dog adopters.",
    };
    const first = reconcileListingCopyWithProduct(copy, "MUG_11OZ");
    assert.equal(first.changed, false);
    assert.equal(first.title, copy.title);
    const second = reconcileListingCopyWithProduct(
      { title: first.title, description: first.description },
      "MUG_11OZ",
    );
    assert.equal(second.changed, false);
  });

  it("never lets a hoodie word survive on the crewneck sweatshirt", () => {
    const result = reconcileListingCopyWithProduct(
      {
        title: "Cozy Dog Dad Hoodie for Winter Walks",
        description: "A warm hoodie for dog dads.",
      },
      "SWEATSHIRT_CREWNECK",
    );
    assert.doesNotMatch(result.title, /hoodie/i);
    assert.match(result.title, /Sweatshirt/);
  });

  it("caps appended titles at Etsy's 140-char limit", () => {
    const longTitle = "Rescue Dog Adoption Celebration Keepsake ".repeat(4).trim();
    const result = reconcileListingCopyWithProduct(
      { title: longTitle, description: "desc" },
      "TEE_UNISEX",
    );
    assert.ok(result.title.length <= 140);
    assert.match(result.title, /T-Shirt$/);
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
