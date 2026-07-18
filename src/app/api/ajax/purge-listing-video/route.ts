/**
 * POST /api/ajax/purge-listing-video — delete a listing's current video.
 * For repaired listings whose fresh render is still behind the daily cap:
 * the attached clip shows the OLD broken design, and no video beats a
 * broken video. The fresh render attaches via the drain once it exists.
 *
 * Body: { etsyListingIds: string[] }
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
    };
    const ids = (body.etsyListingIds ?? []).filter((id) => /^\d+$/.test(id));
    if (ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Pass etsyListingIds[]." },
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

    const results: { id: string; purged: number; error?: string }[] = [];
    for (const id of ids) {
      try {
        const videos = await etsy.getListingVideos(id, credentials.access_token);
        let purged = 0;
        for (const videoId of videos) {
          await etsy.deleteListingVideo(
            id,
            videoId,
            credentials.shop_id,
            credentials.access_token,
          );
          purged += 1;
        }
        results.push({ id, purged });
      } catch (err) {
        results.push({
          id,
          purged: 0,
          error: err instanceof Error ? err.message : "failed",
        });
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    await supabase.from(TABLES.EVENTS).insert({
      user_id: user.id,
      event_type: "stale_videos_purged",
      message: `Purged stale videos on ${results.filter((r) => r.purged > 0).length}/${ids.length} listing(s) — fresh renders attach via the drain when the daily cap allows.`,
      agent_slug: "pixel",
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
