/**
 * Listing Video — the autonomous "make a video and put it on the listing" step.
 * On approve, this renders a SQUARE (1:1) product clip from the mockup and
 * attaches it to the Etsy listing. Etsy strips audio and shows one 5–15s video,
 * so the render is 1:1 / ~10s. Best-effort and gated behind FAL_KEY: no key or
 * any failure simply skips the video — the listing still publishes with images.
 */
import { buildVideoSpec } from "@/lib/ajax/pixel/video-spec";
import {
  isVideoRenderConfigured,
  renderVideoAndWait,
} from "@/lib/ajax/video/fal-render";

type VideoUploader = {
  uploadListingVideo(
    listingId: string,
    videoBuffer: Buffer,
    filename: string,
    shopId: string,
    accessToken: string,
    name?: string,
  ): Promise<{ listing_video_id: string }>;
};

export type AttachListingVideoInput = {
  adapter: VideoUploader;
  listingId: string;
  shopId: string;
  accessToken: string;
  mockupBuffer: Buffer;
  title: string;
  niche?: string | null;
  fetchImpl?: typeof fetch;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type AttachListingVideoResult =
  | { ok: true; etsyVideoId: string; videoUrl: string }
  | { ok: false; skipped?: boolean; reason: string };

/** Render a 1:1 clip from the mockup and attach it to the Etsy listing. */
export async function renderAndAttachListingVideo(
  input: AttachListingVideoInput,
): Promise<AttachListingVideoResult> {
  if (!isVideoRenderConfigured()) {
    return { ok: false, skipped: true, reason: "FAL_KEY not set" };
  }
  try {
    const dataUri = `data:image/jpeg;base64,${input.mockupBuffer.toString(
      "base64",
    )}`;
    const spec = buildVideoSpec({
      productTitle: input.title,
      niche: input.niche ?? null,
      mockupCount: 1,
    });
    const render = await renderVideoAndWait(
      { imageUrl: dataUri, spec, aspectRatio: "1:1" },
      {
        fetchImpl: input.fetchImpl,
        maxWaitMs: input.maxWaitMs ?? 50000,
        pollIntervalMs: input.pollIntervalMs,
        sleep: input.sleep,
      },
    );
    if (render.status !== "completed" || !render.videoUrl) {
      return { ok: false, reason: render.error ?? `render ${render.status}` };
    }

    const doFetch = input.fetchImpl ?? fetch;
    const vidRes = await doFetch(render.videoUrl);
    if (!vidRes.ok) return { ok: false, reason: `download ${vidRes.status}` };
    const bytes = Buffer.from(await vidRes.arrayBuffer());

    const base =
      input.title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "product";
    const up = await input.adapter.uploadListingVideo(
      input.listingId,
      bytes,
      `${base}_video.mp4`,
      input.shopId,
      input.accessToken,
      `${input.title} video`.slice(0, 70),
    );
    return {
      ok: true,
      etsyVideoId: up.listing_video_id,
      videoUrl: render.videoUrl,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "attach error",
    };
  }
}
