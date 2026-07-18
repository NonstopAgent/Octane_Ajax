/**
 * GET /api/ajax/printify-map — resolve every Printify product's Etsy binding.
 * The DB never stored Printify product ids, but Printify stores the Etsy
 * listing id on each product (`external.id`), so the truthful map lives on
 * the Printify side. Used to drive the placement-repair wave by exact ids.
 */
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createPrintifyAdapter } from "@/lib/ajax/adapters/printify";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized. Sign in first." },
        { status: 401 },
      );
    }

    const printify = createPrintifyAdapter();
    const list = await printify.listProducts(50);
    const rows: {
      productId: string;
      title: string;
      blueprintId: number | null;
      etsyListingId: string | null;
    }[] = [];
    for (const row of list.data) {
      try {
        const details = await printify.getProduct(row.productId);
        rows.push({
          productId: row.productId,
          title: details.data.title,
          blueprintId: details.data.blueprintId,
          etsyListingId: details.data.externalId,
        });
      } catch {
        rows.push({
          productId: row.productId,
          title: row.title,
          blueprintId: row.blueprintId,
          etsyListingId: null,
        });
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    return NextResponse.json({ ok: true, count: rows.length, products: rows });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
