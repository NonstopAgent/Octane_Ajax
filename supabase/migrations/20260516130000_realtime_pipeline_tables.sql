-- Enable Realtime for pipeline tables used by the factory dashboard (RLS still applies).

alter publication supabase_realtime add table public.review_queue;
alter publication supabase_realtime add table public.product_listings;
alter publication supabase_realtime add table public.content_jobs;
