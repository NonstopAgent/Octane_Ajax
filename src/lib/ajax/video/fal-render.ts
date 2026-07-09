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
const DEFAULT_MODEL = "fal-ai/kling-video/v1/standard/image-to-video";

export type FalInput = {
  prompt: string;
  image_url: string;
  duration: "5" | "10";
  aspect_ratio: "9:16" | "16:9" | "1:1";
};

export type RenderStatus = "pending" | "completed" | "failed";

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
 * Map a video spec + mockup into a fal image-to-video request. Keeps the product
 * faithful (no hallucinated redesign) and forces vertical 9:16 short-form framing.
 */
export function buildFalInput(
  spec: VideoSpec,
  imageUrl: string,
  aspectRatio: FalInput["aspect_ratio"] = "9:16",
): FalInput {
  // Defensive: the route may pass a partial spec from external JSON.
  const hook = spec.hookVariants?.[0] ?? "";
  const motion = spec.shots?.[0]?.motion ?? "zoom_in";
  const energy = spec.audio?.energy ?? "calm";
  const durationSec = spec.durationSec ?? 10;
  const motionWords: Record<string, string> = {
    zoom_in: "slow push-in",
    zoom_out: "gentle pull-back",
    pan_left: "smooth left pan",
    pan_right: "smooth right pan",
    static: "subtle parallax",
  };
  const prompt = [
    `Product marketing clip for social. ${hook}`.trim(),
    `Camera: ${motionWords[motion] ?? "subtle motion"}, cinematic but understated.`,
    "Keep the product, artwork, and any text/logo EXACTLY as shown — do not redesign, restyle, or add objects.",
    `Mood: ${energy}. Vertical 9:16 short-form product ad.`,
  ].join(" ");

  return {
    prompt,
    image_url: imageUrl,
    duration: durationSec >= 8 ? "10" : "5",
    aspect_ratio: aspectRatio,
  };
}

/** Submit a render job to the fal queue; returns a request_id to poll. */
export async function submitVideoRender(
  args: {
    imageUrl: string;
    spec: VideoSpec;
    aspectRatio?: FalInput["aspect_ratio"];
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
        buildFalInput(args.spec, args.imageUrl, args.aspectRatio),
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
      // Only the two documented in-flight states count as pending. Anything
      // else (FAILED, a 4xx, an unknown shape) is terminal — never let a bad
      // response masquerade as "still rendering" again.
      const stillRunning =
        statusRes.ok && (s === "IN_QUEUE" || s === "IN_PROGRESS");
      return {
        ok: stillRunning,
        status: stillRunning ? "pending" : "failed",
        requestId,
        model,
        error: stillRunning
          ? undefined
          : statusJson.detail ||
            `fal status ${statusRes.status}${s ? ` (${s})` : ""}`,
      };
    }
    const resultRes = await doFetch(
      `${FAL_QUEUE_BASE}/${requestBase}/requests/${requestId}`,
      { headers: authHeaders(), signal: AbortSignal.timeout(15000) },
    );
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
    return {
      ok: false,
      status: "failed",
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
