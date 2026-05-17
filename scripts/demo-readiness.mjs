/**
 * Live Supabase demo readiness check (run: node scripts/demo-readiness.mjs)
 * Loads .env.local from project root. Does not print secrets.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env.local");

function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    return { ok: false, error: "Missing .env.local" };
  }
  const vars = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    vars[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  const url = vars.NEXT_PUBLIC_SUPABASE_URL;
  const anon = vars.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      ok: false,
      error: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY required",
    };
  }
  return { ok: true, url, anon };
}

const REQUIRED_TABLES = [
  "ajax_agents",
  "ajax_tasks",
  "product_ideas",
  "product_listings",
  "review_queue",
  "agent_feedback",
  "factory_events",
  "content_jobs",
];

function isMissingTableError(message) {
  return (
    message?.includes("does not exist") ||
    message?.includes("PGRST205")
  );
}

function loadServiceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (!existsSync(ENV_PATH)) return null;
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (t.startsWith("SUPABASE_SERVICE_ROLE_KEY=")) {
      return t.slice("SUPABASE_SERVICE_ROLE_KEY=".length).trim();
    }
  }
  return null;
}

async function verifyAgentsAndRls(env, session) {
  const authed = createClient(env.url, env.anon, {
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userId = session.user.id;

  const { data: agents, error: agentsErr } = await authed
    .from("ajax_agents")
    .select("slug")
    .in("slug", ["nova", "forge", "pixel"]);

  if (agentsErr) {
    console.error("FAIL: ajax_agents (authenticated) —", agentsErr.message);
    process.exit(1);
  }

  const slugs = new Set((agents ?? []).map((a) => a.slug));
  if (slugs.size < 3) {
    console.error(
      "FAIL: Seeded agents missing. Found:",
      [...slugs].join(", ") || "(none)",
    );
    console.error("      → Re-run init migration seed or supabase db push");
    process.exit(1);
  }
  console.log("OK  ajax_agents seeded (nova, forge, pixel)");

  const { error: eventErr } = await authed.from("factory_events").insert({
    user_id: userId,
    event_type: "readiness_check",
    message: "Demo readiness probe",
    metadata: { probe: true },
  });

  if (eventErr) {
    console.error("FAIL: RLS insert factory_events —", eventErr.message);
    process.exit(1);
  }
  console.log("OK  Authenticated RLS insert (factory_events)");

  await authed
    .from("factory_events")
    .delete()
    .eq("user_id", userId)
    .eq("event_type", "readiness_check");
}

async function verifyWithServiceRole(env) {
  const serviceKey = loadServiceRoleKey();
  if (!serviceKey) return false;

  const admin = createClient(env.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: agents, error: agentsErr } = await admin
    .from("ajax_agents")
    .select("slug")
    .in("slug", ["nova", "forge", "pixel"]);

  if (agentsErr || (agents ?? []).length < 3) {
    console.error("FAIL: service-role agent check —", agentsErr?.message);
    process.exit(1);
  }
  console.log("OK  ajax_agents seeded (verified with service role)");
  console.log(
    "WARN Auth API skipped — add operator via /login (signup rate limit or no session).",
  );
  return true;
}

async function main() {
  const env = loadEnv();
  if (!env.ok) {
    console.error("FAIL:", env.error);
    process.exit(1);
  }

  console.log("OK  .env.local present with required public Supabase vars");

  const supabase = createClient(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Table existence (anon may return 0 rows under RLS — only fail if table is missing)
  for (const table of REQUIRED_TABLES) {
    const { error } = await supabase
      .from(table)
      .select("*", { head: true, count: "exact" });

    if (error && isMissingTableError(error.message)) {
      console.error(`FAIL: table "${table}" missing —`, error.message);
      console.error("      → Run: supabase link && supabase db push");
      process.exit(1);
    }
    if (error && !isMissingTableError(error.message)) {
      console.error(`FAIL: table "${table}" —`, error.message);
      process.exit(1);
    }
  }
  console.log("OK  All pipeline tables exist in API schema");

  // Auth smoke: reuse a stable test operator (avoids signup rate limits)
  const testEmail =
    process.env.DEMO_READINESS_EMAIL ?? "octane.readiness@example.com";
  const testPassword = process.env.DEMO_READINESS_PASSWORD ?? "OctaneDemo123!";

  let session = null;

  const { data: signIn, error: signInErr } =
    await supabase.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

  if (!signInErr && signIn.session) {
    session = signIn.session;
  } else {
    const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
      email: testEmail,
      password: testPassword,
    });

    if (signUpErr) {
      const rateLimited = signUpErr.message.includes("rate limit");
      if (rateLimited && (await verifyWithServiceRole(env))) {
        console.log("\nSchema + seed OK. Complete auth manually at /login.");
        return;
      }
      console.error("FAIL: auth —", signUpErr.message);
      if (signInErr) console.error("      signIn:", signInErr.message);
      if (rateLimited) {
        console.error(
          "      → Supabase signup rate limit. Wait ~1h or sign up once at /login.",
        );
        console.error(
          "      → Optional: set SUPABASE_SERVICE_ROLE_KEY in .env.local for CI seed checks.",
        );
      }
      process.exit(1);
    }

    session = signUp.session;
    if (!session) {
      const retry = await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });
      if (retry.error || !retry.data.session) {
        console.error(
          "FAIL: Could not obtain session after sign-up.",
          retry.error?.message ?? signInErr?.message,
        );
        console.error(
          "      → Disable email confirmation in Supabase Auth → Providers → Email",
        );
        process.exit(1);
      }
      session = retry.data.session;
    }
  }

  if (!session?.access_token || !session.user) {
    console.error(
      "FAIL: No session after sign up/in (email confirmation likely required)",
    );
    process.exit(1);
  }

  console.log("OK  Auth sign-up/sign-in works for test user");
  await verifyAgentsAndRls(env, session);

  console.log("\nLive Supabase checks passed. Next: npm run dev → /login → full demo workflow.");
}

main().catch((err) => {
  console.error("FAIL: unexpected error", err);
  process.exit(1);
});
