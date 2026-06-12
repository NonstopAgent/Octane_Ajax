/**
 * GET /api/ajax/debug/printify-catalog
 *
 * TEMPORARY route: looks up known-good Printify blueprint/provider/variant
 * IDs for the entries in src/lib/ajax/pod/printify-catalog.ts, running in
 * production where the sensitive PRINTIFY_API_TOKEN lives.
 *
 * Security: requires CRON_SECRET as Bearer token (same as cron routes).
 * DELETE THIS ROUTE once the catalog IDs are verified and hardcoded.
 */
export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";

const BASE = "https://api.printify.com/v1";

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

type Blueprint = { id: number; title: string; brand?: string; model?: string };
type Provider = { id: number; title: string };
type Variant = { id: number; title: string; is_available?: boolean };

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.PRINTIFY_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "PRINTIFY_API_TOKEN is not set at runtime." },
      { status: 500 },
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  async function api<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, { headers });
    if (!res.ok) {
      throw new Error(`${path} -> ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  try {
    const blueprints = await api<Blueprint[]>("/catalog/blueprints.json");
    const shops = await api<{ id: number; title: string; sales_channel: string }[]>(
      "/shops.json",
    );

    const results: Record<string, unknown> = {};

    for (const target of TARGETS) {
      const lower = (s: string) => s.toLowerCase();
      let bp: Blueprint | undefined;
      for (const needle of target.titleIncludes) {
        bp = blueprints.find((b) => lower(b.title).includes(needle));
        if (bp) break;
      }
      bp ??= blueprints.find((b) =>
        target.fallbackIncludes.every((n) => lower(b.title).includes(n)),
      );

      if (!bp) {
        results[target.catalogKey] = { error: "no blueprint match" };
        continue;
      }

      const providers = await api<Provider[]>(
        `/catalog/blueprints/${bp.id}/print_providers.json`,
      );
      if (providers.length === 0) {
        results[target.catalogKey] = {
          blueprint: bp,
          error: "no providers",
        };
        continue;
      }

      const provider =
        providers.find((p) => /monster|sensaria|district|spoke/i.test(p.title)) ??
        providers[0]!;

      const data = await api<{ variants: Variant[] }>(
        `/catalog/blueprints/${bp.id}/print_providers/${provider.id}/variants.json`,
      );
      const available = (data.variants ?? []).filter(
        (v) => v.is_available !== false,
      );

      results[target.catalogKey] = {
        blueprintId: bp.id,
        blueprintTitle: bp.title,
        providerId: provider.id,
        providerTitle: provider.title,
        variantIds: available.slice(0, 6).map((v) => v.id),
        variantTitles: available.slice(0, 6).map((v) => v.title),
        allProviders: providers.map((p) => `${p.id}:${p.title}`),
      };
    }

    return NextResponse.json({
      ok: true,
      shops: shops.map((s) => ({ id: s.id, title: s.title, channel: s.sales_channel })),
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Catalog lookup failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
