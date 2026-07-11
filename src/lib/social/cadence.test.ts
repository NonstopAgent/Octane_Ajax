import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { capFor, duePlatforms, platformCaps } from "@/lib/social/cadence";
import type { SocialPlatform } from "@/lib/social/ayrshare";

const ALL: SocialPlatform[] = ["pinterest", "instagram", "tiktok"];

describe("posting cadence (5-7/day, platform-aware)", () => {
  afterEach(() => {
    delete process.env.SOCIAL_PLATFORM_CAPS;
  });

  it("defaults: pinterest 6/day, feed platforms 2/day", () => {
    assert.equal(capFor("pinterest"), 6);
    assert.equal(capFor("instagram"), 2);
    assert.equal(capFor("tiktok"), 2);
    assert.equal(capFor("facebook"), 2);
  });

  it("honors SOCIAL_PLATFORM_CAPS overrides", () => {
    process.env.SOCIAL_PLATFORM_CAPS = "pinterest:8, instagram:1";
    assert.equal(platformCaps().pinterest, 8);
    assert.equal(capFor("instagram"), 1);
    assert.equal(capFor("tiktok"), 2); // untouched default
  });

  it("posts everywhere on the first passes of the day", () => {
    assert.deepEqual(duePlatforms({}, ALL), ALL);
  });

  it("drops feed platforms at 2, keeps pinterest until 6", () => {
    const counts = { pinterest: 2, instagram: 2, tiktok: 2 };
    assert.deepEqual(duePlatforms(counts, ALL), ["pinterest"]);
    assert.deepEqual(
      duePlatforms({ pinterest: 6, instagram: 2, tiktok: 2 }, ALL),
      [],
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
