import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProtectedPath, safeNextPath } from "@/lib/auth/routes";

describe("safeNextPath", () => {
  it("keeps a legitimate protected path", () => {
    assert.equal(safeNextPath("/factory"), "/factory");
    assert.equal(safeNextPath("/review/abc-123"), "/review/abc-123");
    assert.equal(safeNextPath("/settings?tab=etsy"), "/settings?tab=etsy");
    assert.equal(safeNextPath("/factory#bay-2"), "/factory#bay-2");
  });

  it("rejects the userinfo trick that made this a real open redirect", () => {
    // `new URL("@evil.com", "https://octane-ajax.vercel.app")` and the old
    // `${origin}${next}` concatenation both resolve to host evil.com.
    assert.equal(safeNextPath("@evil.com"), "/factory");
    assert.equal(
      new URL(safeNextPath("@evil.com"), "https://octane-ajax.vercel.app")
        .hostname,
      "octane-ajax.vercel.app",
    );
  });

  it("rejects absolute and protocol-relative destinations", () => {
    for (const raw of [
      "https://evil.com",
      "http://evil.com",
      "//evil.com",
      "///evil.com",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "\\\\evil.com",
      "/\\evil.com",
    ]) {
      assert.equal(safeNextPath(raw), "/factory", `allowed ${raw}`);
    }
  });

  it("never resolves to an off-origin host for any candidate", () => {
    const origin = "https://octane-ajax.vercel.app";
    for (const raw of [
      "@evil.com",
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/factory",
      null,
      "",
      "   ",
    ]) {
      assert.equal(
        new URL(safeNextPath(raw), origin).hostname,
        "octane-ajax.vercel.app",
        `escaped origin via ${JSON.stringify(raw)}`,
      );
    }
  });

  it("falls back for unknown internal paths", () => {
    assert.equal(safeNextPath("/"), "/factory");
    assert.equal(safeNextPath("/api/cron/shop-autopilot"), "/factory");
    assert.equal(safeNextPath("/factory-evil"), "/factory");
  });

  it("falls back for missing input, and honours a custom fallback", () => {
    assert.equal(safeNextPath(null), "/factory");
    assert.equal(safeNextPath(undefined), "/factory");
    assert.equal(safeNextPath(""), "/factory");
    assert.equal(safeNextPath("https://evil.com", "/dashboard"), "/dashboard");
  });

  it("only ever returns a path the app actually protects", () => {
    for (const raw of ["/factory", "@evil.com", "/nope", null]) {
      assert.ok(isProtectedPath(safeNextPath(raw).split(/[?#]/)[0]));
    }
  });
});
