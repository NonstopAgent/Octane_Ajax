import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildForgeFallbackResult } from "@/lib/ajax/forge/fallback";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import {
  ApprovalBlockedError,
  assertPodReadyForApproval,
  assertSellabilityForApproval,
  isDemoReviewBypass,
} from "@/lib/review/approval-guards";

const sampleIdea: NovaEvaluatedIdea = {
  niche: "meal prep",
  targetBuyer: "Busy parents",
  problemSolved: "Plan weekly meals",
  productConcept: "Weekly Meal Prep Planner",
  format: "planner",
  category: "productivity",
  suggestedPrice: 19.99,
  keywords: ["meal prep"],
  reasoning: "Utility-first",
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

describe("review approval guards", () => {
  it("detects demo bypass from simulated raw payload", () => {
    assert.equal(isDemoReviewBypass({ ideaRawPayload: { simulated: true } }), true);
    assert.equal(isDemoReviewBypass({ ideaRawPayload: { cycle: "ajax-demo" } }), true);
    assert.equal(isDemoReviewBypass({ ideaRawPayload: {} }), false);
    assert.equal(isDemoReviewBypass({ ideaRawPayload: null }), false);
  });

  it("blocks approval when Printify product is not ready", () => {
    assert.throws(
      () =>
        assertPodReadyForApproval({
          isDemo: false,
          generationStatus: "queued",
          printifyProductId: null,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApprovalBlockedError);
        assert.match(
          (err as ApprovalBlockedError).message,
          /Printify product draft is not ready/i,
        );
        return true;
      },
    );
  });

  it("allows approval when Printify product is ready", () => {
    assert.doesNotThrow(() =>
      assertPodReadyForApproval({
        isDemo: false,
        generationStatus: "ready",
        printifyProductId: "pfy-prod-abc",
      }),
    );
  });

  it("skips POD guard in demo bypass mode", () => {
    assert.doesNotThrow(() =>
      assertPodReadyForApproval({
        isDemo: true,
        generationStatus: "queued",
        printifyProductId: null,
      }),
    );
  });

  it("blocks approval when sellability checklist fails", () => {
    assert.throws(
      () =>
        assertSellabilityForApproval(
          {
            podDetails: null,
            fulfillment: null,
            aiDisclosure: null,
            complianceWarnings: [],
            complianceFlags: [],
            generationStatus: "pending",
          },
          false,
        ),
      (err: unknown) => {
        assert.ok(err instanceof ApprovalBlockedError);
        assert.match(
          (err as ApprovalBlockedError).message,
          /Sellability checklist has failing items/,
        );
        return true;
      },
    );
  });

  it("allows approval when sellability passes", () => {
    const forge = buildForgeFallbackResult(sampleIdea);
    assert.doesNotThrow(() =>
      assertSellabilityForApproval(
        {
          podDetails: forge.podDetails,
          fulfillment: { printifyProductId: "pfy-prod-abc" },
          aiDisclosure: forge.aiDisclosure,
          complianceWarnings: [],
          complianceFlags: [],
          generationStatus: "ready",
        },
        false,
      ),
    );
  });

  it("skips sellability guard in demo bypass mode", () => {
    assert.doesNotThrow(() =>
      assertSellabilityForApproval(
        {
          podDetails: null,
          fulfillment: null,
          aiDisclosure: null,
          complianceWarnings: ["blocked"],
          complianceFlags: [],
          generationStatus: "pending",
        },
        true,
      ),
    );
  });
});
