-- 2026-07-25 audit H13. Applied to production via Supabase MCP on 2026-07-26.
--
-- drainVideoJobs had no job claim: the 10-min cron, the Factory page's 30s
-- client poll, and the autopilot mid-pass drain could all pick up the SAME
-- pending job — two video downloads, two Etsy uploads, two racing token
-- refreshes per render. Drivers now claim a job atomically (UPDATE ... WHERE
-- status='pending' AND (claimed_at IS NULL OR claimed_at < now()-5min)) and
-- skip rows another driver holds.

alter table public.video_jobs
  add column if not exists claimed_at timestamptz;

comment on column public.video_jobs.claimed_at is
  'Atomic drain claim: a driver may only process a pending job it claimed; stale claims (>5 min) are reclaimable (2026-07-25 audit, H13).';
