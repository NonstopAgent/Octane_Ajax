/**
 * POST /api/ajax/social-cleanup — remove published social posts that showed
 * CORRUPTED products. The 2026-07 defect wave shipped weeks of posts whose
 * media shows designs cut off at the print edge; the operator caught one on
 * TikTok ("not what we want our customers to see"). Pulls the full Ayrshare
 * post history, matches posts to the defect listings (captions embed the
 * Etsy listing URL), and deletes them platform-side via Ayrshare.
 *
 * Body: { listingIds: string[], before: ISO date, dryRun?: boolean }
 *  - dryRun (default true!) lists matches without deleting.
 */
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

const HISTORY_URL = "https://api.ayrshare.com/api/history";
const DELETE_URL = "https://api.ayrshare.com/api/post";

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

    const apiKey = process.env.AYRSHARE_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "AYRSHARE_API_KEY not configured." },
        { status: 500 },
      );
    }
    const profileKey = process.env.AYRSHARE_PROFILE_KEY?.trim();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(profileKey ? { "Profile-Key": profileKey } : {}),
    };

    const body = (await req.json().catch(() => ({}))) as {
      listingIds?: string[];
      before?: string;
      dryRun?: boolean;
    };
    const listingIds = (body.listingIds ?? []).filter((id) =>
      /^\d+$/.test(id),
    );
    const before = body.before ? new Date(body.before) : null;
    const dryRun = body.dryRun !== false;
    if (listingIds.length === 0 || !before || Number.isNaN(before.getTime())) {
      return NextResponse.json(
        { ok: false, error: "Pass listingIds[] and a valid before date." },
        { status: 400 },
      );
    }

    const histRes = await fetch(`${HISTORY_URL}?limit=300`, { headers });
    if (!histRes.ok) {
      const t = await histRes.text();
      throw new Error(`Ayrshare history failed (${histRes.status}): ${t.slice(0, 200)}`);
    }
    const hist = (await histRes.json()) as {
      history?: {
        id?: string;
        post?: string;
        platforms?: string[];
        created?: string;
        status?: string;
        mediaUrls?: string[];
      }[];
    };
    const posts = hist.history ?? [];

    const matches = posts.filter((p) => {
      if (!p.id || p.status === "deleted") return false;
      const createdAt = p.created ? new Date(p.created) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime()) || createdAt >= before) {
        return false;
      }
      const text = `${p.post ?? ""} ${(p.mediaUrls ?? []).join(" ")}`;
      return listingIds.some((id) => text.includes(id));
    });

    const results: {
      id: string;
      platforms: string[];
      created?: string;
      snippet: string;
      deleted?: boolean;
      error?: string;
    }[] = matches.map((p) => ({
      id: p.id!,
      platforms: p.platforms ?? [],
      created: p.created,
      snippet: (p.post ?? "").slice(0, 70),
    }));

    if (!dryRun) {
      for (const r of results) {
        try {
          const delRes = await fetch(DELETE_URL, {
            method: "DELETE",
            headers,
            body: JSON.stringify({ id: r.id }),
          });
          const delBody = (await delRes.json().catch(() => ({}))) as {
            status?: string;
            errors?: unknown[];
          };
          r.deleted = delRes.ok && delBody.status !== "error";
          if (!r.deleted) {
            r.error = JSON.stringify(delBody).slice(0, 150);
          }
        } catch (err) {
          r.deleted = false;
          r.error = err instanceof Error ? err.message : "delete failed";
        }
        await new Promise((res) => setTimeout(res, 400));
      }

      await supabase.from(TABLES.EVENTS).insert({
        user_id: user.id,
        event_type: "social_posts_purged",
        message: `Deleted ${results.filter((r) => r.deleted).length}/${results.length} social post(s) showing pre-repair (corrupted) product media.`,
        agent_slug: "pixel",
        room: "marketing",
        metadata: { before: body.before, results } as never,
      });
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      totalHistory: posts.length,
      matched: results.length,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
