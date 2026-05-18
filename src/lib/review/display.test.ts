import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_DISCLOSURE_FLAG_CODE,
  buildProductPdfDownloadHref,
  buildProductPdfGenerateHref,
  collectComplianceMessages,
  COMPLIANCE_APPROVAL_BLOCK_MESSAGE,
  filterComplianceFlags,
  getFailedSellabilityCheckLabels,
  getReviewApproveUi,
  getReviewPdfUiState,
  hasComplianceRisk,
  hasComplianceSellabilityBlock,
  isPdfOnlySellabilityBlock,
  resolveApproveApiError,
} from "@/lib/review/display";
import { buildForgeFallbackResult } from "@/lib/ajax/forge/fallback";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import type { ComplianceFlag } from "@/lib/product/domain";
import { evaluateSellabilityChecklist } from "@/lib/review/sellability";

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

describe("review display helpers", () => {
  const aiFlag: ComplianceFlag = {
    code: AI_DISCLOSURE_FLAG_CODE,
    message: "AI tools assisted in drafting this listing.",
    severity: "info",
    source: "forge",
  };

  const reviewFlag: ComplianceFlag = {
    code: "review_note",
    message: "Verify niche claims before publish.",
    severity: "warning",
    source: "forge",
  };

  it("filters informational forge flags out of compliance flags", () => {
    const filtered = filterComplianceFlags([aiFlag, reviewFlag]);
    assert.equal(filtered.length, 0);
  });

  it("does not count AI disclosure as compliance risk", () => {
    assert.equal(
      hasComplianceRisk({ warnings: [], flags: [aiFlag] }),
      false,
    );
    assert.equal(
      hasComplianceRisk({ warnings: ["Check claims."], flags: [aiFlag] }),
      true,
    );
  });

  it("omits informational flags from compliance messages", () => {
    const messages = collectComplianceMessages({
      warnings: [],
      flags: [aiFlag, reviewFlag],
    });
    assert.equal(messages.length, 0);
  });

  it("includes real policy warnings in compliance messages", () => {
    const messages = collectComplianceMessages({
      warnings: ["Verify niche claims before publish."],
      flags: [aiFlag, reviewFlag],
    });
    assert.equal(messages.length, 1);
    assert.match(messages[0]?.message ?? "", /Verify niche claims/);
  });

  it("returns caution approve UI for needs_revision", () => {
    const ui = getReviewApproveUi("needs_revision");
    assert.equal(ui.label, "Approve with Caution");
    assert.equal(ui.tone, "caution");
    assert.equal(ui.disabled, false);
    assert.ok(ui.cautionMessage?.includes("operator review"));
  });

  it("disables approve for blocked brain verdict", () => {
    const ui = getReviewApproveUi("blocked");
    assert.equal(ui.disabled, true);
    assert.match(ui.disabledReason ?? "", /cannot be approved/i);
  });

  it("keeps standard approve UI for approve_for_generation", () => {
    const ui = getReviewApproveUi("approve_for_generation");
    assert.equal(ui.label, "Approve");
    assert.equal(ui.tone, "approve");
    assert.equal(ui.disabled, false);
    assert.equal(ui.cautionMessage, null);
  });

  it("disables approve with blocked styling when sellability checklist fails", () => {
    const checklist = evaluateSellabilityChecklist({
      structure: null,
      aiDisclosure: null,
      complianceWarnings: [],
      complianceFlags: [],
      generationStatus: "pending",
      pdfStoragePath: null,
    });
    const ui = getReviewApproveUi("needs_revision", {
      sellabilityAllPassed: false,
      sellability: checklist,
    });
    assert.equal(ui.label, "Cannot Approve Yet");
    assert.equal(ui.disabled, true);
    assert.equal(ui.tone, "blocked");
    assert.equal(ui.cautionMessage, null);
    assert.equal(ui.approvalBlockedHeading, "Approval blocked because:");
    assert.ok(ui.blockedCheckLabels.length > 0);
  });

  it("lists failed sellability check labels", () => {
    const checklist = evaluateSellabilityChecklist({
      structure: null,
      aiDisclosure: null,
      complianceWarnings: [],
      complianceFlags: [],
      generationStatus: "pending",
      pdfStoragePath: null,
    });
    const labels = getFailedSellabilityCheckLabels(checklist);
    assert.ok(labels.includes("PDF ready"));
    assert.ok(labels.includes("6+ pages"));
  });

  it("detects PDF-only sellability block", () => {
    const forge = buildForgeFallbackResult(sampleIdea);
    const forgeLike = evaluateSellabilityChecklist({
      structure: forge.productStructure,
      aiDisclosure: forge.aiDisclosure,
      complianceWarnings: [],
      complianceFlags: [],
      generationStatus: "ready",
      pdfStoragePath: null,
    });
    assert.equal(isPdfOnlySellabilityBlock(forgeLike), true);
    const ui = getReviewApproveUi("approve_for_generation", {
      sellability: forgeLike,
    });
    assert.equal(ui.showGeneratePdfAction, true);
  });

  it("shows compliance reject message when compliance check fails", () => {
    const checklist = evaluateSellabilityChecklist({
      structure: null,
      aiDisclosure: "disclosed",
      complianceWarnings: ["Policy concern"],
      complianceFlags: [],
      generationStatus: "ready",
      pdfStoragePath: "user/gen.pdf",
    });
    assert.equal(hasComplianceSellabilityBlock(checklist), true);
    const ui = getReviewApproveUi("approve_for_generation", {
      sellability: checklist,
    });
    assert.equal(ui.complianceBlockMessage, COMPLIANCE_APPROVAL_BLOCK_MESSAGE);
    assert.match(
      ui.complianceBlockMessage ?? "",
      /Reject or regenerate/i,
    );
  });

  it("uses blocked label for brain-blocked verdict", () => {
    const ui = getReviewApproveUi("blocked");
    assert.equal(ui.label, "Cannot Approve Yet");
    assert.equal(ui.tone, "blocked");
    assert.equal(ui.disabled, true);
  });

  it("resolves approve API errors including 403 payloads", () => {
    assert.equal(
      resolveApproveApiError(403, {
        error: "Sellability checklist has failing items: PDF ready",
      }),
      "Sellability checklist has failing items: PDF ready",
    );
    assert.equal(resolveApproveApiError(403, {}), "Approval blocked.");
    assert.equal(resolveApproveApiError(500, {}), "Approval failed.");
  });

  it("exposes download UI only when PDF is ready with a storage path", () => {
    assert.equal(
      getReviewPdfUiState({
        generationStatus: "ready",
        storagePath: "user-id/gen-id.pdf",
      }),
      "download",
    );
    assert.equal(
      getReviewPdfUiState({
        generationStatus: "ready",
        storagePath: null,
      }),
      "placeholder",
    );
  });

  it("builds server download route for generation id", () => {
    assert.match(
      buildProductPdfDownloadHref("abc"),
      /product-generations\/abc\/pdf-download/,
    );
  });

  it("builds server generate route for generation id", () => {
    assert.match(
      buildProductPdfGenerateHref("abc"),
      /product-generations\/abc\/generate-pdf/,
    );
  });
});
