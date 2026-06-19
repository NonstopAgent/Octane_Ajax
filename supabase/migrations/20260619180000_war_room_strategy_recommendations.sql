-- War Room: strategic recommendations generated from the Archive.
-- The War Room reads factory_events / product_ideas / agent_feedback /
-- product_listings / order_queue and writes recommendations here for the
-- operator to accept, dismiss, or mark actioned (human-in-the-loop).

create table if not exists public.strategy_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  run_id uuid not null,
  category text not null check (category in ('niche','channel','pricing','cut','other')),
  title text not null,
  rationale text not null default '',
  recommended_action text not null default '',
  priority integer not null default 3,
  confidence numeric,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','accepted','dismissed','actioned')),
  drafted_idea_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists strategy_recommendations_user_created_idx
  on public.strategy_recommendations (user_id, created_at desc);
create index if not exists strategy_recommendations_user_status_idx
  on public.strategy_recommendations (user_id, status);
create index if not exists strategy_recommendations_run_idx
  on public.strategy_recommendations (run_id);

alter table public.strategy_recommendations enable row level security;

create policy "strategy_recommendations_select_own"
  on public.strategy_recommendations for select
  using (auth.uid() = user_id);

create policy "strategy_recommendations_insert_own"
  on public.strategy_recommendations for insert
  with check (auth.uid() = user_id);

create policy "strategy_recommendations_update_own"
  on public.strategy_recommendations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
