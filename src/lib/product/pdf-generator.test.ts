import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  createSampleProduct,
  generateProductPdf,
  generateProductPdfBuffer,
} from "@/lib/product/pdf-generator";

function pdfHeader(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 5));
}

describe("pdf generator", () => {
  it("creates a sample product fixture with multiple pages", () => {
    const sample = createSampleProduct();

    assert.equal(sample.title, "Weekly Meal Prep Planner");
    assert.ok(sample.pages.length >= 2);
    assert.match(sample.footerNote ?? "", /personal use/i);
  });

  it("generates non-empty PDF bytes with a valid header", async () => {
    const bytes = await generateProductPdf(createSampleProduct());

    assert.ok(bytes.byteLength > 500);
    assert.equal(pdfHeader(bytes), "%PDF-");
  });

  it("loads generated PDFs with pdf-lib and includes multiple pages", async () => {
    const bytes = await generateProductPdf(createSampleProduct());
    const doc = await PDFDocument.load(bytes);

    assert.ok(doc.getPageCount() >= 2);
  });

  it("returns a Node Buffer from generateProductPdfBuffer", async () => {
    const buffer = await generateProductPdfBuffer(createSampleProduct());

    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(pdfHeader(new Uint8Array(buffer)), "%PDF-");
  });

  it("renders a minimal single-page product without throwing", async () => {
    const bytes = await generateProductPdf({
      title: "Focus Block Planner",
      pages: [
        {
          id: "focus",
          title: "Today",
          sections: [
            {
              id: "block",
              fields: [
                {
                  id: "task",
                  label: "Top priority",
                  type: "text",
                  placeholder: "One task",
                },
              ],
            },
          ],
        },
      ],
    });

    assert.ok(bytes.byteLength > 200);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
  });
});
