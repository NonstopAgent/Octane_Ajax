/**
 * Short-Form Video Playbook — the proven patterns Pixel builds every TikTok/Reels
 * video spec against. This is the "make the videos good" knowledge layer, the
 * video counterpart to the Etsy reviewer playbook. Deliberately generic to
 * short-form so it carries across shops and niches.
 *
 * Grounded in stable, widely-validated short-form best practices:
 *  - The first ~1.5 seconds decide retention — lead with the hook, no intro.
 *  - Vertical 9:16, shot full-frame; keep text inside the safe zone (platform UI
 *    covers the top ~12% and bottom ~18%, plus a right-edge action rail).
 *  - Fast beats: a visual/text change every ~2–3s keeps the scroll from winning.
 *  - Always-on captions/on-screen text — most feed views are muted.
 *  - A pattern interrupt around the midpoint (new angle, zoom, reveal) re-hooks.
 *  - Native trending audio > licensed music for reach; match energy to the niche.
 *  - CTA twice: a soft one mid-video, a clear one at the end ("link in bio").
 *  - Design for the loop — the last frame should invite an immediate replay.
 *  - Hashtags: a few broad-reach + a few niche + a few buyer-intent, not spammy.
 */

export const VIDEO_PLAYBOOK = {
  format: {
    aspectRatio: "9:16",
    targetDurationSec: 12,
    minDurationSec: 7,
    maxDurationSec: 21,
    beatMaxSec: 3, // change something at least this often
  },
  hook: {
    windowSec: 1.5,
    rules: [
      "Open on the hook — no logo, no intro, no slow build.",
      "Show the product or the payoff in frame one; say the promise in words one.",
      "Write 3 hook variants so the operator can A/B the thumbnail-stopper.",
    ],
    // Proven short-form hook formulas (fill with the product's niche/occasion).
    formulas: [
      "POV: {buyer} finds the perfect {occasion} gift",
      "If you love {niche}, stop scrolling",
      "The {product} nobody told you about",
      "3 reasons {buyer} are obsessed with this",
      "Tell me you're a {niche} without telling me…",
    ],
  },
  textOnScreen: {
    rules: [
      "Every shot carries short on-screen text (mute-first viewing).",
      "Keep captions inside the safe zone — clear of the top bar, bottom caption, and right action rail.",
      "One idea per card, ≤ 7 words, high-contrast, large.",
    ],
    // Fractions of frame kept clear of platform UI.
    safeZone: { top: 0.12, bottom: 0.18, right: 0.14 },
  },
  audio: {
    rules: [
      "Prefer native trending sound over licensed tracks for reach.",
      "Match energy to the niche — warm/emotional for memorial & gotcha-day, upbeat for humor.",
      "Sync a beat/cut to the hook and to the mid-video pattern interrupt.",
    ],
  },
  structure: [
    "Hook (0–1.5s): promise + product in frame.",
    "Context (1.5–5s): who it's for + the moment/occasion.",
    "Proof (5–9s): details, personalization, quality — one beat each.",
    "Pattern interrupt (~mid): new angle/zoom/reveal to re-hook.",
    "CTA (last 2–3s): clear ask + link-in-bio, on a loopable final frame.",
  ],
  cta: [
    "Give a soft mid-roll nudge and a clear end CTA.",
    "Use 'link in bio' language on-screen; never paste raw URLs over the video.",
    "Name the occasion urgency ('before their gotcha day') to drive the click.",
  ],
  hashtags: {
    total: { min: 8, max: 12 },
    mix: [
      "2–3 broad-reach tags (large but relevant)",
      "3–5 niche/community tags (where the real buyers are)",
      "2–3 buyer-intent/occasion tags (gift, gotcha day, etc.)",
    ],
  },
} as const;

export type VideoPlaybook = typeof VIDEO_PLAYBOOK;
