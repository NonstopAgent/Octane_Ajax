export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getActiveBusinessId } from "@/lib/businesses/active";
import {
  isVideoRenderConfigured,
  pollVideoRender,
  renderVideoAndWait,
} from "@/lib/ajax/video/fal-render";
import { buildVideoSpec, type VideoSpec } from "@/lib/ajax/pixel/video-spec";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

/**
 * POST /api/ajax/video/render
 * - { queueId }          → render from a TikTok/promo package's hero mockup (spec built here)
 * - { imageUrl, spec }   → animate a specific mockup into an MP4 (submit + poll in budget)
 * - { requestId }        → poll an in-flight render
 * Dormant until FAL_KEY is set.
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

    if (!isVideoRenderConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Video rendering not connected. Add FAL_KEY to your Vercel environment (get one at fal.ai), then retry.",
        },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      imageUrl?: string;
      spec?: VideoSpec;
      requestId?: string;
      queueId?: string;
    };

    let result;
    if (body.requestId) {
      result = await pollVideoRender(body.requestId);
    } else if (body.queueId) {
      const { data: item } = await supabase
        .from(TABLES.TIKTOK_QUEUE)
        .select("caption, hashtags, mockup_urls")
        .eq("id", body.queueId)
        .eq("user_id", user.id)
        .single();
      const mockups = ((item?.mockup_urls ?? []) as string[]).filter(
        (u) => typeof u === "string" && u.startsWith("https://"),
      );
      if (!item || mockups.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "No publishable mockup on this package — a real https product image is required to render.",
          },
          { status: 400 },
        );
      }
      const hashtags = (item.hashtags ?? []) as string[];
      const title =
        String(item.caption ?? "").split("\n")[0]?.slice(0, 80) ||
        hashtags[0] ||
        "pet gift";
      const niche = (hashtags[0] ?? "").replace(/^#/, "") || title;
      const spec = buildVideoSpec({
        productTitle: title,
        niche,
        mockupCount: mockups.length,
      });
      result = await renderVideoAndWait({ imageUrl: mockups[0], spec });
    } else if (body.imageUrl && body.spec) {
      if (!body.imageUrl.startsWith("https://")) {
        return NextResponse.json(
          { ok: false, error: "imageUrl must be a public https mockup URL." },
          { status: 400 },
        );
      }
      result = await renderVideoAndWait({
        imageUrl: body.imageUrl,
        spec: body.spec,
      });
    } else {
      return NextResponse.json(
        { ok: false, error: "Provide { queueId }, { imageUrl, spec }, or { requestId }." },
        { status: 400 },
      );
    }

    if (result.status === "completed" && result.videoUrl) {
      const businessId = await getActiveBusinessId(supabase, user.id);
      await supabase.from(TABLES.EVENTS).insert({
        user_id: user.id,
        business_id: businessId,
        event_type: "video_rendered",
        message: "Rendered a product video from the mockup via fal.ai.",
        agent_slug: "pixel",
        room: "media_studio",
        metadata: {
          model: result.model,
          videoUrl: result.videoUrl,
          requestId: result.requestId ?? null,
        },
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[video/render] error", err);
    return NextResponse.json(
      { ok: false, error: "Video render failed." },
      { status: 500 },
    );
  }
}
