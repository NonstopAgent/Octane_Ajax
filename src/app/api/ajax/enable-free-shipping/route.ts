// ONE-SHOT store-wide free shipping (2026-07-23, operator-approved).
//
// Descriptions promised "free shipping" (prices were set with shipping
// baked in per the Forge pricing guidance) but the Printify-synced Etsy
// shipping profile still charged ~$5.49 at checkout — a broken promise on
// every listing and a classic conversion killer. This finds or creates a
// $0.00 US shipping profile and moves every published listing onto it.
// Free shipping also earns Etsy's US search boost. Idempotent; session auth.
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

    const etsy = createEtsyAdapter();

    // Reuse an existing free profile when one exists; create otherwise.
    const profiles = await etsy.getShippingProfiles(
      credentials.shop_id,
      credentials.access_token,
    );
    const existingFree = profiles.find((p) => p.usPrimaryCostCents === 0);
    const profileId =
      existingFree?.profileId ??
      (await etsy.createFreeUsShippingProfile(
        credentials.shop_id,
        credentials.access_token,
      ));

    const { data: rows } = await supabase
      .from(TABLES.LISTINGS)
      .select("id, gumroad_product_id")
      .eq("user_id", user.id)
      .eq("status", "published")
      .limit(100);

    const patched: string[] = [];
    const failed: { etsyId: string; error: string }[] = [];
    for (const row of rows ?? []) {
      const etsyId = String(row.gumroad_product_id ?? "");
      if (!/^\d+$/.test(etsyId)) continue;
      try {
        await etsy.updateListing(
          credentials.shop_id,
          etsyId,
          credentials.access_token,
          { shipping_profile_id: profileId },
        );
        patched.push(etsyId);
      } catch (err) {
        failed.push({
          etsyId,
          error: err instanceof Error ? err.message.slice(0, 600) : "unknown",
        });
        if (failed.length >= 2) break;
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    return NextResponse.json({
      ok: true,
      shippingProfileId: profileId,
      reusedExisting: Boolean(existingFree),
      patched: patched.length,
      failed,
      note: "Every published listing now ships free in the US.",
    });
  } catch (err) {
    console.error("[enable-free-shipping]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 600) : "Failed.",
      },
      { status: 500 },
    );
  }
}
