import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateProductIdea,
  explainProductScore,
  getProductBrainVerdict,
  scoreProductIdea,
  validateProductIdea,
} from "@/lib/ajax/product-brain";
import type { ProductBrainInput } from "@/lib/ajax/product-brain/types";

function baseInput(overrides: Partial<ProductBrainInput> = {}): ProductBrainInput {
  return {
    title: "Reactive Rescue Dog Mom T-Shirt Celebrating Training Wins",
    niche: "reactive rescue dog mom apparel",
    targetBuyer: "Dog moms of reactive rescue dogs navigating leash training",
    problemSolved:
      "Owners of reactive rescue dogs feel judged on walks and struggle to find apparel celebrating training wins",
    format: "tshirt",
    category: "pet_lovers",
    description:
      "Soft original-design t-shirt apparel for the rescue dog mom whose daily battle of leash training deserves celebration.",
    keywords: ["rescue dog", "dog mom", "reactive dog shirt", "dog training", "dog mom gift"],
    ...overrides,
  };
}

describe("product brain validators", () => {
  it("blocks copyrighted or trademark references", () => {
    const validation = validateProductIdea(
      baseInput({
        title: "Disney Princess Daily Planner for Kids",
        keywords: ["disney", "princess", "planner"],
      }),
    );

    assert.equal(validation.riskLevel, "blocked");
    assert.ok(
      validation.violations.some((v) => /copyrighted|trademark/i.test(v)),
    );
  });

  it("blocks medical treatment claims", () => {
    const validation = validateProductIdea(
      baseInput({
        title: "Anxiety Treatment Workbook",
        description: "This printable cures anxiety and provides medical treatment plans.",
        problemSolved: "Diagnose and treat anxiety disorder at home",
      }),
    );

    assert.equal(validation.riskLevel, "blocked");
    assert.ok(validation.violations.some((v) => /medical/i.test(v)));
  });
});

describe("product brain scoring", () => {
  it("scores specific utility ideas higher than generic planners", () => {
    const specific = scoreProductIdea(baseInput());
    const generic = scoreProductIdea(
      baseInput({
        title: "Daily Planner",
        niche: "planners",
        targetBuyer: "people",
        problemSolved: "plan your day",
        description: "A simple planner",
        keywords: ["planner", "daily"],
      }),
    );

    assert.ok(specific.totalScore > generic.totalScore);
    assert.ok(specific.specificity > generic.specificity);
    assert.ok(specific.buyerClarity > generic.buyerClarity);
    assert.ok(specific.competitionRisk < generic.competitionRisk);
  });

  it("raises compliance risk when blocked claims appear in copy", () => {
    const score = scoreProductIdea(
      baseInput({
        description: "Guaranteed results and NFL team branding included.",
        keywords: ["patriots", "guaranteed results"],
      }),
    );

    assert.equal(score.complianceRisk, 100);
  });

  it("returns a human-readable score explanation", () => {
    const score = scoreProductIdea(baseInput());
    const explanation = explainProductScore(score);

    assert.match(explanation, /Total score:/);
    assert.match(explanation, /Buyer clarity:/);
    assert.match(explanation, /Compliance risk:/);
  });
});

describe("product brain verdicts", () => {
  it('marks vague generic "Daily Planner" ideas as needs_revision', () => {
    const { verdict } = evaluateProductIdea(
      baseInput({
        title: "Daily Planner",
        niche: "productivity",
        targetBuyer: "people",
        problemSolved: "plan your day",
        description: "A simple daily planner printable",
        keywords: ["planner", "daily", "printable"],
      }),
    );

    assert.equal(verdict, "needs_revision");
  });

  it("approves specific utility products for generation", () => {
    const { verdict, score, validation } = evaluateProductIdea(baseInput());

    assert.equal(validation.riskLevel, "safe");
    assert.equal(verdict, "approve_for_generation");
    assert.ok(score.totalScore >= 60);
    assert.ok(score.buyerClarity >= 55);
  });

  it("blocks copyrighted or trademark product ideas", () => {
    const score = scoreProductIdea(
      baseInput({
        title: "Mickey Mouse Reward Chart",
        keywords: ["disney", "mickey mouse"],
      }),
    );
    const validation = validateProductIdea(
      baseInput({
        title: "Mickey Mouse Reward Chart",
        keywords: ["disney", "mickey mouse"],
      }),
    );

    assert.equal(
      getProductBrainVerdict(score, validation),
      "blocked",
    );
  });

  it("blocks medical treatment claims", () => {
    const input = baseInput({
      title: "Diabetes Cure Tracker",
      description: "Clinical treatment plan to cure diabetes",
      problemSolved: "Treat and cure diabetes with this tracker",
    });
    const { verdict, validation } = evaluateProductIdea(input);

    assert.equal(validation.riskLevel, "blocked");
    assert.equal(verdict, "blocked");
  });

  it("marks vague products with no clear audience as needs_revision", () => {
    const { verdict } = evaluateProductIdea(
      baseInput({
        title: "Printable Organizer",
        niche: "organization",
        targetBuyer: "",
        problemSolved: "get organized",
        description: "Helpful organizer",
        keywords: ["organizer"],
      }),
    );

    assert.equal(verdict, "needs_revision");
  });

  it("blocks when compliance risk is high even if utility scores are strong", () => {
    const score = scoreProductIdea(baseInput());
    const blockedScore = { ...score, complianceRisk: 100, totalScore: score.totalScore - 30 };

    assert.equal(
      getProductBrainVerdict(blockedScore, { riskLevel: "safe", violations: [] }),
      "blocked",
    );
  });
});
