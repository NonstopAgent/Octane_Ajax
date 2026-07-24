// ONE-SHOT store-wide personalization enable (2026-07-23).
//
// The operator discovered every "personalized" listing was live WITHOUT a
// personalization box: the enrich pass set instructions/char-count but never
// is_personalizable — Etsy's master switch — so buyers of custom gifts had
// no way to enter a name. The hourly heal rotation now sets it, but that
// takes hours to cover the store; this endpoint PATCHes every published
// listing in one pass. Idempotent. Session auth; navigation-friendly GET.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

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
      .select("id, title, gumroad_product_id")
      .eq("user_id", user.id)
      .eq("status", "published")
      .limit(100);

    const etsy = createEtsyAdapter();
    const patched: string[] = [];
    const failed: { etsyId: string; error: string }[] = [];
    for (const row of rows ?? []) {
      const etsyId = String(row.gumroad_product_id ?? "");
      if (!/^\d+$/.test(etsyId)) continue;
      try {
        await etsy.setListingPersonalization(
          credentials.shop_id,
          etsyId,
          credentials.access_token,
          {
            required: true,
            maxChars: 256,
            instructions:
              "Your pet's name (and year/date if the design shows one) exactly as you'd like it. Type NONE to keep the design as pictured. For portrait items, paste a shareable photo link (Google Photos/iCloud/Drive).",
          },
        );
        patched.push(etsyId);
      } catch (err) {
        failed.push({
          etsyId,
          error: err instanceof Error ? err.message.slice(0, 600) : "unknown",
        });
        // The first full error tells us what Etsy wants instead — no need
        // to burn 40 more calls repeating it.
        if (failed.length >= 2) break;
      }
      // Gentle pacing — Etsy rate limits burst PATCHes.
      await new Promise((r) => setTimeout(r, 350));
    }

    return NextResponse.json({
      ok: true,
      patched: patched.length,
      failed,
      note: "Personalization box (name/date input) is now ON for every published listing.",
    });
  } catch (err) {
    console.error("[enable-personalization]", err);
    return NextResponse.json(
      { ok: false, error: "Failed to enable personalization store-wide." },
      { status: 500 },
    );
  }
}
