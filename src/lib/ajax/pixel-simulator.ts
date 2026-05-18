import { AGENT_SLUGS, ROOM_SLUGS } from "@/lib/ajax/constants";
import {
  mapContentJobFromDb,
  mapEventFromDb,
  mapListingFromDb,
} from "@/lib/ajax/mappers";
import {
  buildContentJobScheduleUpdate,
  buildPixelPromoPackage,
  parseStructure,
  type PixelPromoMetadata,
  type PixelPromoPackage,
} from "@/lib/ajax/pixel-promo-package";
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

type QueuedGenerationRow = {
  structure: unknown;
  generation_status: string;
  created_at?: string;
};

type QueuedIdeaRow = {
  niche: string | null;
  title: string | null;
  description: string | null;
  seo_keywords: string[] | null;
};

type QueuedListingRow = {
  id: string;
  title: string | null;
  status: string;
  description: string | null;
  product_ideas: QueuedIdeaRow | QueuedIdeaRow[] | null;
  product_generations: QueuedGenerationRow | QueuedGenerationRow[] | null;
};

type QueuedJobRow = {
  id: string;
  user_id: string;
  listing_id: string;
  platform: string;
  content_type: string;
  status: string;
  caption: string | null;
  product_listings: QueuedListingRow | null;
};

export type { PixelPromoMetadata, PixelPromoPackage };

export type ProcessedPromoJob = {
  contentJob: ContentJob;
  listing: ProductListing;
  marketing: PixelPromoMetadata;
};

export type RunPixelResult = {
  ok: true;
  message: string;
  processedCount: number;
  jobs: ProcessedPromoJob[];
  events: FactoryEvent[];
};

function firstOrSelf<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function pickGeneration(
  rows: QueuedGenerationRow | QueuedGenerationRow[] | null | undefined,
): QueuedGenerationRow | null {
  const list = rows == null ? [] : Array.isArray(rows) ? rows : [rows];
  if (list.length === 0) return null;

  const ready = list.filter((g) => g.generation_status === "ready");
  const pool = ready.length > 0 ? ready : list;

  return pool.sort((a, b) => {
    const aTime = a.created_at ?? "";
    const bTime = b.created_at ?? "";
    return bTime.localeCompare(aTime);
  })[0];
}

function promoInputFromJob(job: QueuedJobRow): Parameters<typeof buildPixelPromoPackage>[0] {
  const listing = job.product_listings;
  const idea = firstOrSelf(listing?.product_ideas);
  const generation = pickGeneration(listing?.product_generations);
  const structure = parseStructure(generation?.structure);

  return {
    jobId: job.id,
    listingTitle: listing?.title ?? idea?.title ?? "Approved product",
    listingDescription: listing?.description ?? idea?.description ?? null,
    niche: idea?.niche ?? null,
    ideaTitle: idea?.title ?? null,
    ideaDescription: idea?.description ?? null,
    seoKeywords: idea?.seo_keywords ?? null,
    structure,
  };
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
        status,
        description,
        product_ideas (
          niche,
          title,
          description,
          seo_keywords
        ),
        product_generations (
          structure,
          generation_status,
          created_at
        )
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
    const promo = buildPixelPromoPackage(promoInputFromJob(job));

    const { data: jobRow, error: jobError } = await supabase
      .from(TABLES.CONTENT_JOBS)
      .update(buildContentJobScheduleUpdate(promo))
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
      marketing: promo.metadata,
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
          scheduledFor: promo.scheduledFor,
          assetUrl: promo.assetUrl,
          marketing: promo.metadata,
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
