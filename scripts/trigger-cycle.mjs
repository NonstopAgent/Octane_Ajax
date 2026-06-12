// Triggers one production Nova+Forge cycle via the protected cron route.
import { readFileSync } from "node:fs";

const line = readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("CRON_SECRET="));
const secret = line?.slice("CRON_SECRET=".length).trim().replace(/^"|"$/g, "");
if (!secret) {
  console.error("CRON_SECRET not found in .env.local");
  process.exit(1);
}

const base = process.argv[2] ?? "https://octane-ajax.vercel.app";
const res = await fetch(`${base}/api/cron/run-nova`, {
  headers: { Authorization: `Bearer ${secret}` },
});
console.log("HTTP", res.status);
const text = await res.text();
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text.slice(0, 3000));
}
