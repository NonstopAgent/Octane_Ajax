-- Market keywords: proven Etsy search terms (Marketplace Insights, manual, War Room)
-- that ground Nova ideation and Forge tag generation in real demand data.
-- Applied to production via Supabase MCP on 2026-07-01.

create table public.market_keywords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  term text not null,
  searches_per_month integer,
  competing_listings bigint,
  source text not null default 'manual',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, term)
);

create index market_keywords_user_active_idx
  on public.market_keywords (user_id, active, searches_per_month desc nulls last);

alter table public.market_keywords enable row level security;

create policy "market_keywords_select_own"
  on public.market_keywords for select
  using (auth.uid() = user_id);

create policy "market_keywords_insert_own"
  on public.market_keywords for insert
  with check (auth.uid() = user_id);

create policy "market_keywords_update_own"
  on public.market_keywords for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "market_keywords_delete_own"
  on public.market_keywords for delete
  using (auth.uid() = user_id);
