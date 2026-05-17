import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/lib/supabase/database.types";
import { AGENT_SLUGS, FACTORY_ROOMS, TABLES } from "@/lib/supabase/schema";

export type Supabase = SupabaseClient<Database>;

/** Log a factory-floor event for the authenticated user (RLS applies). */
export async function logFactoryEvent(
  supabase: Supabase,
  payload: Pick<
    TablesInsert<"factory_events">,
    "event_type" | "message" | "agent_slug" | "room" | "metadata"
  >,
) {
  const { data, error } = await supabase
    .from(TABLES.EVENTS)
    .insert({
      event_type: payload.event_type,
      message: payload.message,
      agent_slug: payload.agent_slug ?? null,
      room: payload.room ?? null,
      metadata: payload.metadata ?? {},
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Update agent status/room (shared agents — authenticated demo policy). */
export async function updateAgentState(
  supabase: Supabase,
  slug: string,
  patch: {
    status?: string;
    current_room?: string | null;
    current_task_id?: string | null;
    last_heartbeat?: string;
  },
) {
  const { data, error } = await supabase
    .from(TABLES.AGENTS)
    .update({
      ...patch,
      last_heartbeat: patch.last_heartbeat ?? new Date().toISOString(),
    })
    .eq("slug", slug)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchAgents(supabase: Supabase) {
  const { data, error } = await supabase
    .from(TABLES.AGENTS)
    .select("*")
    .order("slug");

  if (error) throw error;
  return data;
}

export async function fetchRecentFactoryEvents(
  supabase: Supabase,
  limit = 50,
) {
  const { data, error } = await supabase
    .from(TABLES.EVENTS)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

export async function fetchPendingReviews(supabase: Supabase) {
  const { data, error } = await supabase
    .from(TABLES.REVIEW_QUEUE)
    .select(
      `
      *,
      product_listings (
        id,
        title,
        description,
        price,
        mockup_url,
        status,
        product_idea_id
      )
    `,
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export { AGENT_SLUGS, FACTORY_ROOMS };
