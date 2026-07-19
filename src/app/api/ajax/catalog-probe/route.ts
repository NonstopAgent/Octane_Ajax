/**
 * GET /api/ajax/catalog-probe?bp=1672 — inspect a Printify blueprint's print
 * providers, variants, and placeholder dimensions straight from the live
 * catalog. Used to VERIFY ids before adding a product type to
 * `printify-catalog.ts` (the catalog file demands verified ids; guessing
 * variant ids ships broken products).
 */
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BASE = "https://api.printify.com/v1";

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 },
      );
    }

    const token = process.env.PRINTIFY_API_TOKEN?.trim();
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "PRINTIFY_API_TOKEN not configured." },
        { status: 500 },
      );
    }
    const headers = { Authorization: `Bearer ${token}` };

    const url = new URL(req.url);
    const bp = url.searchParams.get("bp");
    if (!bp || !/^\d+$/.test(bp)) {
      return NextResponse.json(
        { ok: false, error: "Pass ?bp=<blueprintId>." },
        { status: 400 },
      );
    }

    const bpRes = await fetch(`${BASE}/catalog/blueprints/${bp}.json`, {
      headers,
    });
    const blueprint = (await bpRes.json()) as {
      title?: string;
      brand?: string;
      model?: string;
    };

    const provRes = await fetch(
      `${BASE}/catalog/blueprints/${bp}/print_providers.json`,
      { headers },
    );
    const providers = (await provRes.json()) as { id: number; title: string }[];

    const detail = [];
    for (const p of (providers ?? []).slice(0, 4)) {
      const vRes = await fetch(
        `${BASE}/catalog/blueprints/${bp}/print_providers/${p.id}/variants.json`,
        { headers },
      );
      const v = (await vRes.json()) as {
        variants?: {
          id: number;
          title: string;
          placeholders?: { position: string; width: number; height: number }[];
        }[];
      };
      detail.push({
        providerId: p.id,
        providerTitle: p.title,
        variants: (v.variants ?? []).slice(0, 10).map((x) => ({
          id: x.id,
          title: x.title,
          placeholders: (x.placeholders ?? []).map(
            (q) => `${q.position} ${q.width}x${q.height}`,
          ),
        })),
      });
      await new Promise((r) => setTimeout(r, 200));
    }

    return NextResponse.json({
      ok: true,
      blueprint: `${blueprint.brand ?? ""} ${blueprint.model ?? ""} — ${blueprint.title ?? ""}`.trim(),
      providers: detail,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
