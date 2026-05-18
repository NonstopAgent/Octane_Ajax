import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PIXEL = join(ROOT, "src/lib/ajax/pixel-simulator.ts");
const PROMO = join(ROOT, "src/lib/ajax/pixel-promo-package.ts");
const SERVICE = join(ROOT, "src/lib/ajax/pixel/service.ts");
const MARKETING_PAGE = join(ROOT, "src/app/(command)/marketing/page.tsx");
const RUN_PIXEL = join(ROOT, "src/app/api/ajax/run-pixel/route.ts");
const NAV = join(ROOT, "src/lib/constants.ts");

describe("pixel marketing wiring", () => {
  const pixel = readFileSync(PIXEL, "utf8");
  const promo = readFileSync(PROMO, "utf8");
  const service = readFileSync(SERVICE, "utf8");
  const route = readFileSync(RUN_PIXEL, "utf8");
  const marketingPage = readFileSync(MARKETING_PAGE, "utf8");
  const nav = readFileSync(NAV, "utf8");

  it("uses generatePixelMarketing with deterministic fallback", () => {
    assert.match(pixel, /generatePixelMarketing/);
    assert.match(pixel, /buildPixelPromoPackage/);
    assert.match(pixel, /buildContentJobScheduleUpdate/);
    assert.match(promo, /PixelPromoMetadata/);
    assert.match(promo, /tiktokHookIdeas/);
    assert.match(promo, /pinterestTitle/);
    assert.match(service, /completeJson/);
    assert.match(service, /isOpenAiConfigured/);
    assert.match(service, /PIXEL_MARKETING_SYSTEM_PROMPT/);
    assert.match(promo, /CONTENT_JOBS_HAS_METADATA_COLUMN\s*=\s*true/);
  });

  it("logs marketing metadata on content_scheduled factory events", () => {
    assert.match(pixel, /event_type:\s*"content_scheduled"/);
    assert.match(pixel, /marketing:\s*promo\.metadata/);
    assert.match(pixel, /scheduledFor:\s*promo\.scheduledFor/);
    assert.match(pixel, /assetUrl:\s*promo\.assetUrl/);
  });

  it("publishes listings after scheduling (demo storefront only)", () => {
    assert.match(pixel, /status:\s*"published"/);
    assert.match(pixel, /demo storefront/i);
    assert.doesNotMatch(pixel, /etsyAdapter|createDemoEtsyAdapter/);
  });

  it("exposes run-pixel API with session-scoped Supabase client", () => {
    assert.match(route, /runPixelMarketing/);
    assert.match(route, /createClient/);
    assert.doesNotMatch(route, /createServiceClient/);
    assert.doesNotMatch(route, /OPENAI_API_KEY/);
  });

  it("marketing page is server-only and does not import LLM", () => {
    assert.doesNotMatch(marketingPage, /["']use client["']/);
    assert.doesNotMatch(marketingPage, /@\/lib\/llm/);
    assert.doesNotMatch(marketingPage, /generatePixelMarketing/);
    assert.match(marketingPage, /fetchMarketingContentJobs/);
  });

  it("adds Marketing to navigation", () => {
    assert.match(nav, /href:\s*"\/marketing"/);
    assert.match(nav, /label:\s*"Marketing"/);
  });
});
