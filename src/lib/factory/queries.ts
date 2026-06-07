import {
  mapAgentFromDb,
  mapEventFromDb,
  mapTaskFromDb,
} from "@/lib/ajax/mappers";
import type { OrderQueueRow } from "@/lib/ajax/pod/order-types";
import type { TikTokQueueRow } from "@/lib/ajax/tiktok/types";
import { mapTikTokQueueRow } from "@/lib/ajax/tiktok/types";
import type { FactoryEvent } from "@/lib/ajax/types";
import type { FactorySnapshot } from "@/lib/factory/types";
import type { OrderQueue, TikTokQueue } from "@/lib/supabase/database.types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

function mapOrderQueueRow(row: OrderQueue): OrderQueueRow {
  return {
    id: row.id,
    user_id: row.user_id,
    etsy_order_id: row.etsy_order_id,
    listing_id: row.listing_id,
    customer_photo_url: row.customer_photo_url,
    style_prompt: row.style_prompt,
    status: row.status as OrderQueueRow["status"],
    printify_product_id: row.printify_product_id,
    printify_upload_id: row.printify_upload_id,
    artwork_url: row.artwork_url,
    error_message: row.error_message,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Initial payload for the agent sweatshop floor (events + order queue + tiktok). */
export async function fetchSweatshopSnapshot(
  supabase: Supabase,
  userId: string,
): Promise<{
  events: FactoryEvent[];
  orders: OrderQueueRow[];
  tiktokQueue: TikTokQueueRow[];
}> {
  const [eventsResult, ordersResult, tiktokResult] = await Promise.all([
    supabase
      .from(TABLES.EVENTS)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from(TABLES.ORDER_QUEUE)
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(16),
    supabase
      .from(TABLES.TIKTOK_QUEUE)
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  if (eventsResult.error) throw eventsResult.error;
  if (ordersResult.error) throw ordersResult.error;
  if (tiktokResult.error) throw tiktokResult.error;

  return {
    events: (eventsResult.data ?? []).map(mapEventFromDb),
    orders: (ordersResult.data ?? []).map(mapOrderQueueRow),
    tiktokQueue: (tiktokResult.data ?? []).map((row) =>
      mapTikTokQueueRow(row as TikTokQueue),
    ),
  };
}

/** Loads agents, recent events, active tasks, and metric counts for the factory UI. */
export async function fetchFactorySnapshot(
  supabase: Supabase,
  userId: string,
): Promise<FactorySnapshot> {
  const [
    agentsResult,
    eventsResult,
    ideasResult,
    reviewsResult,
    jobsResult,
    listingsResult,
  ] = await Promise.all([
    supabase.from(TABLES.AGENTS).select("*").order("slug"),
    supabase
      .from(TABLES.EVENTS)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from(TABLES.IDEAS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from(TABLES.REVIEW_QUEUE)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending"),
    supabase
      .from(TABLES.CONTENT_JOBS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "scheduled"),
    supabase
      .from(TABLES.LISTINGS)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "published"),
  ]);

  if (agentsResult.error) throw agentsResult.error;
  if (eventsResult.error) throw eventsResult.error;
  if (ideasResult.error) throw ideasResult.error;
  if (reviewsResult.error) throw reviewsResult.error;
  if (listingsResult.error) throw listingsResult.error;
  if (jobsResult.error) throw jobsResult.error;

  const agents = (agentsResult.data ?? []).map(mapAgentFromDb);
  const events = (eventsResult.data ?? []).map(mapEventFromDb);

  const taskIds = agents
    .map((a) => a.currentTaskId)
    .filter((id): id is string => Boolean(id));

  const tasksById: FactorySnapshot["tasksById"] = {};

  if (taskIds.length > 0) {
    const { data: taskRows, error: tasksError } = await supabase
      .from(TABLES.TASKS)
      .select("*")
      .eq("user_id", userId)
      .in("id", taskIds);

    if (tasksError) throw tasksError;

    for (const row of taskRows ?? []) {
      const task = mapTaskFromDb(row);
      tasksById[task.id] = task;
    }
  }

  return {
    agents,
    tasksById,
    events,
    metrics: {
      productIdeas: ideasResult.count ?? 0,
      pendingReviews: reviewsResult.count ?? 0,
      scheduledContent: jobsResult.count ?? 0,
      publishedListings: listingsResult.count ?? 0,
    },
  };
}
