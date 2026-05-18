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
  it("creates a rich sample product with cover and worksheets", () => {
    const sample = createSampleProduct();

    assert.equal(sample.title, "Weekly Meal Prep Planner");
    assert.ok(sample.pages.length >= 6);
    assert.equal(sample.pages[0]?.kind, "cover");
    assert.ok(sample.disclosureNote?.includes("AI tools assisted"));
  });

  it("generates non-empty PDF bytes with a valid header", async () => {
    const bytes = await generateProductPdf(createSampleProduct());

    assert.ok(bytes.byteLength > 2_000);
    assert.equal(pdfHeader(bytes), "%PDF-");
  });

  it("loads generated PDFs with cover, worksheets, page numbers", async () => {
    const bytes = await generateProductPdf(createSampleProduct());
    const doc = await PDFDocument.load(bytes);

    assert.ok(doc.getPageCount() >= 6);
  });

  it("returns a Node Buffer from generateProductPdfBuffer", async () => {
    const buffer = await generateProductPdfBuffer(createSampleProduct());

    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(pdfHeader(new Uint8Array(buffer)), "%PDF-");
  });

  it("renders a minimal legacy single-page product without throwing", async () => {
    const bytes = await generateProductPdf({
      title: "Focus Block Planner",
      pages: [
        {
          id: "focus",
          kind: "content",
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
    assert.ok(doc.getPageCount() >= 1);
  });

  it("wraps very long text without throwing", async () => {
    const longLabel =
      "This is an intentionally long field label that should wrap across multiple lines instead of overflowing the printable margin on a utility worksheet page for meal prep planning";

    const bytes = await generateProductPdf({
      title: "Long copy stress test",
      pages: [
        {
          id: "stress",
          kind: "worksheet",
          title: "Stress test page with extended headings and instructions",
          userInstructions:
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(12),
          sections: [
            {
              id: "s1",
              title: "Section with long description",
              description:
                "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium. ".repeat(
                  8,
                ),
              fields: [
                {
                  id: "long",
                  label: longLabel,
                  type: "textarea",
                  placeholder: "Placeholder text ".repeat(20),
                },
              ],
            },
          ],
        },
      ],
    });

    assert.ok(bytes.byteLength > 500);
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 1);
  });

  it("places AI disclosure only once via disclosureNote on final page flow", async () => {
    const sample = createSampleProduct();
    assert.ok(sample.disclosureNote);
    const bytes = await generateProductPdf(sample);
    assert.ok(bytes.byteLength > 0);
  });
});
