/**
 * Product Brain structure tests.
 *
 * Checks that the module files exist with the right exports and rule patterns.
 * Mirrors the pattern used in tests/auth.test.mjs (file reads + regex).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("product brain module structure", () => {
  it("has the index entry point", () => {
    const path = join(ROOT, "src/lib/product-brain/index.ts");
    assert.ok(existsSync(path), "index.ts must exist");
    const src = readFileSync(path, "utf8");
    assert.match(src, /evaluateIdea/, "must export evaluateIdea");
    assert.match(src, /blocked/, "must define 'blocked' verdict");
    assert.match(src, /strong/, "must define 'strong' verdict");
    assert.match(src, /viable/, "must define 'viable' verdict");
    assert.match(src, /weak/, "must define 'weak' verdict");
  });

  it("has the compliance module with all blocked categories", () => {
    const path = join(ROOT, "src/lib/product-brain/compliance.ts");
    assert.ok(existsSync(path));
    const src = readFileSync(path, "utf8");
    for (const category of [
      "medical",
      "legal",
      "financial",
      "ip_brand",
      "misleading",
      "impersonation",
    ]) {
      assert.match(src, new RegExp(category), `compliance must cover ${category}`);
    }
    assert.match(src, /checkCompliance/, "must export checkCompliance");
    assert.match(src, /isBlocked/, "must export isBlocked");
  });

  it("has the scorer module with all four dimensions", () => {
    const path = join(ROOT, "src/lib/product-brain/scorer.ts");
    assert.ok(existsSync(path));
    const src = readFileSync(path, "utf8");
    assert.match(src, /specificity/, "must score specificity");
    assert.match(src, /format_fit/, "must score format_fit");
    assert.match(src, /compliance/, "must score compliance");
    assert.match(src, /demand/, "must score demand");
    assert.match(src, /scoreIdea/, "must export scoreIdea");
  });

  it("has the types module with all required types", () => {
    const path = join(ROOT, "src/lib/product-brain/types.ts");
    assert.ok(existsSync(path));
    const src = readFileSync(path, "utf8");
    assert.match(src, /BrainScore/);
    assert.match(src, /BrainVerdict/);
    assert.match(src, /BrainValidation/);
    assert.match(src, /BrainEvaluation/);
    assert.match(src, /ComplianceFlags/);
    assert.match(src, /ProductIdeaInput/);
  });

  it("compliance signals include medical keywords from AGENTS.md blocked rules", () => {
    const src = readFileSync(
      join(ROOT, "src/lib/product-brain/compliance.ts"),
      "utf8",
    );
    assert.match(src, /diagnos|treatment|cure/, "medical signals present");
    assert.match(src, /investment advice|tax advice/, "financial signals present");
    assert.match(src, /disney|marvel/, "IP brand signals present");
  });
});
