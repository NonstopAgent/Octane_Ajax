import "server-only";

/**
 * Ayrshare social-publishing adapter. One API key posts to every linked network
 * (Instagram, Facebook, Pinterest, TikTok, etc.) — no per-platform app review.
 *
 * Setup (operator): create an Ayrshare account, link your social accounts in
 * their dashboard, then add AYRSHARE_API_KEY to the Vercel environment.
 * Optionally set SOCIAL_PLATFORMS (comma-separated) to control where posts go.
 * Per-business posting maps to Ayrshare "User Profiles" via a Profile-Key.
 */

const AYRSHARE_URL =
  process.env.AYRSHARE_API_URL?.trim() || "https://api.ayrshare.com/api/post";

export type SocialPlatform =
  | "instagram"
  | "facebook"
  | "pinterest"
  | "tiktok"
  | "twitter"
  | "linkedin"
  | "youtube"
  | "threads"
  | "bluesky";

export function socialApiKey(): string | undefined {
  return process.env.AYRSHARE_API_KEY?.trim();
}

export function isSocialConfigured(): boolean {
  return Boolean(socialApiKey());
}

/** Platforms to publish to — SOCIAL_PLATFORMS env (comma-separated) or a default. */
export function defaultPlatforms(): SocialPlatform[] {
  const raw = process.env.SOCIAL_PLATFORMS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean) as SocialPlatform[];
  }
  return ["instagram", "facebook", "pinterest"];
}

export type PublishedPost = {
  platform: string;
  postUrl?: string;
  status: string;
};

export type PublishResult = {
  ok: boolean;
  ayrsharePostId?: string;
  posts?: PublishedPost[];
  error?: string;
};

/** Publishes a post to the linked social networks via Ayrshare. Never throws. */
export async function publishPost(input: {
  post: string;
  platforms: SocialPlatform[];
  mediaUrls?: string[];
  isVideo?: boolean;
  profileKey?: string | null;
}): Promise<PublishResult> {
  const key = socialApiKey();
  if (!key) {
    return {
      ok: false,
      error:
        "Social publishing not connected. Add AYRSHARE_API_KEY to the environment.",
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  // Ayrshare Business: posts target the Primary Profile by default. If the
  // operator linked their socials under a User Profile instead, set
  // AYRSHARE_PROFILE_KEY and every post routes there — no relinking needed.
  const profileKey =
    input.profileKey ?? process.env.AYRSHARE_PROFILE_KEY?.trim() ?? null;
  if (profileKey) headers["Profile-Key"] = profileKey;

  const body: Record<string, unknown> = {
    post: input.post,
    platforms: input.platforms,
  };
  if (input.mediaUrls && input.mediaUrls.length > 0) {
    body.mediaUrls = input.mediaUrls;
    if (input.isVideo) body.isVideo = true;
  }

  try {
    const res = await fetch(AYRSHARE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      id?: string;
      postIds?: { platform?: string; postUrl?: string; status?: string }[];
      errors?: { message?: string; platform?: string }[];
    };

    const errMsg = json.errors
      ?.map((e) => `${e.platform ?? "?"}: ${e.message ?? "error"}`)
      .join("; ");
    const posts = (json.postIds ?? [])
      .map((p) => ({
        platform: p.platform ?? "",
        postUrl: p.postUrl,
        status: p.status ?? "",
      }))
      .filter((p) => p.status.toLowerCase() !== "error");

    // PARTIAL SUCCESS IS SUCCESS. Ayrshare posts to the platforms it can and
    // errors the rest (e.g. TikTok rejects PNG while Pinterest+IG publish).
    // Treating that as failure made the poster RETRY the whole job — which
    // re-posted identical pins to the platforms that had already accepted it.
    if (posts.length > 0) {
      return {
        ok: true,
        ayrsharePostId: json.id,
        posts,
        error: errMsg || undefined,
      };
    }

    if (!res.ok || json.status === "error") {
      return { ok: false, error: errMsg || `Ayrshare error (${res.status}).` };
    }

    return { ok: true, ayrsharePostId: json.id, posts };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error posting to social.",
    };
  }
}
