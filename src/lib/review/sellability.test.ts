import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildForgeFallbackResult } from "@/lib/ajax/forge/fallback";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import { AI_DISCLOSURE_FLAG_CODE } from "@/lib/review/display";
import { evaluateSellabilityChecklist } from "@/lib/review/sellability";
import type { ComplianceFlag, ProductStructure } from "@/lib/product/domain";

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
    const structure = forge.productStructure;

    const checklist = evaluateSellabilityChecklist({
      structure,
      aiDisclosure: forge.aiDisclosure,
      complianceWarnings: [],
      complianceFlags: [],
      generationStatus: "ready",
      pdfStoragePath: "user/gen.pdf",
    });

    assert.equal(checklist.allPassed, true);
    assert.equal(checklist.passedCount, checklist.totalCount);
  });

  it("fails thin structures and missing page roles", () => {
    const thin: ProductStructure = {
      format: "letter",
      pageCount: 2,
      pages: [
        {
          pageNumber: 1,
          title: "Only cover",
          purpose: "Cover",
          sections: [{ id: "a", heading: "Cover" }],
          metadata: { pageKind: "cover" },
        },
        {
          pageNumber: 2,
          title: "Only worksheet",
          purpose: "Work",
          sections: [{ id: "b", heading: "Sheet" }],
          metadata: { pageKind: "worksheet" },
        },
      ],
    };

    const checklist = evaluateSellabilityChecklist({
      structure: thin,
      aiDisclosure: "Disclosed",
      complianceWarnings: [],
      complianceFlags: [],
      generationStatus: "ready",
      pdfStoragePath: "path.pdf",
    });

    assert.equal(check(checklist, "min_six_pages")?.passed, false);
    assert.equal(check(checklist, "worksheet_pages")?.passed, false);
    assert.equal(check(checklist, "instructions_page")?.passed, false);
    assert.equal(check(checklist, "summary_page")?.passed, false);
  });

  it("treats intro metadata as instructions page", () => {
    const structure: ProductStructure = {
      format: "letter",
      pageCount: 6,
      pages: Array.from({ length: 6 }, (_, i) => ({
        pageNumber: i + 1,
        title: `Page ${i + 1}`,
        purpose: "Purpose",
        sections: [{ id: `s${i}`, heading: "Section" }],
        metadata: {
          pageKind:
            i === 0
              ? "cover"
              : i === 1
                ? "intro"
                : i === 5
                  ? "summary"
                  : "worksheet",
        },
      })),
    };

    const checklist = evaluateSellabilityChecklist({
      structure,
      aiDisclosure: "AI used",
      complianceWarnings: [],
      complianceFlags: [],
      generationStatus: "ready",
      pdfStoragePath: "ok.pdf",
    });

    assert.equal(check(checklist, "instructions_page")?.passed, true);
    assert.equal(check(checklist, "min_six_pages")?.passed, true);
    assert.equal(check(checklist, "worksheet_pages")?.passed, true);
  });

  it("ignores ai_disclosure flag for compliance check", () => {
    const aiFlag: ComplianceFlag = {
      code: AI_DISCLOSURE_FLAG_CODE,
      message: "AI disclosure",
      severity: "info",
    };

    const clear = evaluateSellabilityChecklist({
      structure: null,
      aiDisclosure: "Present",
      complianceWarnings: [],
      complianceFlags: [aiFlag],
      generationStatus: "pending",
      pdfStoragePath: null,
    });
    assert.equal(check(clear, "no_compliance_warnings")?.passed, true);

    const blocked = evaluateSellabilityChecklist({
      structure: null,
      aiDisclosure: "Present",
      complianceWarnings: ["Verify medical claims."],
      complianceFlags: [aiFlag],
      generationStatus: "pending",
      pdfStoragePath: null,
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
      structure: null,
      aiDisclosure: "Present",
      complianceWarnings: [],
      complianceFlags: [reviewNoteFlag],
      generationStatus: "pending",
      pdfStoragePath: null,
    });
    assert.equal(check(clear, "no_compliance_warnings")?.passed, true);
  });

  it("requires ready status and storage path for PDF ready", () => {
    const base = {
      structure: null,
      aiDisclosure: null,
      complianceWarnings: [] as string[],
      complianceFlags: [] as ComplianceFlag[],
    };

    assert.equal(
      check(
        evaluateSellabilityChecklist({
          ...base,
          generationStatus: "ready",
          pdfStoragePath: null,
        }),
        "pdf_ready",
      )?.passed,
      false,
    );

    assert.equal(
      check(
        evaluateSellabilityChecklist({
          ...base,
          generationStatus: "ready",
          pdfStoragePath: "user/file.pdf",
        }),
        "pdf_ready",
      )?.passed,
      true,
    );

    assert.equal(
      check(
        evaluateSellabilityChecklist({
          ...base,
          generationStatus: "ready",
          pdfStoragePath: "user/file.pdf",
          mockMode: true,
        }),
        "pdf_ready",
      )?.passed,
      false,
    );
  });
});
