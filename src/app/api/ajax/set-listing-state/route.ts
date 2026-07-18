/**
 * POST /api/ajax/set-listing-state — operator-triggered listing state changes
 * by EXACT id list: deactivate defective listings for repair, reactivate them
 * once fixed. Built during the 2026-07-17 full-store visual sweep (14 of 31
 * live listings had design-placement defects) — precise id-based state
 * control beats error-prone bulk clicking of look-alike cards.
 *
 * Body: { "etsyListingIds": ["123", ...], "state": "inactive" | "active" }
 */
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

export async function POST(req: Request) {
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

    const body = (await req.json().catch(() => ({}))) as {
      etsyListingIds?: string[];
      state?: "active" | "inactive";
    };
    const ids = (body.etsyListingIds ?? []).filter((id) => /^\d+$/.test(id));
    if (ids.length === 0 || !["active", "inactive"].includes(body.state ?? "")) {
      return NextResponse.json(
        { ok: false, error: "Pass etsyListingIds[] and state active|inactive." },
        { status: 400 },
      );
    }

    const credentials = await refreshEtsyToken(user.id, { supabase });
    if (!credentials) {
      return NextResponse.json(
        { ok: false, error: "Etsy shop not connected." },
        { status: 500 },
      );
    }
    const etsy = createEtsyAdapter();

    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        await etsy.updateListing(
          credentials.shop_id,
          id,
          credentials.access_token,
          { state: body.state },
        );
        results.push({ id, ok: true });
      } catch (err) {
        results.push({
          id,
          ok: false,
          error: err instanceof Error ? err.message : "failed",
        });
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    await supabase.from(TABLES.EVENTS).insert({
      user_id: user.id,
      event_type: "listing_state_changed",
      message: `Operator set ${results.filter((r) => r.ok).length}/${ids.length} listing(s) to ${body.state} (QA sweep).`,
      agent_slug: "forge",
      room: "storefront",
      metadata: { state: body.state, results } as never,
    });

    return NextResponse.json({
      ok: results.every((r) => r.ok),
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
