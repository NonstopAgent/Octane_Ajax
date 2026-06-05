import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateProductIdea } from "@/lib/ajax/product-brain";
import type { ProductIdea as DbIdea } from "@/lib/supabase/database.types";
import type { ProductGeneration as DbGeneration } from "@/lib/supabase/database.types";
import {
  mapGenerationFromDb,
  mapGenerationToDbInsert,
  mapGenerationToDbUpdate,
  mapIdeaBrainFromDb,
  mapIdeaBrainToDbUpdate,
} from "@/lib/product/mappers";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const IDEA_ID = "00000000-0000-4000-8000-000000000002";
const GENERATION_ID = "00000000-0000-4000-8000-000000000003";

function baseDbIdea(overrides: Partial<DbIdea> = {}): DbIdea {
  return {
    id: IDEA_ID,
    user_id: USER_ID,
    source: "nova",
    niche: "parenting support for PDA mornings",
    title: "Visual Morning Routine Planner for Parents of PDA Children",
    description: "Printable visual morning routine planner with transition cues.",
    seo_keywords: ["pda", "morning routine", "visual planner"],
    trend_score: 72,
    status: "idea",
    raw_payload: {},
    brain_score: {},
    brain_validation: {},
    brain_verdict: null,
    brain_evaluated_at: null,
    created_at: "2026-05-17T12:00:00.000Z",
    ...overrides,
  };
}

function baseDbGeneration(overrides: Partial<DbGeneration> = {}): DbGeneration {
  return {
    id: GENERATION_ID,
    user_id: USER_ID,
    product_idea_id: IDEA_ID,
    product_listing_id: null,
    structure: {
      blueprintId: 68,
      printProviderId: 1,
      variantIds: [33719],
      artworkPrompt:
        "Original minimalist artwork for parenting niche, no logos or characters",
      aestheticStyle: "minimalist-line-art",
      metadata: {
        fulfillment: {
          printifyProductId: "pfy-prod-abc",
          adapterMode: "demo",
        },
      },
    },
    llm_provider: "openai",
    llm_model: "gpt-4o-mini",
    prompt_version: "forge-pod-v1",
    token_estimate_input: 1200,
    token_estimate_output: 800,
    generation_status: "ready",
    pdf_storage_path: null,
    pdf_public_url: null,
    mockup_storage_path: "demo://octane-ajax/artwork/sample.png",
    compliance_flags: [
      {
        code: "ai_disclosure",
        message: "Listing copy should disclose AI-assisted creation.",
        severity: "info",
      },
    ],
    compliance_warnings: ["Verify niche claims before publish."],
    created_at: "2026-05-17T12:05:00.000Z",
    updated_at: "2026-05-17T12:05:00.000Z",
    ...overrides,
  };
}

describe("product mappers — Product Brain on product_ideas", () => {
  it("maps a full brain snapshot from DB columns", () => {
    const row = baseDbIdea({
      brain_score: {
        urgency: 70,
        specificity: 82,
        buyerClarity: 78,
        usefulness: 80,
        competitionRisk: 25,
        complianceRisk: 0,
        totalScore: 76,
      },
      brain_validation: {
        riskLevel: "safe",
        violations: [],
      },
      brain_verdict: "approve_for_generation",
      brain_evaluated_at: "2026-05-17T12:00:00.000Z",
    });

    const snapshot = mapIdeaBrainFromDb(row);

    assert.ok(snapshot);
    assert.equal(snapshot.verdict, "approve_for_generation");
    assert.equal(snapshot.score.totalScore, 76);
    assert.equal(snapshot.validation.riskLevel, "safe");
    assert.equal(snapshot.evaluatedAt, "2026-05-17T12:00:00.000Z");
  });

  it("returns null when brain verdict or evaluated_at is missing", () => {
    assert.equal(mapIdeaBrainFromDb(baseDbIdea()), null);
    assert.equal(
      mapIdeaBrainFromDb(
        baseDbIdea({
          brain_verdict: "blocked",
          brain_evaluated_at: null,
        }),
      ),
      null,
    );
  });

  it("round-trips evaluateProductIdea through DB update shape", () => {
    const evaluation = evaluateProductIdea({
      title: "Visual Morning Routine Planner for Parents of PDA Children",
      niche: "parenting support for pathological demand avoidance mornings",
      targetBuyer: "Parents of children with PDA who struggle with morning transitions",
      problemSolved:
        "Reduce overwhelming morning meltdowns with a visual step-by-step routine planner",
      format: "planner",
      category: "parenting_support",
      description:
        "Printable visual morning routine planner with icons, checkboxes, and transition cues for PDA-friendly mornings.",
      keywords: ["pda", "morning routine", "visual planner", "parents", "sensory"],
    });

    const evaluatedAt = "2026-05-17T12:00:00.000Z";
    const dbUpdate = mapIdeaBrainToDbUpdate({
      score: evaluation.score,
      validation: evaluation.validation,
      verdict: evaluation.verdict,
      evaluatedAt,
    });

    const row = baseDbIdea({
      brain_score: dbUpdate.brain_score as DbIdea["brain_score"],
      brain_validation: dbUpdate.brain_validation as DbIdea["brain_validation"],
      brain_verdict: dbUpdate.brain_verdict,
      brain_evaluated_at: dbUpdate.brain_evaluated_at,
    });

    const snapshot = mapIdeaBrainFromDb(row);

    assert.ok(snapshot);
    assert.equal(snapshot.verdict, evaluation.verdict);
    assert.equal(snapshot.score.totalScore, evaluation.score.totalScore);
    assert.deepEqual(snapshot.validation.violations, evaluation.validation.violations);
  });
});

describe("product mappers — product_generations", () => {
  it("maps generation rows into domain objects with podDetails and compliance", () => {
    const domain = mapGenerationFromDb(baseDbGeneration());

    assert.equal(domain.id, GENERATION_ID);
    assert.equal(domain.productIdeaId, IDEA_ID);
    assert.equal(domain.generationStatus, "ready");
    assert.equal(domain.podDetails.blueprintId, 68);
    assert.equal(domain.podDetails.variantIds.length, 1);
    assert.equal(domain.fulfillment?.printifyProductId, "pfy-prod-abc");
    assert.equal(domain.llm.model, "gpt-4o-mini");
    assert.equal(domain.mockupStoragePath, "demo://octane-ajax/artwork/sample.png");
    assert.equal(domain.complianceFlags.length, 1);
    assert.equal(domain.complianceFlags[0]?.code, "ai_disclosure");
    assert.deepEqual(domain.complianceWarnings, [
      "Verify niche claims before publish.",
    ]);
  });

  it("defaults invalid generation_status to pending", () => {
    const domain = mapGenerationFromDb(
      baseDbGeneration({ generation_status: "not-a-real-status" }),
    );

    assert.equal(domain.generationStatus, "pending");
  });

  it("maps domain inserts and partial updates to DB column names", () => {
    const domain = mapGenerationFromDb(baseDbGeneration());
    const insert = mapGenerationToDbInsert({
      userId: USER_ID,
      productIdeaId: domain.productIdeaId,
      productListingId: domain.productListingId,
      podDetails: domain.podDetails,
      llm: domain.llm,
      generationStatus: "queued",
      pdf: domain.pdf,
      mockupStoragePath: domain.mockupStoragePath,
      complianceFlags: domain.complianceFlags,
      complianceWarnings: domain.complianceWarnings,
    });

    assert.equal(insert.user_id, USER_ID);
    assert.equal(insert.product_idea_id, IDEA_ID);
    assert.equal(insert.generation_status, "queued");
    assert.equal(insert.llm_model, "gpt-4o-mini");

    const update = mapGenerationToDbUpdate({
      generationStatus: "generating",
      pdf: { publicUrl: "https://cdn.example.com/sample.pdf" },
    });

    assert.equal(update.generation_status, "generating");
    assert.equal(update.pdf_public_url, "https://cdn.example.com/sample.pdf");
    assert.equal(update.pdf_storage_path, undefined);
  });
});
