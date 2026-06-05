import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildForgeFallbackResult } from "@/lib/ajax/forge/fallback";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import { AI_DISCLOSURE_FLAG_CODE } from "@/lib/review/display";
import { evaluateSellabilityChecklist } from "@/lib/review/sellability";
import type { ComplianceFlag, PodDetails } from "@/lib/product/domain";

const sampleIdea: NovaEvaluatedIdea = {
  niche: "meal prep",
  targetBuyer: "Busy parents",
  problemSolved: "Plan weekly meals without stress",
  productConcept: "Weekly Meal Prep Planner",
  format: "planner",
  category: "productivity",
  suggestedPrice: 19.99,
  keywords: ["meal prep", "planner"],
  reasoning: "Utility-first printable",
  source: "fallback",
  trendScore: 82,
  score: {
    urgency: 70,
    specificity: 80,
    buyerClarity: 75,
    usefulness: 85,
    competitionRisk: 40,
    complianceRisk: 10,
    totalScore: 78,
  },
  validation: { riskLevel: "safe", violations: [] },
  verdict: "approve_for_generation",
};

function check(
  checklist: ReturnType<typeof evaluateSellabilityChecklist>,
  id: string,
) {
  return checklist.checks.find((c) => c.id === id);
}

describe("sellability checklist", () => {
  it("passes all checks for a complete forge fallback generation", () => {
    const forge = buildForgeFallbackResult(sampleIdea);
    const podDetails = forge.podDetails;

    const checklist = evaluateSellabilityChecklist({
      podDetails,
      fulfillment: { printifyProductId: "pfy-prod-abc123" },
      aiDisclosure: forge.aiDisclosure,
      complianceWarnings: [],
      complianceFlags: [],
      generationStatus: "ready",
    });

    assert.equal(checklist.allPassed, true);
    assert.equal(checklist.passedCount, checklist.totalCount);
  });

  it("fails incomplete podDetails", () => {
    const incomplete: PodDetails = {
      blueprintId: 0,
      printProviderId: 0,
      variantIds: [],
      artworkPrompt: "short",
      aestheticStyle: "",
    };

    const checklist = evaluateSellabilityChecklist({
      podDetails: incomplete,
      fulfillment: { printifyProductId: "pfy-prod-abc123" },
      aiDisclosure: "Disclosed",
      complianceWarnings: [],
      complianceFlags: [],
      generationStatus: "ready",
    });

    assert.equal(check(checklist, "pod_blueprint")?.passed, false);
    assert.equal(check(checklist, "pod_artwork_prompt")?.passed, false);
    assert.equal(check(checklist, "pod_aesthetic_style")?.passed, false);
  });

  it("passes blueprint checks for valid podDetails", () => {
    const podDetails: PodDetails = {
      blueprintId: 68,
      printProviderId: 1,
      variantIds: [33719],
      artworkPrompt:
        "Original minimalist artwork for meal prep niche, no logos or characters",
      aestheticStyle: "minimalist-line-art",
    };

    const checklist = evaluateSellabilityChecklist({
      podDetails,
      fulfillment: { printifyProductId: "pfy-prod-ok" },
      aiDisclosure: "AI used",
      complianceWarnings: [],
      complianceFlags: [],
      generationStatus: "ready",
    });

    assert.equal(check(checklist, "pod_blueprint")?.passed, true);
    assert.equal(check(checklist, "pod_artwork_prompt")?.passed, true);
    assert.equal(check(checklist, "pod_aesthetic_style")?.passed, true);
  });

  it("ignores ai_disclosure flag for compliance check", () => {
    const aiFlag: ComplianceFlag = {
      code: AI_DISCLOSURE_FLAG_CODE,
      message: "AI disclosure",
      severity: "info",
    };

    const clear = evaluateSellabilityChecklist({
      podDetails: null,
      fulfillment: null,
      aiDisclosure: "Present",
      complianceWarnings: [],
      complianceFlags: [aiFlag],
      generationStatus: "pending",
    });
    assert.equal(check(clear, "no_compliance_warnings")?.passed, true);

    const blocked = evaluateSellabilityChecklist({
      podDetails: null,
      fulfillment: null,
      aiDisclosure: "Present",
      complianceWarnings: ["Verify medical claims."],
      complianceFlags: [aiFlag],
      generationStatus: "pending",
    });
    assert.equal(check(blocked, "no_compliance_warnings")?.passed, false);
  });

  it("ignores forge review_note flag for compliance check", () => {
    const reviewNoteFlag: ComplianceFlag = {
      code: "review_note",
      message: "Demo fallback — verify niche accuracy.",
      severity: "warning",
      source: "forge",
    };

    const clear = evaluateSellabilityChecklist({
      podDetails: null,
      fulfillment: null,
      aiDisclosure: "Present",
      complianceWarnings: [],
      complianceFlags: [reviewNoteFlag],
      generationStatus: "pending",
    });
    assert.equal(check(clear, "no_compliance_warnings")?.passed, true);
  });

  it("requires ready status and printify product id for fulfillment ready", () => {
    const base = {
      podDetails: null,
      aiDisclosure: null,
      complianceWarnings: [] as string[],
      complianceFlags: [] as ComplianceFlag[],
    };

    assert.equal(
      check(
        evaluateSellabilityChecklist({
          ...base,
          fulfillment: null,
          generationStatus: "ready",
        }),
        "fulfillment_ready",
      )?.passed,
      false,
    );

    assert.equal(
      check(
        evaluateSellabilityChecklist({
          ...base,
          fulfillment: { printifyProductId: "pfy-prod-abc" },
          generationStatus: "ready",
        }),
        "fulfillment_ready",
      )?.passed,
      true,
    );

    assert.equal(
      check(
        evaluateSellabilityChecklist({
          ...base,
          fulfillment: null,
          generationStatus: "ready",
          mockMode: true,
        }),
        "fulfillment_ready",
      )?.passed,
      true,
    );
  });
});
