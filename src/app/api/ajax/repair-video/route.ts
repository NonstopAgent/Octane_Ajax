/**
 * POST /api/ajax/repair-video — re-render a listing's video from its CURRENT
 * (repaired) front mockup. The heal/enrich path won't re-render when an old
 * video job exists, but after placement surgery the old video shows the
 * broken design — it must be superseded, not reused. Creates a fresh fal
 * render (respects VIDEO_DAILY_RENDER_CAP); the 10-min drain uploads it to
 * the listing once done — the listing must be ACTIVE by then or Etsy drops
 * the upload.
 *
 * Body: { printifyProductId: string, etsyListingId: string }
 */
export const maxDuration = 180;

import { NextResponse } from "next/server";
import { createPrintifyAdapter } from "@/lib/ajax/adapters/printify";
import { enqueueApprovalVideos } from "@/lib/ajax/video/jobs";
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
      printifyProductId?: string;
      etsyListingId?: string;
    };
    if (!body.printifyProductId?.trim() || !body.etsyListingId?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Pass printifyProductId and etsyListingId." },
        { status: 400 },
      );
    }

    const printify = createPrintifyAdapter();
    const details = await printify.getProduct(body.printifyProductId.trim());
    const images = details.data.images ?? [];
    const front =
      images.find((i) => i.is_default) ??
      images.find((i) => (i.src ?? "").includes("camera_label=front")) ??
      images[0];
    if (!front?.src) {
      return NextResponse.json(
        { ok: false, error: "Product has no mockup image to render from." },
        { status: 422 },
      );
    }

    const imgRes = await fetch(front.src);
    if (!imgRes.ok) {
      throw new Error(`Mockup download failed (${imgRes.status}).`);
    }
    const mockupBuffer = Buffer.from(await imgRes.arrayBuffer());

    const queued = await enqueueApprovalVideos(supabase, {
      userId: user.id,
      mockupBuffer,
      title: details.data.title,
      etsyListingId: body.etsyListingId.trim(),
    });

    await supabase.from(TABLES.EVENTS).insert({
      user_id: user.id,
      event_type: queued.etsy ? "repair_video_queued" : "repair_video_skipped",
      message: queued.etsy
        ? `Fresh ${queued.style ?? "product"} video render queued from the repaired mockup for listing ${body.etsyListingId}.`
        : `Repair video NOT queued for listing ${body.etsyListingId}: ${queued.etsyError ?? "unknown"}.`,
      agent_slug: "pixel",
      room: "storefront",
      metadata: {
        etsyListingId: body.etsyListingId,
        printifyProductId: body.printifyProductId,
        ...queued,
      } as never,
    });

    return NextResponse.json({ ok: queued.etsy, ...queued });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "failed" },
      { status: 500 },
    );
  }
}
