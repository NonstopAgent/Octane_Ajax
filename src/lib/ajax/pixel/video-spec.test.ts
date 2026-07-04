import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVideoSpec } from "@/lib/ajax/pixel/video-spec";
import { VIDEO_PLAYBOOK } from "@/lib/ajax/pixel/video-playbook";

describe("buildVideoSpec", () => {
  it("produces a 9:16 spec within the playbook duration bounds", () => {
    const spec = buildVideoSpec({
      productTitle: "Personalized Rescue Dog Mom Gotcha Day Mug",
      niche: "rescue dog mom gotcha day gift",
      format: "mug",
      mockupCount: 3,
      hashtags: ["#DogMom", "#GotchaDay", "#EtsyFinds"],
    });
    assert.equal(spec.aspectRatio, "9:16");
    assert.ok(spec.durationSec >= VIDEO_PLAYBOOK.format.minDurationSec);
    assert.ok(spec.durationSec <= VIDEO_PLAYBOOK.format.maxDurationSec);
    assert.equal(spec.renderStatus, "spec_only");
  });

  it("opens on a hook and ends on a CTA, every beat within the max", () => {
    const spec = buildVideoSpec({
      productTitle: "Cat Dad Coffee Mug",
      niche: "cat dad gift",
      format: "mug",
      mockupCount: 4,
    });
    assert.equal(spec.shots[0]?.role, "hook");
    assert.equal(spec.shots.at(-1)?.role, "cta");
    assert.ok(spec.hookVariants.length >= 1);
    for (const shot of spec.shots) {
      assert.ok(shot.durationSec <= VIDEO_PLAYBOOK.format.beatMaxSec);
      assert.ok(shot.onScreenText.length > 0);
    }
  });

  it("detects a gotcha-day occasion and puts it in the CTA", () => {
    const spec = buildVideoSpec({
      productTitle: "Gotcha Day Dog Ornament",
      niche: "adoption anniversary gift",
      format: "art_print",
      mockupCount: 3,
    });
    assert.match(spec.cta, /gotcha day/i);
  });

  it("picks warm audio energy for emotional (memorial) niches", () => {
    const memorial = buildVideoSpec({
      productTitle: "Pet Memorial Rainbow Bridge Print",
      niche: "pet loss memorial gift",
      format: "art_print",
      mockupCount: 3,
    });
    assert.equal(memorial.audio.energy, "warm");
  });

  it("carries the hashtag list through, capped at the playbook max", () => {
    const many = Array.from({ length: 20 }, (_, i) => `#tag${i}`);
    const spec = buildVideoSpec({
      productTitle: "Dog Lover Tote",
      niche: "dog lover gift",
      mockupCount: 2,
      hashtags: many,
    });
    assert.ok(spec.hashtags.length <= VIDEO_PLAYBOOK.hashtags.total.max);
  });

  it("still builds a valid spec with no mockups (text-only sources)", () => {
    const spec = buildVideoSpec({
      productTitle: "Dog Mom Sticker",
      niche: "dog mom gift",
      mockupCount: 0,
    });
    assert.ok(spec.shots.every((s) => s.source.kind === "text"));
    assert.equal(spec.aspectRatio, "9:16");
  });
});
