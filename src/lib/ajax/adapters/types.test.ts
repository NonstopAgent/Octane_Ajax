import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listingPriceToCents } from "@/lib/ajax/adapters/types";

describe("listingPriceToCents", () => {
  it("maps listing price to cents with default", () => {
    assert.equal(listingPriceToCents(null), 799);
    assert.equal(listingPriceToCents(12.99), 1299);
    assert.equal(listingPriceToCents(0.5), 100);
  });
});
