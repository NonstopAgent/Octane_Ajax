// scripts/get-catalog-ids.mjs
//
// Fetches known-good Printify blueprint/provider/variant IDs for the
// catalog entries in src/lib/ajax/pod/printify-catalog.ts.
//
// Unlike hardcoding guessed IDs, this SEARCHES the live Printify catalog by
// product name, picks the first available print provider, and lists in-stock
// variants — so the output is valid for YOUR account by construction.
//
// Usage:
//   node scripts/get-catalog-ids.mjs
// Reads PRINTIFY_API_TOKEN from env, .env.local, or .env.

import { readFileSync, existsSync } from "node:fs";

function loadEnvToken() {
  if (process.env.PRINTIFY_API_TOKEN?.trim()) {
    return process.env.PRINTIFY_API_TOKEN.trim();
  }
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("PRINTIFY_API_TOKEN="));
    if (line) return line.slice("PRINTIFY_API_TOKEN=".length).trim().replace(/^"|"$/g, "");
  }
  return null;
}

const API_TOKEN = loadEnvToken();
if (!API_TOKEN) {
  console.error(
    "Error: PRINTIFY_API_TOKEN not found in env, .env.local, or .env.\n" +
      "Run: vercel env pull .env.local   (or add the token manually)",
  );
  process.exit(1);
}

const BASE = "https://api.printify.com/v1";
const headers = {
  Authorization: `Bearer ${API_TOKEN}`,
  "Content-Type": "application/json",
};

async function api(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Catalog targets matched by blueprint title (case-insensitive substring).
const TARGETS = [
  {
    catalogKey: "TEE_UNISEX",
    titleIncludes: ["unisex jersey short sleeve tee", "bella"],
    fallbackIncludes: ["unisex", "tee"],
  },
  {
    catalogKey: "SWEATSHIRT_CREWNECK",
    titleIncludes: ["unisex heavy blend crewneck sweatshirt", "gildan 18000"],
    fallbackIncludes: ["crewneck", "sweatshirt"],
  },
  {
    catalogKey: "POSTER_MATTE_VERTICAL",
    titleIncludes: ["matte vertical poster"],
    fallbackIncludes: ["matte", "poster"],
  },
  {
    catalogKey: "MUG_11OZ",
    titleIncludes: ["ceramic mug 11oz", "ceramic mug, 11oz"],
    fallbackIncludes: ["mug", "11oz"],
  },
];

function findBlueprint(blueprints, target) {
  const lower = (s) => s.toLowerCase();
  for (const needle of target.titleIncludes) {
    const hit = blueprints.find((b) => lower(b.title).includes(needle));
    if (hit) return hit;
  }
  return blueprints.find((b) =>
    target.fallbackIncludes.every((n) => lower(b.title).includes(n)),
  );
}

async function run() {
  console.log("Fetching Printify blueprint catalog...\n");
  const blueprints = await api("/catalog/blueprints.json");

  for (const target of TARGETS) {
    try {
      const bp = findBlueprint(blueprints, target);
      if (!bp) {
        console.log(`--- ${target.catalogKey}: NO BLUEPRINT MATCH ---\n`);
        continue;
      }

      const providers = await api(
        `/catalog/blueprints/${bp.id}/print_providers.json`,
      );
      if (!providers.length) {
        console.log(`--- ${target.catalogKey}: blueprint ${bp.id} has no providers ---\n`);
        continue;
      }

      // Prefer a US-based well-known provider when present, else first.
      const provider =
        providers.find((p) => /monster|sensaria|district|spoke/i.test(p.title)) ??
        providers[0];

      const data = await api(
        `/catalog/blueprints/${bp.id}/print_providers/${provider.id}/variants.json`,
      );
      const available = (data.variants ?? []).filter(
        (v) => v.is_available !== false,
      );
      const picked = available.slice(0, 6);

      console.log(`--- ${target.catalogKey} ---`);
      console.log(`Blueprint:   ${bp.id}  (${bp.title} / ${bp.brand ?? ""} ${bp.model ?? ""})`);
      console.log(`Provider:    ${provider.id}  (${provider.title})`);
      console.log(`VariantIds:  [${picked.map((v) => v.id).join(", ")}]`);
      console.log(
        `Variants:    ${picked.map((v) => v.title).join(" | ")}`,
      );
      console.log("");
    } catch (err) {
      console.error(`--- ${target.catalogKey}: FAILED — ${err.message} ---\n`);
    }
  }

  console.log(
    "Paste this output to Claude (or update src/lib/ajax/pod/printify-catalog.ts directly).",
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
