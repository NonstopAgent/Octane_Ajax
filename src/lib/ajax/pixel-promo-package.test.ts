import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContentJobScheduleUpdate,
  buildPixelPromoPackage,
  CONTENT_JOBS_HAS_METADATA_COLUMN,
} from "@/lib/ajax/pixel-promo-package";
import type { ProductStructure } from "@/lib/product/domain";

const structure: ProductStructure = {
  format: "planner",
  pageCount: 8,
  pages: [
    { pageNumber: 1, title: "Cover", purpose: "Cover", sections: [] },
    { pageNumber: 2, title: "How to use", purpose: "Intro", sections: [] },
    { pageNumber: 3, title: "Weekly grid", purpose: "Worksheet", sections: [] },
    { pageNumber: 4, title: "Checklist", purpose: "Worksheet", sections: [] },
    { pageNumber: 5, title: "Notes", purpose: "Worksheet", sections: [] },
    { pageNumber: 6, title: "Summary", purpose: "Summary", sections: [] },
    { pageNumber: 7, title: "Extra", purpose: "Worksheet", sections: [] },
    { pageNumber: 8, title: "Close", purpose: "Summary", sections: [] },
  ],
};

describe("buildPixelPromoPackage", () => {
  it("builds captions, platform copy, hooks, and hashtags from listing context", () => {
    const promo = buildPixelPromoPackage({
      jobId: "job-1",
      listingTitle: "Night-Shift Nurse Meal Prep Planner",
      listingDescription: "Printable weekly meal prep for 12-hour shifts.",
      niche: "night shift nurses",
      seoKeywords: ["meal prep", "nurse planner"],
      structure,
    });

    assert.match(promo.caption, /Night-Shift Nurse Meal Prep Planner/);
    assert.match(promo.metadata.longCaption, /What's inside:/);
    assert.ok(promo.metadata.tiktokHookIdeas.length >= 3);
    assert.ok(promo.metadata.hashtags.some((t) => t === "#GotchaDayGoods"));
    assert.match(promo.assetUrl, /demo:\/\/octane-ajax\/promo\/job-1/);
    assert.ok(Date.parse(promo.scheduledFor) > Date.now());
    assert.equal(promo.metadata.source.pageCount, 8);
    assert.ok(promo.metadata.source.pageTitles.includes("Weekly grid"));
  });

  it("schedules content job updates with metadata when column exists", () => {
    assert.equal(CONTENT_JOBS_HAS_METADATA_COLUMN, true);
    const promo = buildPixelPromoPackage({
      jobId: "job-2",
      listingTitle: "Demo Product",
    });
    const update = buildContentJobScheduleUpdate(promo);
    assert.equal(update.status, "scheduled");
    assert.equal(update.caption, promo.caption);
    assert.equal(update.asset_url, promo.assetUrl);
    assert.equal(update.scheduled_for, promo.scheduledFor);
    assert.deepEqual(update.metadata, promo.metadata);
  });
});
