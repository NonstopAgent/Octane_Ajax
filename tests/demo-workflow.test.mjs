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
    "src/app/api/ajax/run-nova/route.ts",
    "src/app/api/ajax/run-forge/route.ts",
    "src/app/api/ajax/run-cycle/route.ts",
    "src/app/api/ajax/review/approve/route.ts",
    "src/app/api/ajax/run-pixel/route.ts",
    "src/app/api/ajax/factory-snapshot/route.ts",
    "src/app/api/ajax/product-generations/[id]/pdf-download/route.ts",
  ];

  for (const route of routes) {
    it(`includes route ${route}`, () => {
      const content = readFileSync(join(ROOT, route), "utf8");
      assert.match(content, /export async function (GET|POST)/);
      assert.match(content, /createClient/);
    });
  }

  it("staged steps block when review is pending", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    assert.match(content, /CycleBlockedError/);
    assert.match(content, /preflightCycle/);
    assert.match(content, /review_gate|REVIEW_GATE|review gate/i);
  });

  it("nova and forge routes delegate to staged simulator steps", () => {
    const novaRoute = readFileSync(
      join(ROOT, "src/app/api/ajax/run-nova/route.ts"),
      "utf8",
    );
    const forgeRoute = readFileSync(
      join(ROOT, "src/app/api/ajax/run-forge/route.ts"),
      "utf8",
    );
    const simulator = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    assert.match(novaRoute, /runNovaStep/);
    assert.match(forgeRoute, /runForgeStep/);
    assert.match(novaRoute, /maxDuration\s*=\s*60/);
    // Forge budget grew to 300 when the art gate joined the step
    // (2026-07-20), then 600 when artwork calls got a 240s ceiling
    // (2026-07-21) — two attempts + gates must fit.
    assert.match(forgeRoute, /maxDuration\s*=\s*600/);
    assert.match(simulator, /export async function runNovaStep/);
    assert.match(simulator, /export async function runForgeStep/);
    assert.match(simulator, /from ["']@\/lib\/ajax\/nova/);
    assert.match(simulator, /from ["']@\/lib\/ajax\/forge/);
    assert.doesNotMatch(simulator, /from ["']@\/lib\/llm/);
  });

  it("run-cycle does not run Nova and Forge in one blocking handler", () => {
    const route = readFileSync(
      join(ROOT, "src/app/api/ajax/run-cycle/route.ts"),
      "utf8",
    );
    const simulator = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    assert.doesNotMatch(route, /runAjaxCycle|runNovaStep|runForgeStep/);
    assert.match(route, /STAGED_PIPELINE_REQUIRED|run-nova/);
    assert.match(route, /status:\s*400/);
    assert.doesNotMatch(simulator, /runAjaxCycle/);
    assert.doesNotMatch(simulator, /executeAjaxCycle/);
  });

  it("nova step persists ideas; forge step creates listing and review", () => {
    const simulator = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    const novaBlock = simulator.slice(
      simulator.indexOf("async function executeNovaStep"),
      simulator.indexOf("async function executeForgeStep"),
    );
    const forgeBlock = simulator.slice(
      simulator.indexOf("async function executeForgeStep"),
      simulator.indexOf("export type ResetDemoSummary"),
    );
    assert.match(novaBlock, /runNovaIdeation/);
    assert.match(novaBlock, /TABLES\.IDEAS/);
    assert.doesNotMatch(novaBlock, /TABLES\.LISTINGS/);
    assert.doesNotMatch(novaBlock, /TABLES\.REVIEW_QUEUE/);
    assert.match(forgeBlock, /runForgeGeneration/);
    assert.match(forgeBlock, /TABLES\.LISTINGS/);
    assert.match(forgeBlock, /TABLES\.REVIEW_QUEUE/);
    assert.match(forgeBlock, /TABLES\.GENERATIONS/);
    assert.match(forgeBlock, /cycle_paused/);
  });

  it("approve creates an Etsy draft + Pixel in the background (no Lemon Squeezy)", () => {
    const content = readFileSync(
      join(ROOT, "src/lib/review/service.ts"),
      "utf8",
    );
    assert.match(content, /status:\s*"approved"/);
    // POD: the Lemon Squeezy / gumroad auto-publish on approve was removed.
    assert.doesNotMatch(content, /publishListingToGumroadOnApprove/);
    // Heavy work runs after the response via runPostApproval (Printify→Etsy + Pixel).
    assert.match(content, /runPostApproval/);
    assert.match(content, /publishListingViaPrintify/);
    assert.match(content, /runPixelMarketing/);
    assert.doesNotMatch(content, /etsyAdapter|publishListingWithGumroad/i);
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

  it("simulator queues POD fulfillment async without bypassing review gate", () => {
    const simulator = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    assert.doesNotMatch(simulator, /generateAndStoreProductPdf/);
    assert.match(simulator, /pod_fulfillment_queued/);
    assert.match(simulator, /schedulePodFulfillmentAfterForge/);
    assert.match(simulator, /generationStatus:\s*"queued"/);
    assert.match(simulator, /cycle_paused/);
    assert.match(simulator, /pending_review/);
    assert.doesNotMatch(simulator, /runPixel|pixel-simulator/i);
  });

  it("PDF generation pipeline is fully retired", () => {
    assert.throws(() =>
      readFileSync(
        join(
          ROOT,
          "src/app/api/ajax/product-generations/[id]/generate-pdf/route.ts",
        ),
        "utf8",
      ),
    );
    assert.throws(() =>
      readFileSync(
        join(ROOT, "src/lib/product/generation-pdf-runner.ts"),
        "utf8",
      ),
    );
    assert.throws(() =>
      readFileSync(join(ROOT, "src/lib/product/pdf-service.ts"), "utf8"),
    );
  });

  it("review asset panel is POD-first with no manual PDF generation", () => {
    const panel = readFileSync(
      join(ROOT, "src/components/review/review-pdf-panel.tsx"),
      "utf8",
    );
    assert.match(panel, /Product assets/);
    assert.match(panel, /Printify product draft are created automatically/);
    assert.doesNotMatch(panel, /Generate PDF/);
    assert.doesNotMatch(panel, /buildProductPdfGenerateHref/);
    assert.doesNotMatch(panel, /createServiceClient/);
  });

  it("approve review enforces POD and sellability guards", () => {
    const service = readFileSync(
      join(ROOT, "src/lib/review/service.ts"),
      "utf8",
    );
    const guards = readFileSync(
      join(ROOT, "src/lib/review/approval-guards.ts"),
      "utf8",
    );
    assert.match(service, /assertPodReadyForApproval/);
    assert.match(service, /assertSellabilityForApproval/);
    assert.match(guards, /isDemoReviewBypass/);
    assert.match(guards, /raw\.simulated === true/);
  });

  it("staged steps recovery idles agents on failure", () => {
    const simulator = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    assert.match(simulator, /recoverFromCycleFailure/);
    assert.match(simulator, /cycle_failed/);
    assert.match(simulator, /status:\s*"idle"/);
    assert.match(simulator, /runNovaStep[\s\S]*recoverFromCycleFailure/);
    assert.match(simulator, /runForgeStep[\s\S]*recoverFromCycleFailure/);
  });

  it("forge step can reuse ideas from a prior nova run", () => {
    const simulator = readFileSync(
      join(ROOT, "src/lib/ajax/simulator.ts"),
      "utf8",
    );
    assert.match(simulator, /resolveRunIdeasForForge/);
    assert.match(simulator, /pickForgeIdeaCandidate/);
    assert.match(simulator, /No Forge-ready ideas found/);
  });

  it("factory dashboard runs staged nova then forge", () => {
    const dashboard = readFileSync(
      join(ROOT, "src/components/factory/factory-dashboard.tsx"),
      "utf8",
    );
    const controls = readFileSync(
      join(ROOT, "src/components/factory/control-panel.tsx"),
      "utf8",
    );
    assert.match(dashboard, /\/api\/ajax\/run-nova/);
    assert.match(dashboard, /\/api\/ajax\/run-forge/);
    assert.match(dashboard, /cyclePhase/);
    assert.match(controls, /Running Nova|cyclePhase === "nova"/);
    assert.match(controls, /Running Forge|cyclePhase === "forge"/);
    assert.match(dashboard, /Review Gate/);
    assert.doesNotMatch(dashboard, /\/api\/ajax\/run-cycle/);
    assert.match(dashboard, /data\.error|novaData\.error|forgeData\.error/);
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
