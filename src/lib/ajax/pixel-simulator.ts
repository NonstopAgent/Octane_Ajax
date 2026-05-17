import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import {
  mapContentJobFromDb,
  mapEventFromDb,
  mapListingFromDb,
} from "@/lib/ajax/mappers";
import type { ContentJob, FactoryEvent, ProductListing } from "@/lib/ajax/types";
import type { Json } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

type DbAgentStatus = "idle" | "working" | "waiting" | "error" | "offline";

export class PixelSimulatorError extends Error {
  readonly code = "PIXEL_SIMULATOR_ERROR" as const;

  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PixelSimulatorError";
  }
}

export class NoQueuedContentError extends Error {
  readonly code = "NO_QUEUED_CONTENT" as const;

  constructor(
    message = "No queued content jobs. Approve a listing first, then run Pixel.",
  ) {
    super(message);
    this.name = "NoQueuedContentError";
  }
}

type QueuedJobRow = {
  id: string;
  user_id: string;
  listing_id: string;
  platform: string;
  content_type: string;
  status: string;
  caption: string | null;
  product_listings: {
    id: string;
    title: string | null;
    status: string;
  } | null;
};

export type ProcessedPromoJob = {
  contentJob: ContentJob;
  listing: ProductListing;
};

export type RunPixelResult = {
  ok: true;
  message: string;
  processedCount: number;
  jobs: ProcessedPromoJob[];
  events: FactoryEvent[];
};

/** Demo marketing copy — replace with TikTok/YouTube adapters later. */
function buildPromoPackage(listingTitle: string, jobId: string) {
  const hashtags = [
    "#OctaneAjax",
    "#DemoShop",
    "#SmallBusiness",
    "#ProductDrop",
    "#CreatorFinds",
  ];

  const caption = [
    `✨ ${listingTitle} is live in the demo storefront.`,
    "Tap through for the full slideshow — built autonomously by Pixel.",
    "",
    hashtags.join(" "),
  ].join("\n");

  const assetUrl = `demo://octane-ajax/promo/${jobId}/slideshow.mp4`;

  const scheduledFor = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  return { caption, hashtags, assetUrl, scheduledFor };
}

async function insertEvent(
  supabase: Supabase,
  userId: string,
  payload: {
    event_type: string;
    message: string;
    agent_slug?: string | null;
    room?: string | null;
    metadata?: Json;
  },
) {
  const { data, error } = await supabase
    .from(TABLES.EVENTS)
    .insert({
      user_id: userId,
      event_type: payload.event_type,
      message: payload.message,
      agent_slug: payload.agent_slug ?? null,
      room: payload.room ?? null,
      metadata: payload.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    throw new PixelSimulatorError(
      `Failed to log factory event: ${payload.event_type}`,
      error,
    );
  }

  return mapEventFromDb(data);
}

async function setPixelState(
  supabase: Supabase,
  status: DbAgentStatus,
  room: string,
) {
  const { error } = await supabase
    .from(TABLES.AGENTS)
    .update({
      status,
      current_room: room,
      current_task_id: null,
      last_heartbeat: new Date().toISOString(),
    })
    .eq("slug", AGENT_SLUGS.PIXEL);

  if (error) {
    throw new PixelSimulatorError("Failed to update Pixel agent state.", error);
  }
}

/**
 * Processes all queued content_jobs for the user (demo marketing simulation).
 * Publishes linked listings in demo mode (`status = published`).
 */
export async function runPixelMarketing(
  supabase: Supabase,
  userId: string,
): Promise<RunPixelResult> {
  const { data: queuedRows, error: fetchError } = await supabase
    .from(TABLES.CONTENT_JOBS)
    .select(
      `
      id,
      user_id,
      listing_id,
      platform,
      content_type,
      status,
      caption,
      product_listings (
        id,
        title,
        status
      )
    `,
    )
    .eq("user_id", userId)
    .eq("status", "queued")
    .order("created_at", { ascending: true });

  if (fetchError) {
    throw new PixelSimulatorError("Failed to load queued content jobs.", fetchError);
  }

  const jobs = (queuedRows ?? []) as QueuedJobRow[];

  if (jobs.length === 0) {
    throw new NoQueuedContentError();
  }

  const events: FactoryEvent[] = [];
  const processed: ProcessedPromoJob[] = [];

  await setPixelState(supabase, "working", ROOM_SLUGS.MEDIA_STUDIO);

  events.push(
    await insertEvent(supabase, userId, {
      event_type: "agent_started",
      agent_slug: AGENT_SLUGS.PIXEL,
      room: ROOM_SLUGS.MEDIA_STUDIO,
      message: "Pixel is creating promo content for an approved listing.",
      metadata: { jobCount: jobs.length },
    }),
  );
  await sleep(1500);

  for (const job of jobs) {
    const listingTitle =
      job.product_listings?.title ?? "Approved product";
    const promo = buildPromoPackage(listingTitle, job.id);

    const { data: jobRow, error: jobError } = await supabase
      .from(TABLES.CONTENT_JOBS)
      .update({
        status: "scheduled",
        caption: promo.caption,
        asset_url: promo.assetUrl,
        scheduled_for: promo.scheduledFor,
      })
      .eq("id", job.id)
      .eq("user_id", userId)
      .select()
      .single();

    if (jobError || !jobRow) {
      throw new PixelSimulatorError(
        `Failed to schedule content job ${job.id}.`,
        jobError,
      );
    }

    const { data: listingRow, error: listingError } = await supabase
      .from(TABLES.LISTINGS)
      .update({ status: "published" })
      .eq("id", job.listing_id)
      .eq("user_id", userId)
      .select()
      .single();

    if (listingError || !listingRow) {
      throw new PixelSimulatorError(
        `Failed to publish listing ${job.listing_id}.`,
        listingError,
      );
    }

    processed.push({
      contentJob: mapContentJobFromDb(jobRow),
      listing: mapListingFromDb(listingRow),
    });

    events.push(
      await insertEvent(supabase, userId, {
        event_type: "content_scheduled",
        agent_slug: AGENT_SLUGS.PIXEL,
        room: ROOM_SLUGS.MEDIA_STUDIO,
        message: "Pixel scheduled promo content.",
        metadata: {
          contentJobId: job.id,
          listingId: job.listing_id,
          hashtags: promo.hashtags,
          scheduledFor: promo.scheduledFor,
          assetUrl: promo.assetUrl,
        },
      }),
    );
    await sleep(700);
  }

  await setPixelState(supabase, "idle", ROOM_SLUGS.MEDIA_STUDIO);

  const count = processed.length;
  const message =
    count === 1
      ? "Pixel scheduled 1 promo package. Listing published to demo storefront."
      : `Pixel scheduled ${count} promo packages. Listings published to demo storefront.`;

  return {
    ok: true,
    message,
    processedCount: count,
    jobs: processed,
    events,
  };
}
