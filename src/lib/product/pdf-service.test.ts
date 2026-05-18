import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { buildForgeFallbackResult } from "@/lib/ajax/forge/fallback";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import { generateProductPdf } from "@/lib/product/pdf-generator";
import {
  buildProductPdfStoragePath,
  parseProductPdfStoragePath,
} from "@/lib/product/pdf-storage";
import { productStructureToDocument } from "@/lib/product/structure-to-document";
import {
  buildProductPdfDownloadHref,
  getReviewPdfUiState,
} from "@/lib/review/display";

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

describe("productStructureToDocument", () => {
  it("maps Forge structure into a printable document", async () => {
    const forge = buildForgeFallbackResult(sampleIdea);
    const doc = productStructureToDocument(forge.productStructure, {
      title: forge.listingTitle,
      footerNote: forge.aiDisclosure,
      audience: sampleIdea.targetBuyer,
    });

    assert.ok(doc.pages.length >= 2);
    assert.equal(doc.title, forge.listingTitle);
    const bytes = await generateProductPdf(doc);
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
    const loaded = await PDFDocument.load(bytes);
    assert.ok(loaded.getPageCount() >= 1);
  });
});

describe("pdf storage path helpers", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const generationId = "22222222-2222-4222-8222-222222222222";

  it("builds user-scoped storage paths", () => {
    const path = buildProductPdfStoragePath(userId, generationId);
    assert.equal(path, `${userId}/${generationId}.pdf`);
    const parsed = parseProductPdfStoragePath(path);
    assert.deepEqual(parsed, { userId, generationId });
  });

  it("rejects malformed paths", () => {
    assert.equal(parseProductPdfStoragePath("other-user/file.pdf"), null);
  });
});

describe("review PDF display helpers", () => {
  it("shows download when ready with storage path", () => {
    assert.equal(
      getReviewPdfUiState({
        generationStatus: "ready",
        storagePath: "user/gen.pdf",
      }),
      "download",
    );
  });

  it("shows placeholder when pending or mock mode", () => {
    assert.equal(
      getReviewPdfUiState({
        generationStatus: "pending",
        storagePath: null,
      }),
      "placeholder",
    );
    assert.equal(
      getReviewPdfUiState({
        generationStatus: "ready",
        storagePath: "x/y.pdf",
        mockMode: true,
      }),
      "placeholder",
    );
  });

  it("shows failed state", () => {
    assert.equal(
      getReviewPdfUiState({
        generationStatus: "failed",
        storagePath: null,
      }),
      "failed",
    );
  });

  it("builds authenticated download route href", () => {
    const href = buildProductPdfDownloadHref("gen-123");
    assert.match(href, /\/api\/ajax\/product-generations\/gen-123\/pdf-download$/);
  });
});
