import type {
  AjaxAgent as DbAgent,
  AjaxTask as DbTask,
  ContentJob as DbContentJob,
  FactoryEvent as DbEvent,
  ProductIdea as DbIdea,
  ProductListing as DbListing,
  ReviewQueueItem as DbReview,
} from "@/lib/supabase/database.types";
import type {
  AgentSlug,
  AjaxAgent,
  AjaxTask,
  ContentJob,
  FactoryEvent,
  ProductIdea,
  ProductListing,
  ReviewItem,
} from "@/lib/ajax/types";
import { isAgentStatus } from "@/lib/ajax/status";
import type { AgentStatus, TaskStatus } from "@/lib/ajax/status";
import type { ListingStatus, ReviewStatus } from "@/lib/ajax/status";
import type { IdeaStatus, ContentJobStatus } from "@/lib/ajax/status";

/** Map DB agent status to domain (adds UI-only states when needed). */
export function mapDbAgentStatus(dbStatus: string): AgentStatus {
  if (isAgentStatus(dbStatus)) return dbStatus;
  if (dbStatus === "waiting") return "waiting_review";
  if (dbStatus === "offline") return "idle";
  return "idle";
}

export function mapAgentFromDb(row: DbAgent): AjaxAgent {
  return {
    id: row.id,
    slug: row.slug as AgentSlug,
    name: row.name,
    role: row.role,
    status: mapDbAgentStatus(row.status),
    currentRoom: row.current_room,
    currentTaskId: row.current_task_id,
    autonomyLevel: row.autonomy_level,
    lastHeartbeat: row.last_heartbeat,
    createdAt: row.created_at,
  };
}

export function mapTaskFromDb(row: DbTask): AjaxTask {
  return {
    id: row.id,
    userId: row.user_id,
    agentSlug: row.agent_slug,
    taskType: row.task_type,
    status: row.status as TaskStatus,
    priority: row.priority,
    input: (row.input as Record<string, unknown>) ?? {},
    output: (row.output as Record<string, unknown>) ?? {},
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export function mapIdeaFromDb(row: DbIdea): ProductIdea {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    niche: row.niche,
    title: row.title,
    description: row.description,
    seoKeywords: row.seo_keywords ?? [],
    trendScore: Number(row.trend_score),
    status: row.status as IdeaStatus,
    rawPayload: (row.raw_payload as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
  };
}

export function mapListingFromDb(row: DbListing): ProductListing {
  return {
    id: row.id,
    userId: row.user_id,
    productIdeaId: row.product_idea_id,
    title: row.title,
    description: row.description,
    price: row.price,
    mockupUrl: row.mockup_url,
    platform: row.platform,
    externalListingId: row.external_listing_id,
    gumroadUrl: row.gumroad_url ?? null,
    gumroadProductId: row.gumroad_product_id ?? null,
    status: row.status as ListingStatus,
    createdAt: row.created_at,
  };
}

export function mapReviewFromDb(row: DbReview): ReviewItem {
  return {
    id: row.id,
    userId: row.user_id,
    listingId: row.listing_id,
    status: row.status as ReviewStatus,
    reviewerNotes: row.reviewer_notes,
    rejectionReason: row.rejection_reason,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

export function mapEventFromDb(row: DbEvent): FactoryEvent {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type,
    agentSlug: row.agent_slug,
    room: row.room,
    message: row.message,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
  };
}

export function mapContentJobFromDb(row: DbContentJob): ContentJob {
  return {
    id: row.id,
    userId: row.user_id,
    listingId: row.listing_id,
    platform: row.platform,
    contentType: row.content_type,
    status: row.status as ContentJobStatus,
    assetUrl: row.asset_url,
    caption: row.caption,
    scheduledFor: row.scheduled_for,
    createdAt: row.created_at,
  };
}
