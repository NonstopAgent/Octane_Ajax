import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const STORE_ROUTE_CANDIDATES = [
  "src/app/store/page.tsx",
  "src/app/(command)/operator-store/page.tsx",
];

function readIfExists(relativePath) {
  const full = join(ROOT, relativePath);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf8");
}

describe("storefront prototype wiring", () => {
  it("documents publish path via Pixel simulator (demo storefront)", () => {
    const pixel = readFileSync(
      join(ROOT, "src/lib/ajax/pixel-simulator.ts"),
      "utf8",
    );
    const review = readFileSync(
      join(ROOT, "src/lib/review/service.ts"),
      "utf8",
    );
    const simulator = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );

    assert.match(review, /status:\s*"approved"/);
    assert.match(review, /CONTENT_JOBS/);
    assert.match(pixel, /status:\s*"published"/);
    assert.match(simulator, /pending_review/);
    assert.match(simulator, /Pixel \/ publish not invoked/i);
  });

  it("uses factory snapshot published count for storefront metrics", () => {
    const queries = readFileSync(
      join(ROOT, "src/lib/factory/queries.ts"),
      "utf8",
    );
    assert.match(queries, /\.eq\("status",\s*"published"\)/);
    assert.match(queries, /publishedListings/);
  });

  it("includes public /store route when storefront UI is present", () => {
    const storeRoute = STORE_ROUTE_CANDIDATES.map(readIfExists).find(Boolean);
    assert.ok(storeRoute, "expected storefront page under src/app");
    assert.match(
      storeRoute,
      /fetchPublicStoreListings|fetchStoreListings|STORE_LISTING_STATUSES/i,
    );
    assert.doesNotMatch(storeRoute, /createServiceClient/);
    assert.doesNotMatch(storeRoute, /STRIPE|stripe\.com/i);
  });
});
