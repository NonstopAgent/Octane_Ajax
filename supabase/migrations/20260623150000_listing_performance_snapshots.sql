-- Daily Etsy listing performance snapshots (Manus Part 3). Etsy exposes only
-- lifetime views + num_favorers per listing, so we snapshot them once a day and
-- derive velocity (views/day, favorites/day) from the deltas. Revenue + orders
-- are attributed per listing from receipt transactions (needs transactions_r).
create table if not exists public.listing_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  etsy_listing_id text not null,
  listing_id uuid references public.product_listings(id) on delete set null,
  title text,
  views integer not null default 0,
  favorites integer not null default 0,
  revenue_cents integer not null default 0,
  orders integer not null default 0,
  snapshot_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (user_id, etsy_listing_id, snapshot_date)
);

create index if not exists listing_perf_user_date_idx
  on public.listing_performance_snapshots (user_id, snapshot_date desc);

alter table public.listing_performance_snapshots enable row level security;

drop policy if exists "own_snapshots" on public.listing_performance_snapshots;
create policy "own_snapshots" on public.listing_performance_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
