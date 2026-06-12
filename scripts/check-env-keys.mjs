// Prints key names + whether they have a value locally. Never prints values.
import { readFileSync } from "node:fs";
const t = readFileSync(".env.local", "utf8");
for (const l of t.split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i < 1 || l.startsWith("#")) continue;
  const k = l.slice(0, i);
  if (/OPENAI|IMAGE|PRINTIFY/i.test(k)) {
    const v = l.slice(i + 1).trim().replace(/^"|"$/g, "");
    console.log(k, v.length > 0 ? "HAS_VALUE" : "EMPTY(sensitive)");
  }
}
