import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditListing,
  auditStore,
  type QaListingInput,
} from "@/lib/ajax/store-qa/audit";

const TAGS = [
  "rescue dog mom mug",
  "gotcha day gift",
  "adoption anniversary mug",
  "personalized dog gift",
  "dog mom coffee mug",
  "pet parent gift",
  "custom dog name mug",
  "dog lover present",
  "rescue pup mom",
  "dog adoption gift",
  "new puppy gift",
  "dog mom birthday",
  "pet memorial keepsake",
];

const clean: QaListingInput = {
  id: "L1",
  title: "Personalized Rescue Dog Mom Gotcha Day Mug",
  description:
    "A heartfelt personalized keepsake for the rescue dog mom celebrating her pup's gotcha day. Add their name, sip your morning coffee, and honor the adoption anniversary in style. Made to order and shipped fast.",
  price: 24,
  mockupUrl: "https://img.example.com/mock.jpg",
  status: "published",
  tags: TAGS,
};

describe("auditListing", () => {
  it("scores a complete, proven listing high with no criticals", () => {
    const a = auditListing(clean);
    assert.ok(a.score >= 85, `expected >=85, got ${a.score}`);
    assert.equal(a.issues.filter((i) => i.severity === "critical").length, 0);
  });

  it("flags missing title, price, and image as critical", () => {
    const a = auditListing({
      id: "L2",
      title: null,
      description: null,
      price: null,
      mockupUrl: null,
    });
    const codes = a.issues.map((i) => i.code);
    assert.ok(codes.includes("title_missing"));
    assert.ok(codes.includes("price_missing"));
    assert.ok(codes.includes("mockup_missing"));
    assert.ok(a.score <= 25);
  });

  it("flags a demo placeholder image as missing", () => {
    const a = auditListing({
      ...clean,
      id: "L3",
      mockupUrl: "demo://x/slideshow.mp4",
    });
    assert.ok(a.issues.some((i) => i.code === "mockup_missing"));
  });
});

describe("auditStore", () => {
  it("aggregates scores and flags duplicate titles", () => {
    const report = auditStore([
      clean,
      { ...clean, id: "L1b" },
      {
        id: "L4",
        title: null,
        description: null,
        price: null,
        mockupUrl: null,
      },
    ]);
    assert.equal(report.listingCount, 3);
    assert.ok(report.counts.critical >= 3);
    assert.ok(report.storeFlags.some((f) => f.code === "duplicate_titles"));
    assert.ok(report.topFixes.length > 0);
    assert.ok(report.overallScore < 100);
  });

  it("returns a clean report for an empty shop", () => {
    const report = auditStore([]);
    assert.equal(report.listingCount, 0);
    assert.equal(report.overallScore, 100);
  });
});
