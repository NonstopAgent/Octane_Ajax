/**
 * Video Spec — turns a product into a concrete, playbook-grounded 9:16 short-form
 * video plan: hook variants, a timed shotlist (on-screen text + motion per beat),
 * audio direction, CTA, and a hashtag mix. Deterministic and renderer-agnostic —
 * this is the production-ready plan any renderer (ffmpeg, a video API, or CapCut)
 * consumes. It does NOT itself produce an MP4.
 */
import { VIDEO_PLAYBOOK } from "@/lib/ajax/pixel/video-playbook";

export type ShotMotion =
  | "zoom_in"
  | "zoom_out"
  | "pan_left"
  | "pan_right"
  | "static";

export type VideoShot = {
  index: number;
  role: "hook" | "context" | "proof" | "interrupt" | "cta";
  source: { kind: "mockup"; imageIndex: number } | { kind: "text" };
  startSec: number;
  durationSec: number;
  onScreenText: string;
  motion: ShotMotion;
};

export type VideoSpec = {
  aspectRatio: "9:16";
  durationSec: number;
  hookVariants: string[];
  shots: VideoShot[];
  audio: { style: string; energy: "warm" | "upbeat" | "calm" };
  cta: string;
  captionStrategy: string;
  hashtags: string[];
  textSafeZone: { top: number; bottom: number; right: number };
  /** Honest status: the plan exists; no MP4 has been rendered from it yet. */
  renderStatus: "spec_only";
};

export type VideoSpecInput = {
  productTitle: string;
  niche?: string | null;
  format?: string | null;
  mockupCount?: number;
  productUrl?: string | null;
  hashtags?: string[];
};

const EMOTIONAL =
  /memorial|loss|rainbow bridge|gotcha|adoption|forever|in memory|senior|passed|remember/i;
const HUMOR = /funny|humor|humour|joke|sassy|snarky|meme|silly/i;

function detectOccasion(text: string): string | null {
  const t = text.toLowerCase();
  if (/gotcha|adoption/.test(t)) return "gotcha day";
  if (/memorial|loss|memory|rainbow bridge|passed/.test(t)) return "in their memory";
  if (/birthday|barkday/.test(t)) return "their birthday";
  if (/christmas|holiday|xmas/.test(t)) return "the holidays";
  return null;
}

function deriveBuyer(niche: string | null | undefined): string {
  const n = (niche ?? "").trim();
  if (!n) return "pet parents";
  // "rescue dog mom apparel" → "rescue dog moms"
  const core = n.replace(/\b(gift|gifts|apparel|shirt|mug|art|print|lovers?)\b/gi, "").trim();
  const base = core || n;
  return /s$/i.test(base) ? base : `${base}s`;
}

function fillHook(formula: string, vars: Record<string, string>): string {
  return formula.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "").replace(/\s+/g, " ").trim();
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Build a deterministic, playbook-grounded 9:16 video spec for a product. */
export function buildVideoSpec(input: VideoSpecInput): VideoSpec {
  const pb = VIDEO_PLAYBOOK;
  const title = input.productTitle.trim() || "this product";
  const niche = input.niche?.trim() || null;
  const buyer = deriveBuyer(niche);
  const occasion = detectOccasion(`${title} ${niche ?? ""}`);
  const product = niche ? `${niche} ${input.format ?? "gift"}` : input.format ?? "gift";
  const mockups = Math.max(0, input.mockupCount ?? 3);
  const img = (i: number) =>
    mockups > 0
      ? ({ kind: "mockup", imageIndex: i % mockups } as const)
      : ({ kind: "text" } as const);

  const energy: VideoSpec["audio"]["energy"] = EMOTIONAL.test(`${title} ${niche ?? ""}`)
    ? "warm"
    : HUMOR.test(`${title} ${niche ?? ""}`)
      ? "upbeat"
      : "calm";

  const hookVars = {
    buyer,
    niche: niche ?? "pets",
    occasion: occasion ?? "gift",
    product,
  };
  const hookVariants = pb.hook.formulas
    .map((f) => fillHook(f, hookVars))
    .filter((h) => h.length > 0)
    .slice(0, 3);

  // Number of proof beats scales with available mockups (1–3).
  const proofBeats = clamp(mockups > 0 ? mockups - 1 : 2, 1, 3);

  const shots: VideoShot[] = [];
  let t = 0;
  const push = (
    role: VideoShot["role"],
    dur: number,
    onScreenText: string,
    source: VideoShot["source"],
    motion: ShotMotion,
  ) => {
    const durationSec = Math.min(dur, pb.format.beatMaxSec);
    shots.push({
      index: shots.length,
      role,
      source,
      startSec: Math.round(t * 10) / 10,
      durationSec,
      onScreenText,
      motion,
    });
    t += durationSec;
  };

  push("hook", pb.hook.windowSec, hookVariants[0] ?? `Made for ${buyer}`, img(0), "zoom_in");
  push(
    "context",
    2.5,
    occasion ? `Made for ${buyer} — for ${occasion}` : `Made for ${buyer}`,
    img(1),
    "static",
  );
  const proofText = [
    "Personalized just for them",
    "Quality that lasts",
    "The detail people notice",
  ];
  for (let i = 0; i < proofBeats; i += 1) {
    push(
      "proof",
      2.5,
      proofText[i % proofText.length]!,
      img(2 + i),
      i % 2 === 0 ? "pan_left" : "zoom_in",
    );
  }
  push("interrupt", 2, "But here's the best part 👀", img(1), "zoom_in");
  const ctaText = occasion
    ? `Link in bio 🔗 before ${occasion}`
    : "Get yours 🔗 link in bio";
  push("cta", 2.5, ctaText, img(0), "zoom_out");

  const durationSec = clamp(
    Math.round(t),
    pb.format.minDurationSec,
    pb.format.maxDurationSec,
  );

  const audioStyle =
    energy === "warm"
      ? "warm, emotional trending sound; cut on the hook and the reveal"
      : energy === "upbeat"
        ? "upbeat trending sound; punchy cuts on the beat"
        : "gentle trending sound; steady, satisfying pacing";

  return {
    aspectRatio: "9:16",
    durationSec,
    hookVariants,
    shots,
    audio: { style: audioStyle, energy },
    cta: ctaText,
    captionStrategy:
      "Mute-first: every beat carries short, high-contrast on-screen text inside the safe zone; soft mid CTA, clear end CTA.",
    hashtags: (input.hashtags ?? []).slice(0, pb.hashtags.total.max),
    textSafeZone: pb.textOnScreen.safeZone,
    renderStatus: "spec_only",
  };
}
