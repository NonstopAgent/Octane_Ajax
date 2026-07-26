-- ajax_agents: stop being world-writable to every signed-up account.
--
-- 2026-07-25 audit, M6. The init migration shipped all four policies as
-- `to authenticated using (true) with check (true)` with the comment
-- "shared read/update for demo" — but this is the production registry of the
-- three system agents. Any authenticated user could PATCH PostgREST directly
-- and rename a slug; `ajax_tasks.agent_slug` and `factory_events.agent_slug`
-- are `on update cascade`, so one rename silently rewrites factory history
-- across the whole app, while `AGENT_SLUGS` in schema.ts keeps the originals
-- and every `updateAgentState` call starts throwing.
--
-- Posture after this migration:
--   select  → still open to authenticated (the floor UI reads the registry)
--   insert  → nobody (the three rows are seeded by the init migration;
--             resetDemoData now updates them instead of upserting)
--   delete  → nobody
--   update  → allowed, but ONLY the four operational columns. Identity
--             (slug/name/role) and autonomy_level are no longer writable
--             through the anon/authenticated API at all — enforced by column
--             privileges, which PostgREST honours, so it holds even if a
--             future policy is written loosely again.
--
-- Server-side jobs that legitimately need more use the service client, which
-- bypasses RLS by design.
-- Apply to production via Supabase MCP (mirrors prior migrations).

drop policy if exists "ajax_agents_insert_authenticated" on public.ajax_agents;
drop policy if exists "ajax_agents_delete_authenticated" on public.ajax_agents;

-- Keep an UPDATE policy (the app updates agent status on every pipeline step),
-- but scope it to the three seeded system agents rather than `using (true)`.
-- Two reasons this is not cosmetic: it stops a row inserted by any future
-- looser path from being updatable, and `using (true)` on UPDATE is exactly
-- what Supabase's own database linter flags as "effectively bypasses RLS" —
-- a warning a future reader would either mis-fix or learn to ignore.
drop policy if exists "ajax_agents_update_authenticated" on public.ajax_agents;
drop policy if exists "ajax_agents_update_operational" on public.ajax_agents;
create policy "ajax_agents_update_system_agents"
  on public.ajax_agents
  for update
  to authenticated
  using (slug = any (array['nova', 'forge', 'pixel']))
  with check (slug = any (array['nova', 'forge', 'pixel']));

revoke insert, update, delete on public.ajax_agents from authenticated;
revoke insert, update, delete on public.ajax_agents from anon;
grant update (status, current_room, current_task_id, last_heartbeat)
  on public.ajax_agents to authenticated;
