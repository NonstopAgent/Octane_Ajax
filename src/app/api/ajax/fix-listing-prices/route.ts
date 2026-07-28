/**
 * POST /api/ajax/fix-listing-prices — set Etsy-side prices for specific
 * listings by rewriting their inventory offerings.
 *
 * Exists for listings with NO linked Printify product (three early-July
 * listings predate the linkage), which the catalog-driven reset
 * (reprice-and-returns) can never reach. Operator-invoked only — CRON_SECRET
 * bearer via scripts/fix-prices.ps1; this route is NOT wired to any cron.
 *
 * Quiet-window note (2026-07-28): running this during the freeze was an
 * explicit operator order — it completes the one-time traction price reset
 * on the three listings the Printify pass missed. Price only; nothing else
 * about the listings is touched.
 *
 * Body: { items: [{ listingId, priceUsd, twoXlPriceUsd? }], dryRun? }
 */
export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import {
  createEtsyAdapter,
  EtsyAdapterError,
} from "@/lib/ajax/adapters/etsy";
import { buildInventoryPricePlan } from "@/lib/ajax/adapters/etsy-inventory-price";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { resolveCronOperator } from "@/lib/auth/cron";

type FixItem = { listingId: string; priceUsd: number; twoXlPriceUsd?: number };

type FixResult =
  | { listingId: string; status: "skipped"; reason: string }
  | { listingId: string; status: "alreadyCorrect"; offerings: number }
  | {
      listingId: string;
      status: "wouldChange" | "updated";
      offerings: number;
      changes: { variation: string; from: string[]; to: string }[];
    }
  | { listingId: string; status: "failed"; error: string };

export async function POST(req: NextRequest) {
  const cron = await resolveCronOperator(req);
  if (!cron.ok) return cron.response;
  const { supabase, userId } = cron;

  let body: { items?: unknown; dryRun?: unknown };
  try {
    body = (await req.json()) as { items?: unknown; dryRun?: unknown };
  } catch {
    body = {};
  }
  const dryRun = body.dryRun === true;

  const items: FixItem[] = [];
  for (const raw of Array.isArray(body.items) ? body.items : []) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const listingId = String(r.listingId ?? "").trim();
    const priceUsd = Number(r.priceUsd);
    // Sanity rails: numeric Etsy id, price inside the shop's plausible band.
    if (!/^\d+$/.test(listingId)) continue;
    if (!Number.isFinite(priceUsd) || priceUsd < 5 || priceUsd > 200) continue;
    const twoXlRaw = r.twoXlPriceUsd;
    const twoXlPriceUsd =
      twoXlRaw == null ? undefined : Number(twoXlRaw);
    items.push({
      listingId,
      priceUsd,
      ...(twoXlPriceUsd != null &&
      Number.isFinite(twoXlPriceUsd) &&
      twoXlPriceUsd >= 5 &&
      twoXlPriceUsd <= 200
        ? { twoXlPriceUsd }
        : {}),
    });
  }

  if (items.length === 0 || items.length > 10) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Body must include 1-10 valid items: [{ listingId, priceUsd, twoXlPriceUsd? }].",
      },
      { status: 400 },
    );
  }

  const creds = await refreshEtsyToken(userId, { supabase });
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: "Etsy is not connected for the operator." },
      { status: 400 },
    );
  }

  const adapter = createEtsyAdapter();
  const results: FixResult[] = [];

  for (const item of items) {
    try {
      const inventory = await adapter.getListingInventory(
        item.listingId,
        creds.access_token,
      );
      const plan = buildInventoryPricePlan(inventory, {
        basePriceCents: Math.round(item.priceUsd * 100),
        ...(item.twoXlPriceUsd != null
          ? { twoXlPriceCents: Math.round(item.twoXlPriceUsd * 100) }
          : {}),
      });

      if (plan.offeringCount === 0) {
        results.push({
          listingId: item.listingId,
          status: "skipped",
          reason: "Etsy returned no offerings for this listing.",
        });
        continue;
      }
      if (plan.unchanged) {
        results.push({
          listingId: item.listingId,
          status: "alreadyCorrect",
          offerings: plan.offeringCount,
        });
        continue;
      }

      if (!dryRun) {
        await adapter.updateListingInventory(
          item.listingId,
          creds.access_token,
          plan.payload,
        );
      }
      results.push({
        listingId: item.listingId,
        status: dryRun ? "wouldChange" : "updated",
        offerings: plan.offeringCount,
        changes: plan.changes.map((c) => ({
          variation: c.label,
          from: [...new Set(c.oldCents)].map((cents) =>
            (cents / 100).toFixed(2),
          ),
          to: (c.newCents / 100).toFixed(2),
        })),
      });
    } catch (err) {
      results.push({
        listingId: item.listingId,
        status: "failed",
        error:
          err instanceof EtsyAdapterError
            ? `${err.message} (HTTP ${err.statusCode ?? "?"})`
            : err instanceof Error
              ? err.message
              : "unknown error",
      });
    }
  }

  return NextResponse.json({
    ok: results.every((r) => r.status !== "failed"),
    dryRun,
    results,
  });
}
