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
  /from ["']@\/lib\/product\/pdf-storage/,
  /from ["']@\/lib\/product\/pdf-service/,
  /from ["']@\/lib\/ajax\/adapters/,
  /createDemoEtsyAdapter/,
  /etsyAdapter/,
  /ETSY_CLIENT_SECRET/,
  /ETSY_CLIENT_ID/,
  /PRINTIFY_API_TOKEN/,
  /TIKTOK_CLIENT_SECRET/,
  /IMAGE_GENERATOR_API_KEY/,
  /STRIPE_SECRET/,
  /STRIPE_PUBLISHABLE/,
  /STRIPE_WEBHOOK/,
  /process\.env\.STRIPE/,
  /from ["']stripe/,
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

  it("scopes product_pdfs storage to authenticated owners (milestone 2)", () => {
    const migration = readMigration(
      "20260518120000_product_pdfs_storage.sql",
    );
    assert.match(migration, /product_pdfs/i);
    assert.match(migration, /allowed_mime_types/i);
    assert.match(migration, /10485760/);
    assert.match(migration, /product_pdfs_select_own/i);
    assert.match(
      migration,
      /storage\.foldername\(name\)\)\[1\].*auth\.uid\(\)/i,
    );
    assert.doesNotMatch(migration, /public\s*=\s*true/i);
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

describe("supabase browser barrel", () => {
  it("does not export service role client from client entrypoints", () => {
    const client = readFileSync(join(ROOT, "lib/supabase/client.ts"), "utf8");
    const index = readFileSync(join(ROOT, "lib/supabase/index.ts"), "utf8");

    assert.doesNotMatch(client, /createServiceClient/);
    assert.doesNotMatch(client, /SERVICE_ROLE/);
    assert.doesNotMatch(index, /createServiceClient/);
    assert.match(index, /createBrowserClient|createClient/);
  });
});

describe("marketplace adapters stay server-side", () => {
  it("does not import Etsy adapter from run-pixel or pixel simulator", () => {
    const pixel = readFileSync(
      join(ROOT, "lib/ajax/pixel-simulator.ts"),
      "utf8",
    );
    const runPixel = readFileSync(
      join(ROOT, "app/api/ajax/run-pixel/route.ts"),
      "utf8",
    );

    for (const pattern of [
      /from ["']@\/lib\/ajax\/adapters/,
      /createDemoEtsyAdapter/,
      /etsyAdapter/,
    ]) {
      assert.doesNotMatch(pixel, pattern);
      assert.doesNotMatch(runPixel, pattern);
    }
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

    assert.match(simulator, /from ["']@\/lib\/ajax\/nova/);
    assert.match(simulator, /from ["']@\/lib\/ajax\/forge/);
    assert.match(simulator, /from ["']@\/lib\/product\/pdf-service/);
    assert.doesNotMatch(simulator, /from ["']@\/lib\/product\/pdf-generator/);
    assert.match(simulator, /review_gate|cycle_paused/i);
    assert.match(simulator, /pdf_generation_failed/);
  });
});
