/**
 * Video Render Adapter — turns a product mockup + video spec into a real MP4 via
 * fal.ai's image-to-video queue API. Provider-agnostic in shape and DORMANT until
 * FAL_KEY is set (mirrors the social adapter): no key = no calls, no cost.
 *
 * Why image-to-video (not text-to-video): it animates the operator's ACTUAL mockup,
 * so the exact design/text/logo is preserved — text-to-video would invent a product
 * we don't sell. The prompt explicitly instructs the model to keep the product intact.
 *
 * fal contract (see docs): submit POST https://queue.fal.run/<model> with
 * `Authorization: Key <FAL_KEY>` → { request_id }; poll
 * .../requests/<id>/status → { status }; result .../requests/<id> → { video:{ url } }.
 */
import type { VideoSpec } from "@/lib/ajax/pixel/video-spec";

const FAL_QUEUE_BASE = "https://queue.fal.run";
// v1.6 tracks the conditioning image much more faithfully than v1 — v1 clips
// started fine then MORPHED the product in the back half. Same queue base
// ("fal-ai/kling-video"), so status/result polling is unaffected.
const DEFAULT_MODEL = "fal-ai/kling-video/v1.6/standard/image-to-video";

export type FalInput = {
  prompt: string;
  image_url: string;
  duration: "5" | "10";
  aspect_ratio: "9:16" | "16:9" | "1:1";
  negative_prompt: string;
  cfg_scale: number;
};

/**
 * "unknown" (2026-07-25 audit, H14): fal was unreachable or rate-limited us —
 * the render itself may be FINE. Treating that as "failed" permanently
 * discarded paid renders (~$0.35 each) over a single 429, and the freshness
 * medic then paid AGAIN to re-render. Callers treat unknown like pending.
 */
export type RenderStatus = "pending" | "completed" | "failed" | "unknown";

export type RenderResult = {
  ok: boolean;
  status: RenderStatus;
  requestId?: string;
  videoUrl?: string | null;
  model: string;
  error?: string;
};

type FetchImpl = typeof fetch;

export function isVideoRenderConfigured(): boolean {
  return Boolean(process.env.FAL_KEY?.trim());
}

function videoModel(): string {
  return process.env.FAL_VIDEO_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * fal's queue REQUEST endpoints (status/result) live under the BASE app id —
 * the first two path segments (e.g. "fal-ai/kling-video") — NOT the full
 * model subpath used for submission. Polling the subpath 404s, which made
 * every render look pending forever (jobs died at max attempts with the MP4
 * sitting finished on fal's side).
 */
export function falRequestBase(model: string): string {
  const segments = model.split("/").filter(Boolean);
  return segments.slice(0, 2).join("/");
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${process.env.FAL_KEY?.trim() ?? ""}`,
    "Content-Type": "application/json",
  };
}

/**
 * Map a video spec + mockup into a fal image-to-video request. Anti-morph
 * hardening (operator saw clips start fine then mutate the product):
 *   - 5s ONLY — kling drifts from the conditioning image in the back half of
 *     10s clips; every extra second is drift budget.
 *   - CAMERA-ONLY prompt. The marketing hook text is deliberately EXCLUDED:
 *     feeding "Celebrate your rescue dog's gotcha day" to an i2v model makes
 *     it try to ANIMATE that story (spawning dogs, remolding the mug). The
 *     hook belongs in the caption, not the render.
 *   - negative_prompt against morphing/warping/new objects.
 *   - cfg_scale 0.7 (> 0.5 default) for tighter prompt/source adherence.
 */
export function buildFalInput(
  spec: VideoSpec,
  imageUrl: string,
  aspectRatio: FalInput["aspect_ratio"] = "9:16",
  /**
   * "product": flat catalog shot — camera motion only, nothing may live.
   * "lifestyle": the source frame is a real-life scene (worn garment, mug on
   * a table, framed print) — allow subtle ambient life while the product's
   * printed design stays rigid. Zoom-only clips of catalog photos looked
   * like nobody tried; scene sources + gentle life is the fix.
   */
  style: "product" | "lifestyle" = "product",
): FalInput {
  // Defensive: the route may pass a partial spec from external JSON.
  const motion = spec.shots?.[0]?.motion ?? "zoom_in";
  const energy = spec.audio?.energy ?? "calm";
  const motionWords: Record<string, string> = {
    zoom_in: "slow smooth camera push-in",
    zoom_out: "gentle camera pull-back",
    pan_left: "slow left camera pan",
    pan_right: "slow right camera pan",
    static: "nearly still camera with subtle parallax",
  };
  const prompt =
    style === "lifestyle"
      ? [
          "Cozy lifestyle video of this exact scene, filmed like a warm home moment.",
          `Gentle camera move: ${motionWords[motion] ?? "slow smooth push-in"}, cinematic, understated.`,
          "Subtle natural life only: soft light shifting, steam curling, fabric settling, calm slow breathing — nothing sudden, no one enters or leaves.",
          "The product and its printed design stay perfectly rigid and unchanged — same artwork, same text, same colors, first frame to last frame.",
          `Warm ${energy} mood. Feels like a real moment at home, not a catalog.`,
        ].join(" ")
      : [
          "Studio product video of this exact physical product, photographed as-is.",
          `Camera motion ONLY: ${motionWords[motion] ?? "subtle camera motion"}, cinematic, understated.`,
          "The product itself stays perfectly still and rigid — same shape, same printed artwork, same text, same colors, first frame to last frame.",
          "No new objects, no hands, no people, no animals, no scene changes.",
          `Soft ${energy} lighting mood. Vertical 9:16 product ad.`,
        ].join(" ");

  return {
    prompt,
    image_url: imageUrl,
    // Hard cap at 5s regardless of the spec's storyboard length.
    duration: "5",
    aspect_ratio: aspectRatio,
    // Text hardening (2026-07-17): the operator caught published videos with
    // blurred/garbled printed text. Every text-failure mode is named.
    negative_prompt:
      style === "lifestyle"
        ? "morphing, warping, deforming, melting, product changing shape, text changing or dissolving, garbled text, warped letters, misspelled words, blurry text, unreadable lettering, artwork mutating, scene change, camera cut, people appearing or leaving, distorted faces, extra limbs, glitch, distortion, blur, low quality"
        : "morphing, warping, deforming, melting, product changing shape, text changing or dissolving, garbled text, warped letters, misspelled words, blurry text, unreadable lettering, artwork mutating, objects appearing, hands, people, animals, scene change, camera cut, glitch, distortion, blur, low quality",
    cfg_scale: 0.7,
  };
}

/** Submit a render job to the fal queue; returns a request_id to poll. */
export async function submitVideoRender(
  args: {
    imageUrl: string;
    spec: VideoSpec;
    aspectRatio?: FalInput["aspect_ratio"];
    style?: "product" | "lifestyle";
  },
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<RenderResult> {
  const model = videoModel();
  if (!isVideoRenderConfigured()) {
    return { ok: false, status: "failed", model, error: "FAL_KEY not set." };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${FAL_QUEUE_BASE}/${model}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(
        buildFalInput(args.spec, args.imageUrl, args.aspectRatio, args.style),
      ),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      request_id?: string;
      detail?: string;
    };
    if (!res.ok || !json.request_id) {
      return {
        ok: false,
        status: "failed",
        model,
        error: json.detail || `fal submit failed (${res.status}).`,
      };
    }
    return { ok: true, status: "pending", requestId: json.request_id, model };
  } catch (err) {
    return {
      ok: false,
      status: "failed",
      model,
      error: err instanceof Error ? err.message : "fal submit error",
    };
  }
}

/** Poll a render job; returns the MP4 URL once completed. */
export async function pollVideoRender(
  requestId: string,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<RenderResult> {
  const model = videoModel();
  if (!isVideoRenderConfigured()) {
    return { ok: false, status: "failed", model, error: "FAL_KEY not set." };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const requestBase = falRequestBase(model);
  try {
    const statusRes = await doFetch(
      `${FAL_QUEUE_BASE}/${requestBase}/requests/${requestId}/status`,
      { headers: authHeaders(), signal: AbortSignal.timeout(15000) },
    );
    const statusJson = (await statusRes.json().catch(() => ({}))) as {
      status?: string;
      detail?: string;
    };
    const s = (statusJson.status ?? "").toUpperCase();
    if (s !== "COMPLETED") {
      // Only the two documented in-flight states count as pending; a real
      // FAILED (or any other 2xx state we don't recognize) is terminal.
      // But "fal said FAILED" and "we couldn't reach fal" are different
      // things (H14): a 429/5xx means WE got throttled while the render may
      // be fine — that's "unknown", retried next drain, never terminal.
      const stillRunning =
        statusRes.ok && (s === "IN_QUEUE" || s === "IN_PROGRESS");
      if (stillRunning) {
        return { ok: true, status: "pending", requestId, model };
      }
      const transient =
        !statusRes.ok && (statusRes.status === 429 || statusRes.status >= 500);
      return {
        ok: false,
        status: transient ? "unknown" : "failed",
        requestId,
        model,
        error:
          statusJson.detail ||
          `fal status ${statusRes.status}${s ? ` (${s})` : ""}`,
      };
    }
    const resultRes = await doFetch(
      `${FAL_QUEUE_BASE}/${requestBase}/requests/${requestId}`,
      { headers: authHeaders(), signal: AbortSignal.timeout(15000) },
    );
    if (!resultRes.ok) {
      // COMPLETED but the result fetch bounced — the MP4 exists and is paid
      // for; a throttled result fetch must not discard it (H14).
      const transient = resultRes.status === 429 || resultRes.status >= 500;
      return {
        ok: false,
        status: transient ? "unknown" : "failed",
        requestId,
        model,
        error: `fal result fetch ${resultRes.status}`,
      };
    }
    const resultJson = (await resultRes.json().catch(() => ({}))) as {
      video?: { url?: string };
    };
    const videoUrl = resultJson.video?.url ?? null;
    return {
      ok: Boolean(videoUrl),
      status: videoUrl ? "completed" : "failed",
      requestId,
      videoUrl,
      model,
      error: videoUrl ? undefined : "fal completed without a video URL.",
    };
  } catch (err) {
    // Network error / our own 15s timeout — we know nothing about the render.
    return {
      ok: false,
      status: "unknown",
      requestId,
      model,
      error: err instanceof Error ? err.message : "fal poll error",
    };
  }
}

/** Submit then poll within a time budget. Returns the MP4 if ready, else pending. */
export async function renderVideoAndWait(
  args: {
    imageUrl: string;
    spec: VideoSpec;
    aspectRatio?: FalInput["aspect_ratio"];
  },
  opts: {
    fetchImpl?: FetchImpl;
    maxWaitMs?: number;
    pollIntervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<RenderResult> {
  const submitted = await submitVideoRender(args, opts);
  if (!submitted.ok || !submitted.requestId) return submitted;

  const maxWaitMs = opts.maxWaitMs ?? 45000;
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const deadline = Date.now() + maxWaitMs;
  let last: RenderResult = submitted;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    last = await pollVideoRender(submitted.requestId, opts);
    if (last.status === "completed" || last.status === "failed") return last;
  }
  return { ...last, status: "pending", requestId: submitted.requestId };
}
