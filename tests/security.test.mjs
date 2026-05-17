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
  /OPENAI_API_KEY/,
  /process\.env\.OPENAI_API_KEY/,
  /getOpenAiApiKey/,
  /createOpenAiClient/,
  /from ["']@\/lib\/llm/,
  /from ["']@\/lib\/product\/pdf-generator/,
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

function readMigration(filename) {
  return readFileSync(
    join(fileURLToPath(new URL("..", import.meta.url)), "supabase/migrations", filename),
    "utf8",
  );
}

function assertRlsEnabled(migration, table) {
  assert.match(
    migration,
    new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    `RLS must be enabled on ${table}`,
  );
}

describe("migrations RLS", () => {
  it("enables RLS on all pipeline tables (init migration)", () => {
    const migration = readMigration(
      "20260516120000_init_octane_ajax_schema.sql",
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
      assertRlsEnabled(migration, table);
    }
    assert.doesNotMatch(
      migration,
      /disable row level security/i,
      "RLS must not be disabled in init migration",
    );
  });

  it("enables RLS on product_generations (phase 2 migration)", () => {
    const migration = readMigration(
      "20260517140000_phase2_product_generation.sql",
    );
    assertRlsEnabled(migration, "product_generations");
    assert.doesNotMatch(
      migration,
      /disable row level security/i,
      "RLS must not be disabled in phase 2 migration",
    );
    assert.match(
      migration,
      /create policy "product_generations_select_own"/i,
      "product_generations must have owner-scoped select policy",
    );
  });
});

describe("run-cycle LLM wiring guard", () => {
  it("does not import the LLM layer in the demo run-cycle route", () => {
    const route = readFileSync(
      join(ROOT, "app/api/ajax/run-cycle/route.ts"),
      "utf8",
    );
    const simulator = readFileSync(
      join(ROOT, "lib/ajax/simulator.ts"),
      "utf8",
    );

    for (const pattern of [/from ["']@\/lib\/llm/, /completeJson/, /OPENAI_API_KEY/]) {
      assert.doesNotMatch(route, pattern, `run-cycle route must not match ${pattern}`);
      assert.doesNotMatch(simulator, pattern, `simulator must not match ${pattern}`);
    }
  });
});
