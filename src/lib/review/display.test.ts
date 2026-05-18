import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_DISCLOSURE_FLAG_CODE,
  buildProductPdfDownloadHref,
  collectComplianceMessages,
  filterComplianceFlags,
  getReviewApproveUi,
  getReviewPdfUiState,
  hasComplianceRisk,
} from "@/lib/review/display";
import type { ComplianceFlag } from "@/lib/product/domain";

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

  it("filters AI disclosure out of compliance flags", () => {
    const filtered = filterComplianceFlags([aiFlag, reviewFlag]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.code, "review_note");
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

  it("omits AI disclosure from compliance messages", () => {
    const messages = collectComplianceMessages({
      warnings: [],
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
});
