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

  it("run-cycle routes LLM through Nova and Forge (not direct @/lib/llm)", () => {
    const route = readFileSync(
      join(ROOT, "src/app/api/ajax/run-cycle/route.ts"),
      "utf8",
    );
    const simulator = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    assert.doesNotMatch(route, /from ["']@\/lib\/llm/);
    assert.doesNotMatch(route, /completeJson/);
    assert.match(simulator, /from ["']@\/lib\/ajax\/nova/);
    assert.match(simulator, /from ["']@\/lib\/ajax\/forge/);
    assert.doesNotMatch(simulator, /from ["']@\/lib\/llm/);
  });

  it("approve hands off to pixel path", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/review/service.ts"),
      "utf8",
    );
    assert.match(content, /approve|approved/i);
  });

  it("rejects approving blocked brain verdict server-side", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/review/service.ts"),
      "utf8",
    );
    assert.match(content, /brain_verdict/);
    assert.match(content, /Blocked products cannot be approved/);
  });

  it("forge selection prefers approved ideas and safe needs_revision", () => {
    const nova = readFileSync(
      join(ROOT, "src/lib/ajax/nova/service.ts"),
      "utf8",
    );
    assert.match(nova, /approve_for_generation/);
    assert.match(nova, /validation\.riskLevel === "safe"/);
    assert.match(nova, /verdict !== "blocked"/);
  });

  it("keeps AI disclosure out of compliance warnings", () => {
    const forge = readFileSync(
      join(ROOT, "src/lib/ajax/forge/service.ts"),
      "utf8",
    );
    const display = readFileSync(
      join(ROOT, "src/lib/review/display.ts"),
      "utf8",
    );
    assert.doesNotMatch(forge, /code: "ai_disclosure"/);
    assert.match(display, /AI_DISCLOSURE_FLAG_CODE/);
    assert.match(display, /filterComplianceFlags/);
  });

  it("pixel simulator schedules content", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/ajax/pixel-simulator.ts"),
      "utf8",
    );
    assert.match(content, /content_jobs|CONTENT|scheduled/i);
  });
});
