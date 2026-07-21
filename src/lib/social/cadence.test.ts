import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  capFor,
  duePlatforms,
  isWithinPostingWindow,
  localHour,
  platformCaps,
  postingWindow,
} from "@/lib/social/cadence";
import type { SocialPlatform } from "@/lib/social/ayrshare";

const ALL: SocialPlatform[] = ["pinterest", "instagram", "tiktok"];

describe("posting cadence (5-7/day, platform-aware)", () => {
  afterEach(() => {
    delete process.env.SOCIAL_PLATFORM_CAPS;
  });

  it("defaults: pinterest 6/day, tiktok 3/day, feed platforms 2/day", () => {
    assert.equal(capFor("pinterest"), 6);
    assert.equal(capFor("instagram"), 2);
    // 2026-07-19 rebaseline: TikTok carried all measured engagement.
    assert.equal(capFor("tiktok"), 3);
    assert.equal(capFor("facebook"), 2);
  });

  it("honors SOCIAL_PLATFORM_CAPS overrides", () => {
    process.env.SOCIAL_PLATFORM_CAPS = "pinterest:8, instagram:1";
    assert.equal(platformCaps().pinterest, 8);
    assert.equal(capFor("instagram"), 1);
    assert.equal(capFor("tiktok"), 3); // untouched default
  });

  it("posts everywhere on the first passes of the day", () => {
    assert.deepEqual(duePlatforms({}, ALL), ALL);
  });

  it("drops feed platforms at their caps, keeps pinterest until 6", () => {
    const counts = { pinterest: 2, instagram: 2, tiktok: 3 };
    assert.deepEqual(duePlatforms(counts, ALL), ["pinterest"]);
    assert.deepEqual(
      duePlatforms({ pinterest: 6, instagram: 2, tiktok: 3 }, ALL),
      [],
    );
    // tiktok keeps its third daily slot after the feed platforms cap out.
    assert.deepEqual(
      duePlatforms({ pinterest: 6, instagram: 2, tiktok: 2 }, ALL),
      ["tiktok"],
    );
  });

  it("counts are case-insensitive", () => {
    assert.deepEqual(duePlatforms({ PINTEREST: 6 } as never, ALL).length, 3);
    assert.deepEqual(duePlatforms({ pinterest: 6 }, ALL), [
      "instagram",
      "tiktok",
    ]);
  });
});

describe("posting window (US engagement hours)", () => {
  afterEach(() => {
    delete process.env.SOCIAL_POSTING_WINDOW;
    delete process.env.SOCIAL_POSTING_TZ;
  });

  it("defaults to 8-22 local", () => {
    assert.deepEqual(postingWindow(), { startHour: 8, endHour: 22 });
  });

  it("honors SOCIAL_POSTING_WINDOW override and rejects garbage", () => {
    process.env.SOCIAL_POSTING_WINDOW = "9-21";
    assert.deepEqual(postingWindow(), { startHour: 9, endHour: 21 });
    process.env.SOCIAL_POSTING_WINDOW = "banana";
    assert.deepEqual(postingWindow(), { startHour: 8, endHour: 22 });
  });

  it("converts UTC instants to Chicago local hours (DST-aware)", () => {
    // July = CDT (UTC-5): 07:00Z is 2 AM in Chicago — the exact dead-air
    // hour the operator flagged. January = CST (UTC-6).
    assert.equal(localHour(new Date("2026-07-20T07:00:00Z"), "America/Chicago"), 2);
    assert.equal(localHour(new Date("2026-07-20T18:00:00Z"), "America/Chicago"), 13);
    assert.equal(localHour(new Date("2026-01-20T07:00:00Z"), "America/Chicago"), 1);
  });

  it("falls back to UTC on a bad timezone string", () => {
    assert.equal(localHour(new Date("2026-07-20T07:30:00Z"), "Not/AZone"), 7);
  });

  it("blocks the 2-3 AM Central posts and allows daytime", () => {
    // 07:00Z / 08:00Z July = 2-3 AM CDT — the "weird schedule" posts.
    assert.equal(isWithinPostingWindow(new Date("2026-07-20T07:00:00Z")), false);
    assert.equal(isWithinPostingWindow(new Date("2026-07-20T08:05:00Z")), false);
    // 18:00Z = 1 PM CDT, prime time.
    assert.equal(isWithinPostingWindow(new Date("2026-07-20T18:00:00Z")), true);
    // 02:30Z = 9:30 PM CDT — still inside the evening window.
    assert.equal(isWithinPostingWindow(new Date("2026-07-20T02:30:00Z")), true);
    // 03:30Z = 10:30 PM CDT — past close.
    assert.equal(isWithinPostingWindow(new Date("2026-07-20T03:30:00Z")), false);
  });

  it("supports windows that wrap midnight local time", () => {
    process.env.SOCIAL_POSTING_TZ = "UTC";
    process.env.SOCIAL_POSTING_WINDOW = "20-4";
    assert.equal(isWithinPostingWindow(new Date("2026-07-20T22:00:00Z")), true);
    assert.equal(isWithinPostingWindow(new Date("2026-07-20T02:00:00Z")), true);
    assert.equal(isWithinPostingWindow(new Date("2026-07-20T12:00:00Z")), false);
  });
});
