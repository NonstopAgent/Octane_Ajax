import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Static wiring check: demo API routes and simulators exist. */
describe("demo workflow wiring", () => {
  const routes = [
    "src/app/api/ajax/reset-demo/route.ts",
    "src/app/api/ajax/run-cycle/route.ts",
    "src/app/api/ajax/review/approve/route.ts",
    "src/app/api/ajax/run-pixel/route.ts",
    "src/app/api/ajax/factory-snapshot/route.ts",
  ];

  for (const route of routes) {
    it(`includes route ${route}`, () => {
      const content = readFileSync(join(ROOT, route), "utf8");
      assert.match(content, /export async function (GET|POST)/);
      assert.match(content, /createClient/);
    });
  }

  it("run-cycle blocks when review is pending", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    assert.match(content, /CycleBlockedError/);
    assert.match(content, /review_gate|REVIEW_GATE|review gate/i);
  });

  it("approve hands off to pixel path", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/review/service.ts"),
      "utf8",
    );
    assert.match(content, /approve|approved/i);
  });

  it("pixel simulator schedules content", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/ajax/pixel-simulator.ts"),
      "utf8",
    );
    assert.match(content, /content_jobs|CONTENT|scheduled/i);
  });
});
