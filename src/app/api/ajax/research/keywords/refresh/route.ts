export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getActiveBusinessId } from "@/lib/businesses/active";
import {
  isKeywordIngestConfigured,
  refreshEtsyKeywordCounts,
  saveManualKeywords,
  type ManualKeyword,
} from "@/lib/ajax/nova/keyword-ingest";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

/**
 * POST /api/ajax/research/keywords/refresh
 * - body.keywords[] → save operator-provided REAL numbers (search volume + supply)
 * - otherwise → pull REAL competing-listing counts from the live Etsy API
 * Both feed MARKET_KEYWORDS so the market scorer runs on real data.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      keywords?: ManualKeyword[];
    };

    const result =
      Array.isArray(body.keywords) && body.keywords.length > 0
        ? await saveManualKeywords(supabase, user.id, body.keywords)
        : await (async () => {
            if (!isKeywordIngestConfigured()) return null;
            return refreshEtsyKeywordCounts({
              supabase,
              userId: user.id,
              apiKey: process.env.ETSY_CLIENT_ID!.trim(),
            });
          })();

    if (result === null) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Live keyword data needs Etsy API keys. Add BOTH ETSY_CLIENT_ID and ETSY_CLIENT_SECRET to your Vercel environment, or POST { keywords: [...] } with your own real numbers.",
        },
        { status: 400 },
      );
    }

    if (result.upserted > 0) {
      const businessId = await getActiveBusinessId(supabase, user.id);
      await supabase.from(TABLES.EVENTS).insert({
        user_id: user.id,
        business_id: businessId,
        event_type: "market_research",
        message: `Refreshed ${result.upserted} market keyword${
          result.upserted === 1 ? "" : "s"
        } from ${result.source === "manual" ? "operator data" : "live Etsy data"}.`,
        agent_slug: "nova",
        room: "research_lab",
        metadata: {
          source: result.source,
          inserted: result.inserted,
          updated: result.updated,
          terms: result.terms,
        },
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[research/keywords/refresh] error", err);
    return NextResponse.json(
      { ok: false, error: "Keyword refresh failed." },
      { status: 500 },
    );
  }
}
