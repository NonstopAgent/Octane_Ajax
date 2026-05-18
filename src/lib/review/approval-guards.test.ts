import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildForgeFallbackResult } from "@/lib/ajax/forge/fallback";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import {
  ApprovalBlockedError,
  assertPdfReadyForApproval,
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

  it("blocks approval when PDF is not ready", () => {
    assert.throws(
      () =>
        assertPdfReadyForApproval({
          isDemo: false,
          generationStatus: "queued",
          pdfStoragePath: null,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApprovalBlockedError);
        assert.match((err as ApprovalBlockedError).message, /PDF is not ready/i);
        return true;
      },
    );
  });

  it("allows approval when PDF is ready with storage path", () => {
    assert.doesNotThrow(() =>
      assertPdfReadyForApproval({
        isDemo: false,
        generationStatus: "ready",
        pdfStoragePath: "user/gen.pdf",
      }),
    );
  });

  it("skips PDF guard in demo bypass mode", () => {
    assert.doesNotThrow(() =>
      assertPdfReadyForApproval({
        isDemo: true,
        generationStatus: "queued",
        pdfStoragePath: null,
      }),
    );
  });

  it("blocks approval when sellability checklist fails", () => {
    assert.throws(
      () =>
        assertSellabilityForApproval(
          {
            structure: null,
            aiDisclosure: null,
            complianceWarnings: [],
            complianceFlags: [],
            generationStatus: "pending",
            pdfStoragePath: null,
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
          structure: forge.productStructure,
          aiDisclosure: forge.aiDisclosure,
          complianceWarnings: [],
          complianceFlags: [],
          generationStatus: "ready",
          pdfStoragePath: "user/gen.pdf",
        },
        false,
      ),
    );
  });

  it("skips sellability guard in demo bypass mode", () => {
    assert.doesNotThrow(() =>
      assertSellabilityForApproval(
        {
          structure: null,
          aiDisclosure: null,
          complianceWarnings: ["blocked"],
          complianceFlags: [],
          generationStatus: "pending",
          pdfStoragePath: null,
        },
        true,
      ),
    );
  });
});
