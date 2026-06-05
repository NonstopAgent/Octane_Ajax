import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductStructure } from "@/lib/product/domain";
import {
  isSellableStructure,
  productStructureToDocument,
} from "@/lib/product/structure-to-document";

const MIN_SELLABLE_PAGES = 6;

function structureWithPageCount(count: number): ProductStructure {
  const pages = Array.from({ length: count }, (_, i) => ({
    pageNumber: i + 1,
    title: `Page ${i + 1}`,
    purpose: "Worksheet",
    sections: [
      {
        id: `s${i + 1}`,
        heading: "Section",
        fields: [{ id: "f1", label: "Notes", fieldType: "notes" as const }],
      },
    ],
  }));

  return {
    format: "planner",
    pageCount: count,
    pages,
  };
}

describe("sellability structure checks", () => {
  it("aligns sellable threshold with minimum pages", () => {
    assert.equal(MIN_SELLABLE_PAGES, 6);
    assert.equal(
      isSellableStructure(structureWithPageCount(MIN_SELLABLE_PAGES - 1)),
      false,
    );
    assert.equal(
      isSellableStructure(structureWithPageCount(MIN_SELLABLE_PAGES)),
      true,
    );
  });

  it("maps sellable structures into printable documents", () => {
    const structure = structureWithPageCount(8);
    assert.ok(isSellableStructure(structure));
    const doc = productStructureToDocument(structure, {
      title: "Demo Planner",
      audience: "Solo operators",
    });
    assert.equal(doc.pages.length, 8);
    assert.equal(doc.format, "planner");
  });
});
