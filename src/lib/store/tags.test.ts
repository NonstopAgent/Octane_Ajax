import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectStoreTags } from "@/lib/store/tags";
import type { ProductIdea } from "@/lib/ajax/types";

function idea(partial: Partial<ProductIdea>): ProductIdea {
  return {
    id: "idea-1",
    userId: "user-1",
    source: "nova",
    niche: "ADHD planners",
    title: "Morning routine",
    description: "Desc",
    seoKeywords: ["planner", "routine"],
    trendScore: 80,
    status: "selected",
    rawPayload: {},
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("collectStoreTags", () => {
  it("merges seo keywords and forge seoTags without duplicates", () => {
    const tags = collectStoreTags(
      idea({
        seoKeywords: ["planner", "routine"],
        rawPayload: { seoTags: ["planner", "adhd", "printable"] },
      }),
      null,
    );
    assert.deepEqual(tags, ["planner", "routine", "adhd", "printable"]);
  });

  it("includes generation metadata tags when present", () => {
    const tags = collectStoreTags(null, {
      id: "gen-1",
      userId: "user-1",
      productIdeaId: "idea-1",
      productListingId: "listing-1",
      structure: {
        format: "planner",
        pageCount: 1,
        pages: [],
        metadata: { tags: ["bundle", "worksheet"] },
      },
      llm: {
        provider: null,
        model: null,
        promptVersion: null,
        tokenEstimateInput: null,
        tokenEstimateOutput: null,
      },
      generationStatus: "ready",
      pdf: { storagePath: null, publicUrl: null },
      complianceFlags: [],
      complianceWarnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert.deepEqual(tags, ["bundle", "worksheet"]);
  });
});
