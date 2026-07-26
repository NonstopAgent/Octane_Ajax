-- Bring four production tables under version control (2026-07-25 audit, M7).
--
-- `businesses`, `affiliate_guides`, `affiliate_links` and `affiliate_clicks`
-- are referenced by schema.ts and typed in database.types.ts — so they exist
-- in the live database — but NO migration created them. Nothing described
-- their RLS posture either, which meant it could not be reviewed, could not be
-- diffed, and would not be recreated by a `supabase db reset`. Postgres
-- defaults RLS to OFF for tables created outside the Table Editor, so the
-- theoretical worst case was an anon-writable `affiliate_links` — i.e. an open
-- redirector under this domain via /go/[slug].
--
-- VERIFIED AGAINST PRODUCTION 2026-07-26 before writing this file: all four
-- tables already have RLS enabled with owner-scoped policies, so this is not a
-- live hole being closed — it is the posture being written down, plus three
-- real gaps found while transcribing it:
--
--   1. `businesses.user_id` had no foreign key to auth.users (0 orphans
--      today; the constraint is added below so it stays that way).
--   2. `affiliate_guides` / `affiliate_links` had `for all` policies, which
--      grant DELETE too. Guides and links are referenced by published pages
--      and click history; split into select/insert/update and leave delete to
--      the service client.
--   3. `product_listings.business_id` is in database.types.ts and in the live
--      table but in no migration — added here for the same reason.
--
-- Written idempotently (`if not exists` / drop-then-create) so it is a no-op
-- against production and a full build on a fresh database.
-- Apply to production via Supabase MCP (mirrors prior migrations).

-- ---------------------------------------------------------------------------
-- businesses — the multi-business container (Etsy is Business Unit #1)
-- ---------------------------------------------------------------------------
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  slug text,
  niche text,
  brand text,
  status text not null default 'active',
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists businesses_user_id_idx
  on public.businesses (user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'businesses_user_id_fkey'
  ) then
    alter table public.businesses
      add constraint businesses_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end $$;

alter table public.businesses enable row level security;

drop policy if exists "businesses_select_own" on public.businesses;
drop policy if exists "businesses_insert_own" on public.businesses;
drop policy if exists "businesses_update_own" on public.businesses;
drop policy if exists "businesses_delete_own" on public.businesses;
create policy "businesses_select_own" on public.businesses
  for select to authenticated using (auth.uid() = user_id);
create policy "businesses_insert_own" on public.businesses
  for insert to authenticated with check (auth.uid() = user_id);
create policy "businesses_update_own" on public.businesses
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "businesses_delete_own" on public.businesses
  for delete to authenticated using (auth.uid() = user_id);

-- product_listings.business_id — live, typed, previously unmigrated. The live
-- column exists with NO foreign key, so `add column if not exists` alone would
-- have left production and a fresh build with different constraints. Add the
-- column and the constraint separately so both converge.
alter table public.product_listings
  add column if not exists business_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'product_listings_business_id_fkey'
  ) then
    alter table public.product_listings
      add constraint product_listings_business_id_fkey
      foreign key (business_id) references public.businesses (id)
      on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- affiliate_guides — public gift-guide pages
-- ---------------------------------------------------------------------------
create table if not exists public.affiliate_guides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null unique,
  title text not null,
  description text,
  hero_image_url text,
  content_md text not null,
  status text not null default 'published'
    check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_guides_status_idx
  on public.affiliate_guides (status, created_at desc);

alter table public.affiliate_guides enable row level security;

-- `guides public read` is intentional: published guides are public pages, read
-- by anon. Owner writes are split out of the old `for all` so DELETE is no
-- longer reachable with a user JWT.
drop policy if exists "guides owner all" on public.affiliate_guides;
drop policy if exists "guides public read" on public.affiliate_guides;
drop policy if exists "guides_owner_select" on public.affiliate_guides;
drop policy if exists "guides_owner_insert" on public.affiliate_guides;
drop policy if exists "guides_owner_update" on public.affiliate_guides;
create policy "guides public read" on public.affiliate_guides
  for select using (status = 'published');
create policy "guides_owner_select" on public.affiliate_guides
  for select to authenticated using (auth.uid() = user_id);
create policy "guides_owner_insert" on public.affiliate_guides
  for insert to authenticated with check (auth.uid() = user_id);
create policy "guides_owner_update" on public.affiliate_guides
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- affiliate_links — /go/[slug] redirect targets
-- ---------------------------------------------------------------------------
create table if not exists public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null unique,
  destination_url text not null,
  network text not null default 'generic'
    check (network in ('etsy_own', 'amazon', 'chewy', 'awin_etsy', 'generic',
                       'shop_affiliate')),
  label text,
  partner_code text,
  commission_pct numeric,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_links_partner_idx
  on public.affiliate_links (partner_code);

alter table public.affiliate_links enable row level security;

-- No anon policy at all: /go/[slug] resolves the destination on the service
-- client. A link row is a redirect this domain will perform, so it stays
-- unreadable and unwritable with the anon key.
drop policy if exists "links owner all" on public.affiliate_links;
drop policy if exists "links_owner_select" on public.affiliate_links;
drop policy if exists "links_owner_insert" on public.affiliate_links;
drop policy if exists "links_owner_update" on public.affiliate_links;
create policy "links_owner_select" on public.affiliate_links
  for select to authenticated using (auth.uid() = user_id);
create policy "links_owner_insert" on public.affiliate_links
  for insert to authenticated with check (auth.uid() = user_id);
create policy "links_owner_update" on public.affiliate_links
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- affiliate_clicks — append-only click log (service client writes)
-- ---------------------------------------------------------------------------
create table if not exists public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.affiliate_links (id) on delete cascade,
  clicked_at timestamptz not null default now(),
  referrer text,
  user_agent text
);

create index if not exists affiliate_clicks_link_idx
  on public.affiliate_clicks (link_id, clicked_at desc);

alter table public.affiliate_clicks enable row level security;

-- Read-only to the owner of the parent link; inserts come from /go/[slug] on
-- the service client, so no insert policy is granted here on purpose.
drop policy if exists "clicks owner read" on public.affiliate_clicks;
create policy "clicks owner read" on public.affiliate_clicks
  for select to authenticated using (
    exists (
      select 1 from public.affiliate_links l
      where l.id = affiliate_clicks.link_id and l.user_id = auth.uid()
    )
  );
