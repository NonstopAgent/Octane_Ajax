-- Pin the search_path on the two updated_at trigger functions.
--
-- Both are SECURITY INVOKER, so this is hardening rather than a live hole:
-- with a mutable search_path, a schema earlier on the caller's path can
-- shadow a name the function body resolves — `now()` here. Pinning it removes
-- the whole class and clears the two standing WARNs in Supabase's database
-- linter, so the linter's output stays meaningful instead of becoming noise
-- everyone scrolls past (the reason the 2026-07-25 audit found real problems
-- sitting next to accepted warnings).
--
-- `pg_catalog, pg_temp` is the minimum a body that only calls built-ins needs.
-- Apply to production via Supabase MCP (mirrors prior migrations).

alter function public.set_order_queue_updated_at()
  set search_path = pg_catalog, pg_temp;

alter function public.set_tiktok_queue_updated_at()
  set search_path = pg_catalog, pg_temp;
