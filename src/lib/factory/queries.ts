import {
  mapAgentFromDb,
  mapEventFromDb,
  mapTaskFromDb,
} from "@/lib/ajax/mappers";
import type { FactorySnapshot } from "@/lib/factory/types";
import type { Supabase } from "@/lib/supabase/helpers";
import { TABLES } from "@/lib/supabase/schema";

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
    listingsResult,
    jobsResult,
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
