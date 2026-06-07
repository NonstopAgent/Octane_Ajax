-- Phase 5: TikTok semi-auto distribution queue (Pixel → human post)

create table if not exists public.tiktok_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_generation_id uuid not null references public.product_generations (id) on delete cascade,
  status text not null default 'pending',
  caption text not null,
  hashtags text[] not null default '{}'::text[],
  mockup_urls text[] not null default '{}'::text[],
  slideshow_script jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tiktok_queue_status_check check (
    status in ('pending', 'approved', 'posted', 'rejected')
  )
);

comment on table public.tiktok_queue is
  'Semi-auto TikTok slideshow packages queued by Pixel after Review Gate approval';

comment on column public.tiktok_queue.slideshow_script is
  'Array of { image_index, overlay_text } slides for manual TikTok posting';

create index if not exists tiktok_queue_user_id_idx
  on public.tiktok_queue (user_id);

create index if not exists tiktok_queue_status_idx
  on public.tiktok_queue (status);

create index if not exists tiktok_queue_product_generation_id_idx
  on public.tiktok_queue (product_generation_id);

create or replace function public.set_tiktok_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tiktok_queue_updated_at on public.tiktok_queue;

create trigger tiktok_queue_updated_at
  before update on public.tiktok_queue
  for each row
  execute function public.set_tiktok_queue_updated_at();

alter table public.tiktok_queue enable row level security;

create policy "tiktok_queue_select_own"
  on public.tiktok_queue for select to authenticated
  using (auth.uid() = user_id);

create policy "tiktok_queue_insert_own"
  on public.tiktok_queue for insert to authenticated
  with check (auth.uid() = user_id);

create policy "tiktok_queue_update_own"
  on public.tiktok_queue for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "tiktok_queue_delete_own"
  on public.tiktok_queue for delete to authenticated
  using (auth.uid() = user_id);

alter publication supabase_realtime add table public.tiktok_queue;
