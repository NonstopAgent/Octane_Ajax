/** Browser-safe Supabase client (anon key + RLS). */
export { createClient } from "@/lib/supabase/client";
/** Server-only — import from `@/lib/supabase/server` in API routes / RSC. */
export { createClient as createServerClient } from "@/lib/supabase/server";
export type { Database, AjaxAgent, FactoryEvent, ProductListing } from "@/lib/supabase/database.types";
export * from "@/lib/supabase/schema";
export * from "@/lib/supabase/helpers";
