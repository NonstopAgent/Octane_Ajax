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
    "src/app/api/ajax/product-generations/[id]/pdf-download/route.ts",
    "src/app/api/ajax/product-generations/[id]/generate-pdf/route.ts",
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

  it("approve runs pixel then publishes to demo storefront", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/review/service.ts"),
      "utf8",
    );
    assert.match(content, /status:\s*"approved"/);
    assert.match(content, /runPixelMarketing/);
    assert.doesNotMatch(content, /etsyAdapter|publishListing/i);
  });

  it("approve does not require PDF ready", () => {
    const review = readFileSync(
      join(ROOT, "src/lib/review/service.ts"),
      "utf8",
    );
    assert.doesNotMatch(review, /generation_status.*ready/);
    assert.doesNotMatch(review, /pdf_storage_path/);
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

  it("simulator queues PDF async without bypassing review gate", () => {
    const simulator = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    assert.doesNotMatch(simulator, /generateAndStoreProductPdf/);
    assert.match(simulator, /pdf_queued/);
    assert.match(simulator, /generationStatus:\s*"queued"/);
    assert.match(simulator, /cycle_paused/);
    assert.match(simulator, /pending_review/);
    assert.doesNotMatch(simulator, /runPixel|pixel-simulator/i);
  });

  it("generate-pdf route delegates to generation PDF runner", () => {
    const route = readFileSync(
      join(
        ROOT,
        "src/app/api/ajax/product-generations/[id]/generate-pdf/route.ts",
      ),
      "utf8",
    );
    const runner = readFileSync(
      join(ROOT, "src/lib/product/generation-pdf-runner.ts"),
      "utf8",
    );
    assert.match(route, /runGenerationPdfJob/);
    assert.match(route, /maxDuration\s*=\s*60/);
    assert.match(route, /downloadPath/);
    assert.match(runner, /generateAndStoreProductPdf/);
    assert.match(runner, /pdf_generation_failed/);
    assert.doesNotMatch(route, /createServiceClient/);
  });

  it("review PDF panel triggers generate-pdf manually", () => {
    const panel = readFileSync(
      join(ROOT, "src/components/review/review-pdf-panel.tsx"),
      "utf8",
    );
    assert.match(panel, /Generate PDF/);
    assert.match(panel, /Retry PDF generation/);
    assert.match(panel, /buildProductPdfGenerateHref/);
    assert.doesNotMatch(panel, /createServiceClient/);
  });

  it("run-cycle recovery idles agents on failure", () => {
    const simulator = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    assert.match(simulator, /recoverFromCycleFailure/);
    assert.match(simulator, /cycle_failed/);
    assert.match(simulator, /status:\s*"idle"/);
  });

  it("factory dashboard surfaces API errors and refreshes on failure", () => {
    const dashboard = readFileSync(
      join(ROOT, "src/components/factory/factory-dashboard.tsx"),
      "utf8",
    );
    assert.match(dashboard, /data\.error/);
    assert.match(dashboard, /Request failed or timed out/);
    assert.doesNotMatch(dashboard, /queuePdfGeneration/);
  });

  it("pixel simulator schedules content", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/ajax/pixel-simulator.ts"),
      "utf8",
    );
    assert.match(content, /content_jobs|CONTENT|scheduled/i);
  });

  it("listing lifecycle transitions are defined in status module", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/ajax/status.ts"),
      "utf8",
    );
    assert.match(content, /LISTING_STATUS_TRANSITIONS/);
    assert.match(content, /approved:\s*\["published"\]/);
    assert.match(content, /pending_review:\s*\["approved",\s*"rejected"\]/);
  });

  it("approve queues Pixel before publish", () => {
    const review = readFileSync(
      join(ROOT, "src/lib/review/service.ts"),
      "utf8",
    );
    assert.match(review, /status:\s*"approved"/);
    assert.match(review, /CONTENT_JOBS/);
    assert.match(review, /status:\s*"queued"/);
    assert.doesNotMatch(review, /status:\s*"published"/);
  });

  it("run-pixel route delegates to pixel simulator publish", () => {
    const route = readFileSync(
      join(ROOT, "src/app/api/ajax/run-pixel/route.ts"),
      "utf8",
    );
    assert.match(route, /runPixelMarketing/);
    assert.doesNotMatch(route, /createServiceClient/);
  });
});
