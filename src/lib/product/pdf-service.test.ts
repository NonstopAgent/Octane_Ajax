import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import type { NovaEvaluatedIdea } from "@/lib/ajax/nova/types";
import { generateProductPdf } from "@/lib/product/pdf-generator";
import type { ProductStructure } from "@/lib/product/domain";
import {
  buildProductPdfStoragePath,
  parseProductPdfStoragePath,
} from "@/lib/product/pdf-storage";
import {
  isSellableStructure,
  productStructureToDocument,
} from "@/lib/product/structure-to-document";
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

const sellableLegacyStructure: ProductStructure = {
  format: "planner",
  pageCount: 8,
  pages: Array.from({ length: 8 }, (_, i) => ({
    pageNumber: i + 1,
    title: `Page ${i + 1}`,
    purpose: "Worksheet purpose",
    userInstructions: "Print and fill.",
    sections: [
      {
        id: `section_${i + 1}`,
        heading: `Section ${i + 1}`,
        fields: [{ id: "notes", label: "Notes", fieldType: "notes" as const }],
      },
    ],
    metadata: {
      pageKind:
        i === 0
          ? "cover"
          : i === 1
            ? "intro"
            : i === 7
              ? "summary"
              : "worksheet",
    },
  })),
};

describe("productStructureToDocument", () => {
  it("maps legacy printable structure into a sellable document", async () => {
    assert.ok(isSellableStructure(sellableLegacyStructure));
    assert.ok(sellableLegacyStructure.pages.length >= 6);

    const doc = productStructureToDocument(sellableLegacyStructure, {
      title: sampleIdea.productConcept,
      disclosureNote:
        "AI tools assisted in drafting and structuring this product.",
      audience: sampleIdea.targetBuyer,
    });

    assert.ok(doc.pages.length >= 6);
    assert.equal(doc.title, sampleIdea.productConcept);
    assert.equal(doc.pages[0]?.kind, "cover");
    assert.ok(doc.disclosureNote?.includes("AI tools assisted"));

    const bytes = await generateProductPdf(doc);
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
    const loaded = await PDFDocument.load(bytes);
    assert.ok(loaded.getPageCount() >= 6);
  });

  it("still maps thin legacy two-page structures", async () => {
    const doc = productStructureToDocument(
      {
        format: "planner",
        pageCount: 2,
        pages: [
          {
            pageNumber: 1,
            title: "Page one",
            purpose: "Legacy",
            sections: [
              {
                id: "a",
                heading: "Section",
                fields: [{ id: "f", label: "Field", fieldType: "text" }],
              },
            ],
          },
          {
            pageNumber: 2,
            title: "Page two",
            purpose: "Legacy",
            sections: [
              {
                id: "b",
                heading: "Section B",
                fields: [{ id: "g", label: "Goal", fieldType: "text" }],
              },
            ],
          },
        ],
      },
      { title: "Legacy Pack" },
    );

    assert.equal(doc.pages.length, 2);
    const bytes = await generateProductPdf(doc);
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

  it("shows placeholder when pending, queued, or mock mode", () => {
    assert.equal(
      getReviewPdfUiState({
        generationStatus: "pending",
        storagePath: null,
      }),
      "placeholder",
    );
    assert.equal(
      getReviewPdfUiState({
        generationStatus: "queued",
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
