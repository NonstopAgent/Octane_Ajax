/**
 * POST|GET /api/ajax/etsy-attributes — set Etsy listing attributes via the API.
 *
 * Sets taxonomy properties (Graphic, Capacity, Orientation, colors, Room, Frame…)
 * plus materials that the Shop Manager web editor cannot reliably automate (it
 * freezes rendering the Materials list). Idempotent and fail-soft — enforces the
 * Listing Quality Standard on existing AND newly published listings.
 *
 * Body (optional): { listingIds?: string[] }. When omitted, reconciles ALL of the
 * operator's active + draft listings, inferring product type from each title.
 *
 * Security: CRON_SECRET Bearer token (same as the other cron/admin routes).
 */
export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import {
  applyListingAttributes,
  listShopListingSummaries,
} from "@/lib/ajax/adapters/etsy-attributes";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { createServiceClient } from "@/lib/supabase/server";

async function run(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const operatorEmail = process.env.OPERATOR_EMAIL;
  if (!operatorEmail) {
    return NextResponse.json(
      { ok: false, error: "OPERATOR_EMAIL env var not set." },
      { status: 500 },
    );
  }

  let listingIds: string[] | undefined;
  if (req.method === "POST") {
    try {
      const body = (await req.json()) as { listingIds?: unknown };
      if (Array.isArray(body.listingIds) && body.listingIds.length) {
        listingIds = body.listingIds.map((x) => String(x));
      }
    } catch {
      /* no / invalid body — fall through to full reconcile */
    }
  }

  try {
    const supabase = createServiceClient();
    const { data: userList, error: listError } =
      await supabase.auth.admin.listUsers();
    if (listError) {
      return NextResponse.json(
        { ok: false, error: `Failed to list users: ${listError.message}` },
        { status: 500 },
      );
    }
    const operator = userList.users.find(
      (u) => u.email?.toLowerCase() === operatorEmail.toLowerCase(),
    );
    if (!operator) {
      return NextResponse.json(
        { ok: false, error: `No user found with email ${operatorEmail}.` },
        { status: 404 },
      );
    }

    const creds = await refreshEtsyToken(operator.id, { supabase });
    if (!creds) {
      return NextResponse.json(
        { ok: false, error: "Etsy is not connected for the operator." },
        { status: 400 },
      );
    }

    const targetIds =
      listingIds ??
      (
        await listShopListingSummaries(creds.shop_id, creds.access_token)
      ).map((s) => s.listingId);

    const results: Record<string, unknown>[] = [];
    for (const listingId of targetIds) {
      try {
        const r = await applyListingAttributes(
          creds.shop_id,
          listingId,
          creds.access_token,
          [],
        );
        results.push({ listingId, taxonomyId: r.taxonomyId, set: r.set, skipped: r.skipped, available: r.available });
      } catch (err) {
        results.push({
          listingId,
          set: [],
          skipped: [err instanceof Error ? err.message : "unknown error"],
        });
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error("[ajax/etsy-attributes] unexpected error", err);
    return NextResponse.json(
      { ok: false, error: "Unexpected error applying attributes." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return run(req);
}

export async function GET(req: NextRequest) {
  return run(req);
}
