-- system_alerts: the operator-facing failure surface (2026-07-25 audit, M10).
--
-- Verified negative before this migration: nothing in src/ sent an email, a
-- Slack message, or a page. A 3am cron that failed left a factory_events row
-- nobody reads and a Vercel log that ages out — and three code paths reported
-- failure AS success. One table + a Mission Control banner is the smallest
-- thing that makes a broken loop impossible to miss, and it covers H4
-- (orders stuck in processing_artwork), H14 (discarded paid renders) and
-- M10(a-c) from the same surface.
--
-- Deduped by kind while unresolved: 20 failed hourly passes overnight are one
-- alert with occurrences = 20.
-- Apply to production via Supabase MCP (mirrors prior migrations).

create table if not exists public.system_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  severity text not null default 'warning'
    check (severity in ('info', 'warning', 'critical')),
  title text not null,
  detail text,
  context jsonb not null default '{}'::jsonb,
  occurrences integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- The banner's only query: unresolved alerts for one user, newest first.
create index if not exists system_alerts_open_idx
  on public.system_alerts (user_id, last_seen_at desc)
  where resolved_at is null;

alter table public.system_alerts enable row level security;

create policy "system_alerts_select_own"
  on public.system_alerts for select
  to authenticated using (auth.uid() = user_id);
create policy "system_alerts_insert_own"
  on public.system_alerts for insert
  to authenticated with check (auth.uid() = user_id);
-- Update is how the operator dismisses (sets resolved_at) and how the writer
-- bumps occurrences. Delete stays closed: alert history is the audit trail.
create policy "system_alerts_update_own"
  on public.system_alerts for update
  to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
