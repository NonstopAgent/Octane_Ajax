// ONE-SHOT (2026-07-24, operator-directed): make the 25% sale profitable
// and fix the returns trust-killer.
//
// Pricing: bases rise by 1/0.75 (charm .99) so the SALE price lands at the
// old full price — the buyer still sees 25% off, every sale profits. The
// Printify variants-only publish syncs prices without touching titles/tags
// the medic fixed on Etsy. Reports exact production-cost margins from
// Printify's own per-variant cost data.
//
// Returns: attaches a 30-day returns+exchanges policy to every published
// listing ("Returns & exchanges not accepted" was showing on every page;
// Etsy exempts personalized items from returns regardless).
export const maxDuration = 600;

import { NextResponse } from "next/server";
import { createPrintifyAdapter } from "@/lib/ajax/adapters/printify";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

const SALE_MULTIPLIER = 1 / 0.75;

type GenerationJoin = {
  structure: {
    metadata?: { fulfillment?: { printifyProductId?: string } };
  } | null;
};

export async function GET() {
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

    const credentials = await refreshEtsyToken(user.id, { supabase });
    if (!credentials) {
      return NextResponse.json(
        { ok: false, error: "Etsy shop not connected." },
        { status: 400 },
      );
    }

    const { data: rows } = await supabase
      .from(TABLES.LISTINGS)
      .select(
        "id, title, price, gumroad_product_id, product_generations ( structure )",
      )
      .eq("user_id", user.id)
      .eq("status", "published")
      .limit(100);

    const printify = createPrintifyAdapter();
    const etsy = createEtsyAdapter();

    // ---- Phase 1: raise Printify variant prices (syncs to Etsy) ----------
    let repriced = 0;
    let skippedNoPrintify = 0;
    const examples: {
      title: string;
      oldPrice: string;
      newPrice: string;
      salePriceNow: string;
      productionCost: string;
    }[] = [];
    const failed: { listing: string; error: string }[] = [];

    for (const row of rows ?? []) {
      const generations = (
        row.product_generations == null
          ? []
          : Array.isArray(row.product_generations)
            ? row.product_generations
            : [row.product_generations]
      ) as GenerationJoin[];
      const printifyId =
        generations[0]?.structure?.metadata?.fulfillment?.printifyProductId?.trim();
      if (!printifyId) {
        skippedNoPrintify += 1;
        continue;
      }
      try {
        const result = await printify.raiseVariantPrices(
          printifyId,
          SALE_MULTIPLIER,
        );
        const variants = result.data.variants;
        if (variants.length > 0) {
          repriced += 1;
          const first = variants[0]!;
          if (examples.length < 6) {
            examples.push({
              title: String(row.title ?? "").slice(0, 45),
              oldPrice: `$${(first.oldCents / 100).toFixed(2)}`,
              newPrice: `$${(first.newCents / 100).toFixed(2)}`,
              salePriceNow: `$${((first.newCents * 0.75) / 100).toFixed(2)}`,
              productionCost: first.costCents
                ? `$${(first.costCents / 100).toFixed(2)}`
                : "n/a",
            });
          }
          // Keep the internal price in sync for audits/review context.
          const minNew = Math.min(...variants.map((v) => v.newCents));
          await supabase
            .from(TABLES.LISTINGS)
            .update({ price: minNew / 100 })
            .eq("id", row.id)
            .eq("user_id", user.id);
        }
      } catch (err) {
        failed.push({
          listing: String(row.title ?? row.id).slice(0, 40),
          error: err instanceof Error ? err.message.slice(0, 300) : "unknown",
        });
        if (failed.length >= 3) break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    // ---- Phase 2: attach the returns policy on Etsy -----------------------
    let returnsAttached = 0;
    let returnPolicyId: number | null = null;
    try {
      returnPolicyId = await etsy.ensureReturnPolicy(
        credentials.shop_id,
        credentials.access_token,
      );
      for (const row of rows ?? []) {
        const etsyId = String(row.gumroad_product_id ?? "");
        if (!/^\d+$/.test(etsyId)) continue;
        try {
          await etsy.updateListing(
            credentials.shop_id,
            etsyId,
            credentials.access_token,
            { return_policy_id: returnPolicyId },
          );
          returnsAttached += 1;
        } catch (err) {
          failed.push({
            listing: `returns ${etsyId}`,
            error: err instanceof Error ? err.message.slice(0, 300) : "unknown",
          });
          if (failed.length >= 6) break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (err) {
      failed.push({
        listing: "return-policy-create",
        error: err instanceof Error ? err.message.slice(0, 300) : "unknown",
      });
    }

    return NextResponse.json({
      ok: true,
      repriced,
      skippedNoPrintify,
      examples,
      returnPolicyId,
      returnsAttached,
      failed,
      note: "Sale price now equals the old full price (buyer still sees 25% off); 30-day returns live.",
    });
  } catch (err) {
    console.error("[reprice-and-returns]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 400) : "Failed.",
      },
      { status: 500 },
    );
  }
}
