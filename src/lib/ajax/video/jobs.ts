/**
 * Video Jobs — async render queue. Enqueue on approve, then drain (from a poll
 * endpoint while the operator is active, plus a daily cron backstop): poll fal by
 * request_id and, when a render finishes, attach it to the Etsy listing or post
 * it to social with the listing link. Every DB/render call is guarded so a
 * missing table or a bad job never breaks the batch.
 */
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";
import {
  pollVideoRender,
  submitVideoRender,
  isVideoRenderConfigured,
  type RenderResult,
} from "@/lib/ajax/video/fal-render";
import { buildVideoSpec } from "@/lib/ajax/pixel/video-spec";
import { refreshEtsyToken } from "@/lib/ajax/etsy-auth";
import { createEtsyAdapter } from "@/lib/ajax/adapters/etsy";
// ayrshare is server-only; import it lazily so this module loads under node:test.
import type { SocialPlatform } from "@/lib/social/ayrshare";

export type VideoJobKind = "etsy_listing" | "social";

export type EnqueueVideoJobInput = {
  userId: string;
  businessId?: string | null;
  kind: VideoJobKind;
  requestId: string;
  etsyListingId?: string | null;
  postText?: string | null;
  platforms?: string[] | null;
};

/** Insert a pending render job. Never throws — returns ok:false on failure. */
export async function enqueueVideoJob(
  supabase: Supabase,
  input: EnqueueVideoJobInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from(TABLES.VIDEO_JOBS).insert({
      user_id: input.userId,
      business_id: input.businessId ?? null,
      kind: input.kind,
      request_id: input.requestId,
      status: "pending",
      etsy_listing_id: input.etsyListingId ?? null,
      post_text: input.postText ?? null,
      platforms: input.platforms ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "enqueue failed",
    };
  }
}

/** How many drain passes a job may stay pending before we give up (~ minutes). */
const MAX_ATTEMPTS = 60;

type VideoJobRow = {
  id: string;
  kind: string;
  request_id: string;
  etsy_listing_id: string | null;
  post_text: string | null;
  platforms: string[] | null;
  attempts: number;
};

export type DrainDeps = {
  poll?: (requestId: string) => Promise<RenderResult>;
  refreshTokenFn?: typeof refreshEtsyToken;
  createAdapter?: typeof createEtsyAdapter;
  publish?: typeof import("@/lib/social/ayrshare").publishPost;
  fetchImpl?: typeof fetch;
};

export type DrainSummary = {
  processed: number;
  done: number;
  failed: number;
  stillPending: number;
};

async function markJob(
  supabase: Supabase,
  id: string,
  status: "done" | "failed",
  lastError: string | null,
  videoUrl?: string,
): Promise<void> {
  await supabase
    .from(TABLES.VIDEO_JOBS)
    .update({
      status,
      last_error: lastError,
      ...(videoUrl ? { video_url: videoUrl } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function completeEtsy(
  supabase: Supabase,
  userId: string,
  job: VideoJobRow,
  videoUrl: string,
  deps: DrainDeps,
  doFetch: typeof fetch,
): Promise<{ ok: boolean; error?: string }> {
  if (!job.etsy_listing_id) return { ok: false, error: "missing etsy_listing_id" };
  const refreshTokenFn = deps.refreshTokenFn ?? refreshEtsyToken;
  const createAdapter = deps.createAdapter ?? createEtsyAdapter;
  const creds = await refreshTokenFn(userId, { supabase });
  if (!creds) return { ok: false, error: "etsy not connected" };
  const vidRes = await doFetch(videoUrl);
  if (!vidRes.ok) return { ok: false, error: `download ${vidRes.status}` };
  const bytes = Buffer.from(await vidRes.arrayBuffer());
  const adapter = createAdapter();
  await adapter.uploadListingVideo(
    job.etsy_listing_id,
    bytes,
    "listing_video.mp4",
    creds.shop_id,
    creds.access_token,
    "Product video",
  );
  return { ok: true };
}

async function completeSocial(
  job: VideoJobRow,
  videoUrl: string,
  deps: DrainDeps,
): Promise<{ ok: boolean; error?: string }> {
  let publish = deps.publish;
  let platforms = (job.platforms ?? []) as SocialPlatform[];
  if (!publish || platforms.length === 0) {
    const ayr = await import("@/lib/social/ayrshare");
    publish = publish ?? ayr.publishPost;
    if (platforms.length === 0) platforms = ayr.defaultPlatforms();
  }
  const result = await publish({
    post: job.post_text ?? "New drop 🐾",
    platforms,
    mediaUrls: [videoUrl],
    isVideo: true,
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** Poll pending jobs and finish the ones whose render is done. */
export async function drainVideoJobs(
  supabase: Supabase,
  userId: string,
  deps: DrainDeps = {},
): Promise<DrainSummary> {
  const poll =
    deps.poll ??
    ((id: string) => pollVideoRender(id, { fetchImpl: deps.fetchImpl }));
  const doFetch = deps.fetchImpl ?? fetch;
  const summary: DrainSummary = {
    processed: 0,
    done: 0,
    failed: 0,
    stillPending: 0,
  };

  const { data: jobs } = await supabase
    .from(TABLES.VIDEO_JOBS)
    .select(
      "id, kind, request_id, etsy_listing_id, post_text, platforms, attempts",
    )
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);

  for (const raw of (jobs ?? []) as unknown as VideoJobRow[]) {
    summary.processed += 1;
    try {
      const r = await poll(raw.request_id);
      if (r.status === "pending") {
        const attempts = (raw.attempts ?? 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await markJob(supabase, raw.id, "failed", "render timed out");
          summary.failed += 1;
        } else {
          await supabase
            .from(TABLES.VIDEO_JOBS)
            .update({ attempts, updated_at: new Date().toISOString() })
            .eq("id", raw.id);
          summary.stillPending += 1;
        }
        continue;
      }
      if (r.status !== "completed" || !r.videoUrl) {
        await markJob(supabase, raw.id, "failed", r.error ?? "render failed");
        summary.failed += 1;
        continue;
      }
      const outcome =
        raw.kind === "social"
          ? await completeSocial(raw, r.videoUrl, deps)
          : await completeEtsy(supabase, userId, raw, r.videoUrl, deps, doFetch);
      if (outcome.ok) {
        await markJob(supabase, raw.id, "done", null, r.videoUrl);
        summary.done += 1;
      } else {
        await markJob(supabase, raw.id, "failed", outcome.error ?? "failed");
        summary.failed += 1;
      }
    } catch (err) {
      await markJob(
        supabase,
        raw.id,
        "failed",
        err instanceof Error ? err.message : "drain error",
      );
      summary.failed += 1;
    }
  }
  return summary;
}

/**
 * On approve: submit the render(s) and enqueue jobs (no waiting). Default is
 * listing-only — a 1:1 clip for the Etsy listing. The 9:16 social clip is added
 * only when the operator opts in (SOCIAL_VIDEO_AUTOPOST=true) AND Ayrshare is
 * connected. Each render is billed separately (~$0.30).
 */
export async function enqueueApprovalVideos(
  supabase: Supabase,
  input: {
    userId: string;
    businessId?: string | null;
    mockupBuffer: Buffer;
    title: string;
    niche?: string | null;
    etsyListingId: string;
    listingUrl?: string | null;
    hashtags?: string[];
  },
): Promise<{ etsy: boolean; social: boolean; etsyError?: string }> {
  const out: { etsy: boolean; social: boolean; etsyError?: string } = {
    etsy: false,
    social: false,
  };
  if (!isVideoRenderConfigured()) {
    out.etsyError = "FAL_KEY not configured";
    return out;
  }

  const dataUri = `data:image/jpeg;base64,${input.mockupBuffer.toString(
    "base64",
  )}`;
  const spec = buildVideoSpec({
    productTitle: input.title,
    niche: input.niche ?? null,
    mockupCount: 1,
  });

  const etsySubmit = await submitVideoRender({
    imageUrl: dataUri,
    spec,
    aspectRatio: "1:1",
  });
  if (etsySubmit.ok && etsySubmit.requestId) {
    const e = await enqueueVideoJob(supabase, {
      userId: input.userId,
      businessId: input.businessId,
      kind: "etsy_listing",
      requestId: etsySubmit.requestId,
      etsyListingId: input.etsyListingId,
    });
    out.etsy = e.ok;
    if (!e.ok) out.etsyError = "video_jobs insert failed";
  } else {
    // Surface WHY fal declined — silent submit failures hid a fully dead
    // render pipeline for days.
    out.etsyError = etsySubmit.error ?? "fal submit failed";
  }

  // Social auto-post is OFF by default (listing video is the point). It fires
  // only when the operator opts in with SOCIAL_VIDEO_AUTOPOST=true AND Ayrshare
  // is connected — so connecting social for manual posting won't silently start
  // spending a second render per approval.
  let socialOn = false;
  if (process.env.SOCIAL_VIDEO_AUTOPOST === "true") {
    try {
      socialOn = (await import("@/lib/social/ayrshare")).isSocialConfigured();
    } catch {
      socialOn = false;
    }
  }
  if (socialOn) {
    const socialSubmit = await submitVideoRender({
      imageUrl: dataUri,
      spec,
      aspectRatio: "9:16",
    });
    if (socialSubmit.ok && socialSubmit.requestId) {
      const tagLine = (input.hashtags ?? [])
        .map((h) => (h.startsWith("#") ? h : `#${h}`))
        .join(" ");
      const post = [
        input.title,
        input.listingUrl ? `Shop it 🔗 ${input.listingUrl}` : "",
        tagLine,
      ]
        .filter(Boolean)
        .join("\n\n");
      const s = await enqueueVideoJob(supabase, {
        userId: input.userId,
        businessId: input.businessId,
        kind: "social",
        requestId: socialSubmit.requestId,
        postText: post,
      });
      out.social = s.ok;
    }
  }

  return out;
}
