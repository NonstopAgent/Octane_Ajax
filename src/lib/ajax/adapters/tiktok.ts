/**
 * TikTok / short-form social adapter — stub only.
 *
 * Server-side only. OAuth and posting must run on the server with
 * TIKTOK_* credentials — never in client bundles.
 */

import {
  type AdapterConfig,
  type AdapterResult,
  demoResult,
} from "@/lib/ajax/adapters/types";

export type TikTokMediaInput = {
  videoUrl?: string;
  imageUrls?: string[];
  durationSeconds?: number;
};

export type TikTokDraftPostInput = {
  caption: string;
  hashtags?: string[];
  media: TikTokMediaInput;
  privacyLevel?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY";
};

export type TikTokSchedulePostInput = TikTokDraftPostInput & {
  scheduledFor: string;
};

export type TikTokDraftPost = {
  postId: string;
  status: "draft";
  previewUrl: string;
};

export type TikTokScheduledPost = {
  postId: string;
  status: "scheduled";
  scheduledFor: string;
  previewUrl: string;
};

export interface TikTokAdapter {
  createDraftPost(
    input: TikTokDraftPostInput,
  ): Promise<AdapterResult<TikTokDraftPost>>;
  schedulePost(
    input: TikTokSchedulePostInput,
  ): Promise<AdapterResult<TikTokScheduledPost>>;
}

export function createDemoTikTokAdapter(
  _config?: AdapterConfig,
): TikTokAdapter {
  return {
    async createDraftPost(input) {
      const postId = `tt-draft-${crypto.randomUUID().slice(0, 8)}`;
      void input;
      return demoResult("TikTok draft post created in demo mode.", {
        postId,
        status: "draft",
        previewUrl: `https://demo.tiktok.octane/ajax/post/${postId}`,
      });
    },

    async schedulePost(input) {
      const postId = `tt-sched-${crypto.randomUUID().slice(0, 8)}`;
      return demoResult("TikTok post schedule simulated.", {
        postId,
        status: "scheduled",
        scheduledFor: input.scheduledFor,
        previewUrl: `https://demo.tiktok.octane/ajax/post/${postId}`,
      });
    },
  };
}

export const tiktokAdapter: TikTokAdapter = createDemoTikTokAdapter();
