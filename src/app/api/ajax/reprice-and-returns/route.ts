// Price normalization + returns policy — SAFE TO RE-RUN.
//
// Rewritten 2026-07-25 (audit H7a): the original was a GET that multiplied
// every live price by 1/0.75 with no run-once marker — each accidental
// re-fire compounded prices 1.33× ($24.99 → $33.99 → $45.99 → $61.99), and
// its own "3 failures → abort" behavior actively invited the re-run. Prices
// now come from ABSOLUTE per-variant catalog targets (printify-catalog.ts is
// the single pricing authority), so running this twice is a no-op. Variants
// whose 25%-off sale price wouldn't clear Printify's REAL cost + shipping +
// fees are skipped and reported, never written (H8 guardrail).
//
// POST with optional JSON body { "dryRun": true } to audit live prices
// against catalog targets without writing anything — run that first if you
// suspect the old multiplier ever re-fired.
//
// Returns policy phase is unchanged: attaches the 30-day returns+exchanges
// policy to every published listing.
export const maxDuration = 600;

import { NextResponse, type NextRequest } from "next/server";
import { createPrintifyAdapter } from "@/lib/ajax/adapters/printify";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { catalogEntryForProduct } from "@/lib/ajax/pod/printify-catalog";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";
import { requireOperator } from "@/lib/auth/operator";

type GenerationJoin = {
  structure: {
    metadata?: { fulfillment?: { printifyProductId?: string } };
  } | null;
};

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "This endpoint is POST-only now (the old GET compounded prices 1.33x per accidental re-fire). POST {} to normalize to catalog targets, or {\"dryRun\":true} to audit without writing.",
    },
    { status: 405 },
  );
}

export async function POST(req: NextRequest) {
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

    // Operator-only (2026-07-25 audit, H10): signed-in is not authorized —
    // this surface mutates the ONE live shop on process-wide credentials.
    const operatorCheck = requireOperator(user);
    if (!operatorCheck.ok) {
      return NextResponse.json(
        { ok: false, error: operatorCheck.error },
        { status: operatorCheck.status },
      );
    }

    let dryRun = false;
    try {
      const body = (await req.json()) as { dryRun?: boolean };
      dryRun = body?.dryRun === true;
    } catch {
      // empty body = live run
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

    // ---- Phase 1: normalize Printify variant prices to catalog targets ----
    let repriced = 0;
    let alreadyCorrect = 0;
    let skippedNoPrintify = 0;
    let skippedNoCatalog = 0;
    const examples: {
      title: string;
      changes: string[];
      skipped: string[];
    }[] = [];
    const guardrailSkips: { listing: string; reason: string }[] = [];
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
        // The product's own blueprint decides which catalog targets apply.
        const detail = await printify.getProduct(printifyId);
        const entry = catalogEntryForProduct(
          detail.data.blueprintId,
          detail.data.printProviderId,
        );
        if (!entry) {
          skippedNoCatalog += 1;
          failed.push({
            listing: String(row.title ?? row.id).slice(0, 40),
            error: `blueprint ${detail.data.blueprintId ?? "?"} not in catalog — price it manually or add a catalog entry`,
          });
          continue;
        }

        const result = await printify.setVariantPrices(
          printifyId,
          entry.variantPrices,
          { shippingCents: entry.estimatedUsShippingCents, dryRun },
        );
        const { changes, skipped, unchanged } = result.data;

        if (changes.length > 0) {
          repriced += 1;
          if (!dryRun) {
            // Keep the internal price in sync for audits/review context.
            const minNew = Math.min(...changes.map((c) => c.newCents));
            await supabase
              .from(TABLES.LISTINGS)
              .update({ price: minNew / 100 })
              .eq("id", row.id)
              .eq("user_id", user.id);
          }
        } else if (skipped.length === 0 && unchanged > 0) {
          alreadyCorrect += 1;
        }

        for (const s of skipped) {
          guardrailSkips.push({
            listing: String(row.title ?? row.id).slice(0, 40),
            reason: `variant ${s.id}: ${s.reason}`,
          });
        }

        if (examples.length < 8 && (changes.length > 0 || skipped.length > 0)) {
          examples.push({
            title: String(row.title ?? "").slice(0, 45),
            changes: changes.map(
              (c) =>
                `${c.id}: $${(c.oldCents / 100).toFixed(2)} → $${(c.newCents / 100).toFixed(2)} (cost $${(c.costCents / 100).toFixed(2)})`,
            ),
            skipped: skipped.map((s) => `${s.id}: ${s.reason}`),
          });
        }
      } catch (err) {
        failed.push({
          listing: String(row.title ?? row.id).slice(0, 40),
          error: err instanceof Error ? err.message.slice(0, 300) : "unknown",
        });
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    // ---- Phase 2: attach the returns policy on Etsy -----------------------
    let returnsAttached = 0;
    let returnPolicyId: number | null = null;
    if (!dryRun) {
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
              error:
                err instanceof Error ? err.message.slice(0, 300) : "unknown",
            });
            if (failed.length >= 12) break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (err) {
        failed.push({
          listing: "return-policy-create",
          error: err instanceof Error ? err.message.slice(0, 300) : "unknown",
        });
      }
    }

    return NextResponse.json({
      ok: failed.length === 0,
      dryRun,
      repriced,
      alreadyCorrect,
      skippedNoPrintify,
      skippedNoCatalog,
      guardrailSkips,
      examples,
      returnPolicyId,
      returnsAttached,
      failed,
      note: dryRun
        ? "Dry run: differences vs catalog targets reported, nothing written."
        : "Prices normalized to absolute catalog targets (idempotent — safe to re-run); 30-day returns attached.",
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
