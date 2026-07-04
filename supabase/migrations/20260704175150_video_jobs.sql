-- Video jobs: async render queue so slow renders still land.
-- On approve we submit a fal render and enqueue a job; a poll endpoint (drained
-- while the operator is active) plus a daily cron backstop finish each job —
-- attaching the MP4 to the Etsy listing (kind 'etsy_listing') or posting the
-- 9:16 clip to social with the listing link (kind 'social').
-- Apply to production via Supabase MCP (mirrors prior migrations).

create table public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid,
  kind text not null check (kind in ('etsy_listing', 'social')),
  request_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'failed')),
  etsy_listing_id text,
  post_text text,
  platforms text[],
  video_url text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index video_jobs_pending_idx
  on public.video_jobs (user_id, status, created_at);

alter table public.video_jobs enable row level security;

create policy "video_jobs_select_own"
  on public.video_jobs for select using (auth.uid() = user_id);
create policy "video_jobs_insert_own"
  on public.video_jobs for insert with check (auth.uid() = user_id);
create policy "video_jobs_update_own"
  on public.video_jobs for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "video_jobs_delete_own"
  on public.video_jobs for delete using (auth.uid() = user_id);
