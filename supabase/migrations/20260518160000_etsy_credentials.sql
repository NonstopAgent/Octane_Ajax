-- Etsy OAuth credentials (one row per operator)
create table public.etsy_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null unique,
  access_token text not null,
  refresh_token text not null,
  shop_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

alter table public.etsy_credentials enable row level security;

create policy "etsy_credentials_select_own"
  on public.etsy_credentials for select to authenticated
  using (auth.uid() = user_id);

create policy "etsy_credentials_insert_own"
  on public.etsy_credentials for insert to authenticated
  with check (auth.uid() = user_id);

create policy "etsy_credentials_update_own"
  on public.etsy_credentials for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "etsy_credentials_delete_own"
  on public.etsy_credentials for delete to authenticated
  using (auth.uid() = user_id);
