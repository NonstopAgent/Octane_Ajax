import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID ?? "test-key";
process.env.ETSY_CLIENT_SECRET = process.env.ETSY_CLIENT_SECRET ?? "test-secret";

import {
  applyListingAttributes,
  desiredAttributesFor,
} from "@/lib/ajax/adapters/etsy-attributes";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("etsy attributes", () => {
  it("desiredAttributesFor infers product type from hints", () => {
    const mug = desiredAttributesFor(["Senior Dog Tribute Mug"]);
    assert.ok(mug.properties.some((p) => p.names.includes("Graphic")));
    assert.ok(mug.properties.some((p) => p.names.includes("Primary color")));
    assert.deepEqual(mug.materials, ["Ceramic"]);

    const poster = desiredAttributesFor([
      "Adopted & Loved Rescue Dog Poster",
    ]);
    assert.ok(poster.properties.some((p) => p.names.includes("Room")));
    assert.ok(poster.properties.some((p) => p.names.includes("Style")));
  });

  it("applyListingAttributes matches Etsy display_name + sets values/materials", async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url: u, method, body: init?.body ? String(init.body) : "" });
      if (
        method === "GET" &&
        /\/listings\/555\b/.test(u) &&
        !/\/properties/.test(u)
      ) {
        return jsonResponse({ taxonomy_id: 1, title: "Senior Dog Tribute Mug" });
      }
      if (/\/seller-taxonomy\/nodes\/1\/properties/.test(u)) {
        // Etsy returns display_name / name (NOT property_name).
        return jsonResponse({
          count: 2,
          results: [
            {
              property_id: 10,
              name: "graphic_internal",
              display_name: "Graphic",
              possible_values: [{ value_id: 100, name: "Animal" }],
            },
            {
              property_id: 20,
              name: "color_primary",
              display_name: "Primary color",
              possible_values: [{ value_id: 200, name: "White" }],
            },
          ],
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const result = await applyListingAttributes(
      "shop1",
      "555",
      "42.tok",
      [],
      fetchImpl,
    );

    assert.equal(result.taxonomyId, 1);
    assert.ok(result.set.some((s) => s.startsWith("Graphic=Animal")));
    assert.ok(result.set.some((s) => s.startsWith("Primary color=White")));
    assert.ok(result.set.some((s) => s.startsWith("materials=Ceramic")));

    const put10 = calls.find(
      (c) => c.method === "PUT" && /\/properties\/10$/.test(c.url),
    );
    assert.ok(put10, "PUT graphic property");
    assert.match(put10!.body, /value_ids%5B%5D=100/);
    assert.match(put10!.body, /values%5B%5D=Animal/);

    const patch = calls.find(
      (c) => c.method === "PATCH" && /\/listings\/555$/.test(c.url),
    );
    assert.ok(patch, "PATCH materials");
    assert.match(patch!.body, /materials%5B%5D=Ceramic/);
  });
});
