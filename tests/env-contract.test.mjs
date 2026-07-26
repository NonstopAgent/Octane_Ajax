/**
 * Drift guards for the two things that quietly rot: the env contract and the
 * migration history.
 *
 * 2026-07-25 audit, M9 + M7. Both findings were of the same shape — the code
 * and the files that are supposed to describe the code had silently diverged,
 * and nothing failed. A one-time sweep fixes the symptom; these tests fix the
 * class. If you add `process.env.NEW_FLAG` or a new table, the suite tells you
 * to write it down.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

function envVarsReadInCode() {
  const found = new Set();
  for (const file of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts"))]) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      found.add(m[1]);
    }
    // Bracket access with a literal key: process.env["FOO"]
    for (const m of src.matchAll(/process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

function envVarsDocumented() {
  const documented = new Set();
  const text = readFileSync(join(ROOT, ".env.example"), "utf8");
  for (const line of text.split("\n")) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m) documented.add(m[1]);
  }
  return documented;
}

/**
 * Vars intentionally absent from .env.example.
 *   NODE_ENV — set by Next/Vercel, never by the operator.
 * Anything else added here needs a reason in this comment.
 */
const EXEMPT = new Set(["NODE_ENV"]);

describe("env contract (.env.example)", () => {
  it("documents every env var the code reads", () => {
    const read = envVarsReadInCode();
    const documented = envVarsDocumented();
    const missing = [...read].filter(
      (name) => !documented.has(name) && !EXEMPT.has(name),
    );
    assert.deepEqual(
      missing.sort(),
      [],
      `Undocumented env vars — add them to .env.example with a one-line comment and the code's default:\n  ${missing.sort().join("\n  ")}`,
    );
  });

  it("documents the operator's kill switches specifically", () => {
    // These are the ones whose absence from the file actually hurt: you cannot
    // stop the machine with a flag you can't find.
    const documented = envVarsDocumented();
    for (const name of [
      "AUTOPILOT_DISABLED",
      "AUTOPILOT_LISTING_FREEZE_UNTIL",
      "AUTOPILOT_AUTONOMOUS_REVIEW",
      "AI_REVIEWER_AUTONOMOUS",
      "CRON_SECRET",
      "OPERATOR_EMAIL",
    ]) {
      assert.ok(documented.has(name), `${name} is not in .env.example`);
    }
  });

  it("has no stale entries that nothing reads", () => {
    const read = envVarsReadInCode();
    const documented = envVarsDocumented();
    // Task-routed vars are read as `process.env[\`LLM_${TASK}_MODEL\`]`, so a
    // literal grep can't see them (lib/llm/providers.ts).
    const dynamic = /^LLM_[A-Z]+_(MODEL|PROVIDER)$/;
    const stale = [...documented].filter(
      (name) => !read.has(name) && !dynamic.test(name),
    );
    assert.deepEqual(
      stale.sort(),
      [],
      `Documented but never read — delete these from .env.example:\n  ${stale.sort().join("\n  ")}`,
    );
  });
});

describe("migration history covers the typed schema", () => {
  it("every table in database.types.ts is created by a migration", () => {
    const types = readFileSync(
      join(ROOT, "src/lib/supabase/database.types.ts"),
      "utf8",
    );
    // Tables live under `Tables: {` as `      <name>: {` with a Row/Insert body.
    const typed = new Set();
    for (const m of types.matchAll(/^ {6}([a-z][a-z0-9_]*): \{$/gm)) {
      typed.add(m[1]);
    }
    assert.ok(typed.size > 10, "table extraction from database.types.ts failed");

    const migrationDir = join(ROOT, "supabase/migrations");
    const sql = readdirSync(migrationDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(migrationDir, f), "utf8"))
      .join("\n");

    const missing = [...typed].filter(
      (table) =>
        !new RegExp(`create table (if not exists )?public\\.${table}\\b`, "i").test(
          sql,
        ),
    );
    assert.deepEqual(
      missing.sort(),
      [],
      `Live tables with no migration — their RLS posture is not in version control (audit M7):\n  ${missing.sort().join("\n  ")}`,
    );
  });

  it("every migrated table enables row level security", () => {
    const migrationDir = join(ROOT, "supabase/migrations");
    const files = readdirSync(migrationDir).filter((f) => f.endsWith(".sql"));
    const sql = files
      .map((f) => readFileSync(join(migrationDir, f), "utf8"))
      .join("\n");

    const created = new Set(
      [...sql.matchAll(/create table (?:if not exists )?public\.([a-z0-9_]+)/gi)].map(
        (m) => m[1].toLowerCase(),
      ),
    );
    const rlsEnabled = new Set(
      [
        ...sql.matchAll(
          /alter table public\.([a-z0-9_]+)\s+enable row level security/gi,
        ),
      ].map((m) => m[1].toLowerCase()),
    );

    const unprotected = [...created].filter((t) => !rlsEnabled.has(t));
    assert.deepEqual(
      unprotected.sort(),
      [],
      `Tables created without RLS (AGENTS.md §6: keep RLS enabled):\n  ${unprotected.sort().join("\n  ")}`,
    );
  });
});
