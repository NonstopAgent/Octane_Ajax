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

/**
 * Posting window (2026-07-20): the hourly cron was firing around the clock,
 * landing posts at 2-3 AM Central — dead air for a US pet-parent audience,
 * and the operator flagged the "weird schedules". Posts now only go out
 * during US engagement hours; staged jobs simply wait for the next window.
 *
 * Defaults: 8 AM - 10 PM America/Chicago (DST-aware via Intl). Override with
 * SOCIAL_POSTING_WINDOW="8-22" (local hours) and SOCIAL_POSTING_TZ.
 */
export const POSTING_TIMEZONE_DEFAULT = "America/Chicago";
const POSTING_WINDOW_START_DEFAULT = 8;
const POSTING_WINDOW_END_DEFAULT = 22;

export function localHour(now: Date, timeZone: string): number {
  try {
    const text = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now);
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return ((parsed % 24) + 24) % 24;
  } catch {
    // fall through to UTC below (bad TZ string must not kill the poster)
  }
  return now.getUTCHours();
}

export function postingWindow(): { startHour: number; endHour: number } {
  const raw = process.env.SOCIAL_POSTING_WINDOW?.trim();
  const match = raw?.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (match) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start >= 0 && start <= 23 && end >= 0 && end <= 24 && start !== end) {
      return { startHour: start, endHour: end };
    }
  }
  return {
    startHour: POSTING_WINDOW_START_DEFAULT,
    endHour: POSTING_WINDOW_END_DEFAULT,
  };
}

/**
 * Media freshness epoch (2026-07-21): the poster was attaching videos
 * rendered 2026-07-14 — BEFORE the store repair and the scene-QA gate — so
 * TikTok kept showing pre-repair designs a week later. Anything rendered
 * before this instant is untrusted as social media. Override with
 * SOCIAL_VIDEO_FRESH_AFTER (ISO timestamp).
 */
export function videoFreshEpoch(): string {
  const raw = process.env.SOCIAL_VIDEO_FRESH_AFTER?.trim();
  if (raw && !Number.isNaN(Date.parse(raw))) return raw;
  return "2026-07-17T00:00:00Z";
}

/** True when `now` falls inside the local posting window (handles windows that wrap midnight). */
export function isWithinPostingWindow(now: Date = new Date()): boolean {
  const { startHour, endHour } = postingWindow();
  const timeZone =
    process.env.SOCIAL_POSTING_TZ?.trim() || POSTING_TIMEZONE_DEFAULT;
  const hour = localHour(now, timeZone);
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}
