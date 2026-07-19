/**
 * POST /api/ajax/update-listing-seo — batch title/tag rewrites for live
 * listings. Week-one data (2026-07-19): ~20 total views across 28 listings
 * means Etsy search wasn't surfacing us at all — titles led with brand-y
 * phrasing instead of buyer queries. This pushes operator-approved long-tail
 * titles and 13-tag sets per listing.
 *
 * Body: { items: [{ etsyListingId, title?, tags?: string[] }] }
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
      items?: { etsyListingId?: string; title?: string; tags?: string[] }[];
    };
    const items = (body.items ?? []).filter(
      (i) => i.etsyListingId && /^\d+$/.test(i.etsyListingId),
    );
    if (items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Pass items[] with etsyListingId." },
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
    for (const item of items) {
      const id = item.etsyListingId!;
      try {
        const patch: { title?: string; tags?: string[] } = {};
        if (item.title?.trim()) patch.title = item.title.trim().slice(0, 140);
        if (item.tags?.length) {
          patch.tags = item.tags
            .map((t) => t.trim().slice(0, 20))
            .filter(Boolean)
            .slice(0, 13);
        }
        if (!patch.title && !patch.tags) {
          results.push({ id, ok: false, error: "empty patch" });
          continue;
        }
        await etsy.updateListing(
          credentials.shop_id,
          id,
          credentials.access_token,
          patch,
        );
        // Keep the internal record in sync so future passes see the new title.
        if (patch.title) {
          await supabase
            .from(TABLES.LISTINGS)
            .update({ title: patch.title })
            .eq("gumroad_product_id", id);
        }
        results.push({ id, ok: true });
      } catch (err) {
        results.push({
          id,
          ok: false,
          error: err instanceof Error ? err.message : "failed",
        });
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    await supabase.from(TABLES.EVENTS).insert({
      user_id: user.id,
      event_type: "listing_seo_updated",
      message: `SEO rewrite: ${results.filter((r) => r.ok).length}/${items.length} listing(s) got buyer-query titles/tags.`,
      agent_slug: "sage",
      room: "storefront",
      metadata: { results } as never,
    });

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
