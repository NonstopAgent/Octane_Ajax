import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)), "src");

const CLIENT_ROOTS = [
  join(ROOT, "components"),
  join(ROOT, "hooks"),
  join(ROOT, "app"),
];

const FORBIDDEN_IN_CLIENT = [
  /SUPABASE_SERVICE_ROLE_KEY/,
  /createServiceClient/,
  /ETSY_CLIENT_SECRET/,
  /PRINTIFY_API_TOKEN/,
  /TIKTOK_CLIENT_SECRET/,
  /IMAGE_GENERATOR_API_KEY/,
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, files);
    } else if (/\.(tsx|ts)$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

function isClientComponentFile(path, content) {
  return content.includes('"use client"') || content.includes("'use client'");
}

describe("client secret exposure", () => {
  const clientFiles = CLIENT_ROOTS.flatMap((root) => {
    try {
      return walk(root)
        .map((file) => ({ file, content: readFileSync(file, "utf8") }))
        .filter(({ file, content }) => isClientComponentFile(file, content));
    } catch {
      return [];
    }
  });

  it("scans use client modules", () => {
    assert.ok(clientFiles.length > 0, "expected client components under src/");
  });

  for (const { file, content } of clientFiles) {
    it(`does not expose server secrets in ${file.replace(ROOT, "src")}`, () => {
      for (const pattern of FORBIDDEN_IN_CLIENT) {
        const match = content.match(pattern);
        if (match) {
          assert.fail(
            `Forbidden pattern ${pattern} in ${file}: ${match[0]}`,
          );
        }
      }
    });
  }
});

describe("migrations RLS", () => {
  it("enables RLS on all pipeline tables", () => {
    const migration = readFileSync(
      join(
        fileURLToPath(new URL("..", import.meta.url)),
        "supabase/migrations/20260516120000_init_octane_ajax_schema.sql",
      ),
      "utf8",
    );
    const tables = [
      "ajax_agents",
      "ajax_tasks",
      "product_ideas",
      "product_listings",
      "review_queue",
      "agent_feedback",
      "factory_events",
      "content_jobs",
    ];
    for (const table of tables) {
      assert.match(
        migration,
        new RegExp(`alter table public\\.${table} enable row level security`, "i"),
        `RLS must be enabled on ${table}`,
      );
    }
    assert.doesNotMatch(
      migration,
      /disable row level security/i,
      "RLS must not be disabled in migrations",
    );
  });
});
