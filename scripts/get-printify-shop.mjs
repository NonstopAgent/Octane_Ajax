#!/usr/bin/env node
/**
 * Prints the Printify shop(s) on your account so you can grab PRINTIFY_SHOP_ID.
 *
 * Usage:
 *   node scripts/get-printify-shop.mjs
 *
 * Reads PRINTIFY_API_TOKEN from .env.local (or the environment), calls
 * GET https://api.printify.com/v1/shops.json, and prints each shop's id +
 * title. Copy the id into PRINTIFY_SHOP_ID (in .env.local AND Vercel).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** Minimal .env.local parser (no dotenv dependency). */
function loadEnvLocal() {
  const env = {};
  try {
    const raw = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  } catch {
    // no .env.local — fall back to process.env only
  }
  return env;
}

const fileEnv = loadEnvLocal();
const token = process.env.PRINTIFY_API_TOKEN || fileEnv.PRINTIFY_API_TOKEN || "";

if (!token) {
  console.error(
    "\u2717 PRINTIFY_API_TOKEN not found in .env.local or environment.\n" +
      "  Add it to .env.local, or run inline:\n" +
      "  PRINTIFY_API_TOKEN=your_token node scripts/get-printify-shop.mjs",
  );
  process.exit(1);
}

const res = await fetch("https://api.printify.com/v1/shops.json", {
  headers: {
    Authorization: `Bearer ${token}`,
    "User-Agent": "Octane-Ajax/1.0",
  },
});

if (!res.ok) {
  const body = await res.text();
  console.error(
    `\u2717 Printify API error (${res.status}). ` +
      "Check the token is valid and not expired.\n" +
      body,
  );
  process.exit(1);
}

const shops = await res.json();

if (!Array.isArray(shops) || shops.length === 0) {
  console.error(
    "\u2717 No shops found on this Printify account.\n" +
      "  Connect a store in Printify first (e.g. an Etsy or pop-up store), then re-run.",
  );
  process.exit(1);
}

console.log("\n\u2713 Printify shops on this account:\n");
for (const shop of shops) {
  console.log(
    `  PRINTIFY_SHOP_ID=${shop.id}   # ${shop.title} (${shop.sales_channel})`,
  );
}
console.log(
  "\nCopy the id above into PRINTIFY_SHOP_ID \u2014 in .env.local AND in Vercel env vars.\n",
);
