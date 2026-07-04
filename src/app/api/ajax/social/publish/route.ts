export const maxDuration = 60;

import { NextResponse } from "next/server";
import {
  defaultPlatforms,
  isSocialConfigured,
  publishPost,
} from "@/lib/social/ayrshare";
import { createClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/supabase/schema";

/** POST /api/ajax/social/publish — publish a queued promo package to social. */
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

    if (!isSocialConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Social publishing not connected. Add AYRSHARE_API_KEY to your Vercel environment, then link your socials in Ayrshare.",
        },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as { queueId?: string };
    if (!body.queueId) {
      return NextResponse.json(
        { ok: false, error: "queueId required" },
        { status: 400 },
      );
    }

    const { data: item, error } = await supabase
      .from(TABLES.TIKTOK_QUEUE)
      .select("*")
      .eq("id", body.queueId)
      .eq("user_id", user.id)
      .single();
    if (error || !item) {
      return NextResponse.json(
        { ok: false, error: "Queue item not found." },
        { status: 404 },
      );
    }

    const caption = String(item.caption ?? "").trim();
    const hashtags = (item.hashtags ?? []) as string[];
    const tagLine = hashtags
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .join(" ");
    const postText = [caption, tagLine].filter(Boolean).join("\n\n");

    const mediaUrls = ((item.mockup_urls ?? []) as string[]).filter(
      (u) => typeof u === "string" && u.startsWith("https://"),
    );
    if (mediaUrls.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No publishable media. This package has no https image URLs — real product mockups are required to post (demo assets can't be published).",
        },
        { status: 400 },
      );
    }

    const result = await publishPost({
      post: postText,
      platforms: defaultPlatforms(),
      mediaUrls,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "Publish failed." },
        { status: 502 },
      );
    }

    await supabase
      .from(TABLES.TIKTOK_QUEUE)
      .update({ status: "posted" })
      .eq("id", body.queueId)
      .eq("user_id", user.id);

    const itemBusinessId =
      (item as { business_id?: string | null }).business_id ?? null;
    await supabase.from(TABLES.EVENTS).insert({
      user_id: user.id,
      business_id: itemBusinessId,
      event_type: "social_published",
      message: `Published a promo package to ${
        result.posts?.map((p) => p.platform).filter(Boolean).join(", ") ||
        "social"
      }.`,
      agent_slug: "pixel",
      room: "media_studio",
      metadata: {
        queueId: body.queueId,
        ayrsharePostId: result.ayrsharePostId ?? null,
        posts: result.posts ?? [],
      },
    });

    return NextResponse.json({ ok: true, posts: result.posts ?? [] });
  } catch (err) {
    console.error("[social/publish] error", err);
    return NextResponse.json(
      { ok: false, error: "Publish failed." },
      { status: 500 },
    );
  }
}
