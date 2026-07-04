"use client";

import { useCallback, useEffect, useState } from "react";
import type { TikTokQueueRow } from "@/lib/ajax/tiktok/types";
import { mapTikTokQueueRow } from "@/lib/ajax/tiktok/types";
import { useAjaxRealtime } from "@/hooks/useAjaxRealtime";
import { createClient } from "@/lib/supabase/client";
import type { TikTokQueue } from "@/lib/supabase/database.types";
import { TABLES } from "@/lib/supabase/schema";

type TikTokQueuePanelProps = {
  enabled: boolean;
  initialItems?: TikTokQueueRow[];
};

function formatCaptionForCopy(item: TikTokQueueRow): string {
  const tags = item.hashtags.join(" ");
  return `${item.caption}\n\n${tags}`.trim();
}

function mockupLabel(url: string, index: number): string {
  if (url.startsWith("demo://")) {
    return `Mockup ${index + 1} (demo)`;
  }
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").pop() || `Mockup ${index + 1}`;
  } catch {
    return `Mockup ${index + 1}`;
  }
}

/** TikTok Marketing Bay — pending slideshow packages for manual posting. */
export function TikTokQueuePanel({
  enabled,
  initialItems = [],
}: TikTokQueuePanelProps) {
  const [items, setItems] = useState<TikTokQueueRow[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [livePostingId, setLivePostingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [videos, setVideos] = useState<
    Record<string, { status: string; url?: string; requestId?: string }>
  >({});

  const publishNow = useCallback(async (item: TikTokQueueRow) => {
    setLivePostingId(item.id);
    setNotice(null);
    try {
      const res = await fetch("/api/ajax/social/publish", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueId: item.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        posts?: { platform: string; postUrl?: string }[];
      };
      if (!res.ok || !data.ok) {
        setNotice({ ok: false, text: data.error ?? "Publish failed." });
        return;
      }
      const where = (data.posts ?? [])
        .map((p) => p.platform)
        .filter(Boolean)
        .join(", ");
      setNotice({ ok: true, text: where ? `Posted to ${where}.` : "Posted." });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch {
      setNotice({ ok: false, text: "Network error while publishing." });
    } finally {
      setLivePostingId(null);
    }
  }, []);

  const renderVideo = useCallback(
    async (item: TikTokQueueRow) => {
      setRenderingId(item.id);
      setNotice(null);
      try {
        const prior = videos[item.id];
        const body = prior?.requestId
          ? { requestId: prior.requestId }
          : { queueId: item.id };
        const res = await fetch("/api/ajax/video/render", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: string;
          videoUrl?: string | null;
          requestId?: string;
          error?: string;
        };
        if (!res.ok || data.status === "failed") {
          setNotice({ ok: false, text: data.error ?? "Video render failed." });
          return;
        }
        if (data.status === "completed" && data.videoUrl) {
          const url = data.videoUrl;
          setVideos((v) => ({ ...v, [item.id]: { status: "completed", url } }));
          setNotice({ ok: true, text: "Video ready 🎬" });
        } else {
          setVideos((v) => ({
            ...v,
            [item.id]: { status: "pending", requestId: data.requestId },
          }));
          setNotice({ ok: true, text: "Still rendering — click Check in ~30s." });
        }
      } catch {
        setNotice({ ok: false, text: "Network error while rendering." });
      } finally {
        setRenderingId(null);
      }
    },
    [videos],
  );

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from(TABLES.TIKTOK_QUEUE)
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) {
        console.error("[TikTokQueuePanel] fetch failed", error);
        return;
      }

      setItems((data ?? []).map((row) => mapTikTokQueueRow(row as TikTokQueue)));
    } finally {
      setLoading(false);
    }
  }, []);

  useAjaxRealtime({
    enabled,
    onRefresh: loadItems,
    debounceMs: 350,
  });

  useEffect(() => {
    if (enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch-on-enable
      void loadItems();
    }
  }, [enabled, loadItems]);

  const markPosted = useCallback(async (id: string) => {
    setPostingId(id);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from(TABLES.TIKTOK_QUEUE)
        .update({ status: "posted" })
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) {
        console.error("[TikTokQueuePanel] mark posted failed", error);
        return;
      }

      setItems((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setPostingId(null);
    }
  }, []);

  const copyCaption = useCallback(async (item: TikTokQueueRow) => {
    try {
      await navigator.clipboard.writeText(formatCaptionForCopy(item));
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("[TikTokQueuePanel] copy failed", err);
    }
  }, []);

  return (
    <section className="sweatshop-bay flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <header className="border-b border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-950 to-zinc-900 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-500/80">
              Room 3 · Marketing Bay
            </p>
            <h2 className="font-mono text-sm font-bold text-zinc-100">
              TikTok queue
            </h2>
            <p className="mt-1 font-mono text-[11px] text-zinc-500">
              Promo packages from Pixel — Publish now to post to your socials
              (Ayrshare), or copy to post by hand.
            </p>
          </div>
          <div className="text-right">
            <span className="font-mono text-[10px] uppercase text-zinc-600">
              Pending
            </span>
            <p className="font-mono text-lg font-bold tabular-nums text-amber-400">
              {items.length}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {notice ? (
          <p
            className={`rounded border px-3 py-2 font-mono text-[10px] ${
              notice.ok
                ? "border-emerald-800/50 bg-emerald-950/30 text-emerald-300"
                : "border-red-800/50 bg-red-950/30 text-red-300"
            }`}
          >
            {notice.text}
          </p>
        ) : null}

        {loading && items.length === 0 ? (
          <p className="font-mono text-xs text-zinc-600">Loading queue…</p>
        ) : null}

        {!loading && items.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/40 px-3 py-6 text-center">
            <p className="font-mono text-xs text-zinc-500">
              No pending TikTok packages.
            </p>
            <p className="mt-1 font-mono text-[10px] text-zinc-600">
              Approve a listing at Review Gate — Pixel queues slides here.
            </p>
          </div>
        ) : null}

        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-md border border-zinc-800/80 bg-zinc-900/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="order-status-badge order-status-badge--amber font-mono text-[10px]">
                pending
              </span>
              <time
                className="font-mono text-[10px] text-zinc-600"
                dateTime={item.created_at}
              >
                {new Date(item.created_at).toLocaleString()}
              </time>
            </div>

            <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-300">
              {item.caption}
            </pre>

            {item.hashtags.length > 0 ? (
              <p className="mt-2 font-mono text-[10px] text-amber-400/90">
                {item.hashtags.join(" ")}
              </p>
            ) : null}

            {item.mockup_urls.length > 0 ? (
              <div className="mt-3">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  Mockups
                </p>
                <div className="flex flex-wrap gap-2">
                  {item.mockup_urls.slice(0, 4).map((url, index) => (
                    <a
                      key={`${item.id}-mockup-${index}`}
                      href={url.startsWith("demo://") ? undefined : url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-zinc-700/80 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-400 hover:border-amber-500/40 hover:text-amber-300"
                      title={url}
                    >
                      {mockupLabel(url, index)}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {item.slideshow_script.length > 0 ? (
              <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/80 p-2">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                  Slideshow script
                </p>
                <ol className="space-y-1">
                  {item.slideshow_script.map((slide, index) => (
                    <li
                      key={`${item.id}-slide-${index}`}
                      className="font-mono text-[10px] text-zinc-400"
                    >
                      <span className="text-amber-500/80">
                        Slide {index + 1}
                      </span>
                      <span className="text-zinc-600"> · img </span>
                      <span className="text-zinc-500">{slide.image_index}</span>
                      <span className="text-zinc-600"> — </span>
                      {slide.overlay_text}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyCaption(item)}
                className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 font-mono text-[10px] font-semibold text-zinc-300 hover:border-amber-500/50 hover:text-amber-300"
              >
                {copiedId === item.id ? "Copied" : "Copy caption"}
              </button>
              {item.mockup_urls[0] &&
              !item.mockup_urls[0].startsWith("demo://") ? (
                <a
                  href={item.mockup_urls[0]}
                  download
                  className="rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1 font-mono text-[10px] font-semibold text-zinc-300 hover:border-amber-500/50 hover:text-amber-300"
                >
                  Download assets
                </a>
              ) : null}
              <button
                type="button"
                disabled={livePostingId === item.id}
                onClick={() => void publishNow(item)}
                className="rounded border border-amber-600/60 bg-amber-950/40 px-2.5 py-1 font-mono text-[10px] font-semibold text-amber-300 hover:border-amber-500 disabled:opacity-50"
                title="Publish this package to your linked socials via Ayrshare"
              >
                {livePostingId === item.id ? "Publishing…" : "▶ Publish now"}
              </button>
              {item.mockup_urls[0] &&
              !item.mockup_urls[0].startsWith("demo://") ? (
                videos[item.id]?.status === "completed" &&
                videos[item.id]?.url ? (
                  <a
                    href={videos[item.id]!.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-violet-600/60 bg-violet-950/40 px-2.5 py-1 font-mono text-[10px] font-semibold text-violet-300 hover:border-violet-500"
                  >
                    ▶ Video ready
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={renderingId === item.id}
                    onClick={() => void renderVideo(item)}
                    className="rounded border border-violet-600/60 bg-violet-950/40 px-2.5 py-1 font-mono text-[10px] font-semibold text-violet-300 hover:border-violet-500 disabled:opacity-50"
                    title="Animate the hero mockup into a 9:16 video via fal.ai (needs FAL_KEY)"
                  >
                    {renderingId === item.id
                      ? "Rendering…"
                      : videos[item.id]?.status === "pending"
                        ? "Check video"
                        : "🎬 Generate video"}
                  </button>
                )
              ) : null}
              <button
                type="button"
                disabled={postingId === item.id}
                onClick={() => void markPosted(item.id)}
                className="rounded border border-emerald-800/60 bg-emerald-950/40 px-2.5 py-1 font-mono text-[10px] font-semibold text-emerald-400 hover:border-emerald-600 disabled:opacity-50"
              >
                {postingId === item.id ? "Saving…" : "Mark as Posted"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
