/**
 * Posting-cadence policy — pure functions (no server-only import) so the
 * auto-poster's budgeting is unit-testable under node:test.
 *
 * Operator cadence: 5-7 posts/day. Pinterest thrives on that volume (pinners
 * post 5-15 pins/day); feed platforms like Instagram and TikTok read several
 * identical daily posts as spam, so they default to 2/day.
 */
import type { SocialPlatform } from "@/lib/social/ayrshare";

/** Platforms not listed here default to DEFAULT_PLATFORM_CAP per day.
 * tiktok 3 (2026-07-19 rebaseline: TikTok held 551 of 551 measured
 * impressions and all real engagement — it earns the extra daily slot;
 * costs nothing, reuses existing clips). */
const PLATFORM_CAP_DEFAULTS: Record<string, number> = { pinterest: 6, tiktok: 3 };
const DEFAULT_PLATFORM_CAP = 2;

/**
 * Per-platform daily post caps. Override via
 * SOCIAL_PLATFORM_CAPS="pinterest:6,instagram:2,tiktok:2".
 */
export function platformCaps(): Record<string, number> {
  const caps: Record<string, number> = { ...PLATFORM_CAP_DEFAULTS };
  const raw = process.env.SOCIAL_PLATFORM_CAPS?.trim();
  if (raw) {
    for (const part of raw.split(",")) {
      const [name, n] = part.split(":").map((s) => s.trim().toLowerCase());
      const num = Number(n);
      if (name && Number.isFinite(num) && num >= 0) caps[name] = num;
    }
  }
  return caps;
}

export function capFor(platform: string): number {
  return platformCaps()[platform.toLowerCase()] ?? DEFAULT_PLATFORM_CAP;
}

/** Platforms still under their daily cap given today's per-platform counts. */
export function duePlatforms(
  counts: Record<string, number>,
  platforms: SocialPlatform[],
): SocialPlatform[] {
  return platforms.filter((p) => (counts[p.toLowerCase()] ?? 0) < capFor(p));
}
