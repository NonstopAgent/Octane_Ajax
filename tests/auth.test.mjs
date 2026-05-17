import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("auth wiring", () => {
  it("has middleware for session refresh", () => {
    assert.ok(existsSync(join(ROOT, "src/middleware.ts")));
    const content = readFileSync(join(ROOT, "src/middleware.ts"), "utf8");
    assert.match(content, /updateSession/);
    assert.match(content, /\/login/);
  });

  it("protects command routes", () => {
    const routes = readFileSync(join(ROOT, "src/lib/auth/routes.ts"), "utf8");
    for (const path of [
      "/dashboard",
      "/factory",
      "/review",
      "/agents",
      "/settings",
    ]) {
      assert.match(routes, new RegExp(`"${path}"`));
    }
  });

  it("has login page and auth callback", () => {
    assert.ok(existsSync(join(ROOT, "src/app/login/page.tsx")));
    assert.ok(existsSync(join(ROOT, "src/app/auth/callback/route.ts")));
  });
});
