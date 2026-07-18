import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  centeredPlacement,
  fitScale,
  PLACEMENT_MARGIN,
} from "./printify-placement";

describe("printify placement math", () => {
  it("shrinks square art on a mug wrap instead of full-width scale 1 (the July defect)", () => {
    // 11oz mug wrap ~2475x1050 → aspect 2.357. Square art must be
    // height-constrained: scale = margin / areaAspect ≈ 0.36, NOT 1.
    const scale = fitScale(1, 2475 / 1050);
    assert.ok(scale < 0.45, `scale ${scale} still overflows the wrap`);
    assert.ok(scale > 0.25, `scale ${scale} too small to read`);
    assert.equal(scale, Number(((PLACEMENT_MARGIN * 1050) / 2475).toFixed(4)));
  });

  it("goes full bleed when art aspect matches the print area (2:3 poster art)", () => {
    assert.equal(fitScale(2 / 3, 2 / 3), 1);
    // 1024x1536 art on a 20x30 poster
    assert.equal(fitScale(1024 / 1536, 20 / 30), 1);
  });

  it("width-constrains wide art on a tall poster", () => {
    // square art on 2:3 poster: width is the constraint → margin
    assert.equal(fitScale(1, 2 / 3), PLACEMENT_MARGIN);
  });

  it("centers and zeroes rotation", () => {
    const p = centeredPlacement(1, 2.36);
    assert.equal(p.x, 0.5);
    assert.equal(p.y, 0.5);
    assert.equal(p.angle, 0);
  });

  it("never exceeds scale 1 and survives garbage input", () => {
    assert.ok(fitScale(100, 0.01) <= 1);
    assert.equal(fitScale(NaN, 2), PLACEMENT_MARGIN);
    assert.equal(fitScale(1, 0), PLACEMENT_MARGIN);
  });
});
