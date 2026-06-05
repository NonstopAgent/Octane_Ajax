-- Room 2: Personalized-on-Order queue (Etsy webhook → personalization → Printify)

create table if not exists public.order_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  etsy_order_id text not null,
  listing_id uuid references public.product_listings (id) on delete set null,
  customer_photo_url text not null,
  style_prompt text not null,
  status text not null default 'pending_personalization',
  printify_product_id text,
  printify_upload_id text,
  artwork_url text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_queue_status_check check (
    status in (
      'pending_personalization',
      'processing_artwork',
      'fulfillment_ready',
      'failed'
    )
  ),
  constraint order_queue_user_etsy_order_unique unique (user_id, etsy_order_id)
);

comment on table public.order_queue is
  'Personalized POD orders: Etsy webhook capture → gpt-image-1 portrait → Printify upload';

create index if not exists order_queue_user_id_idx
  on public.order_queue (user_id);

create index if not exists order_queue_status_idx
  on public.order_queue (status);

create index if not exists order_queue_etsy_order_id_idx
  on public.order_queue (etsy_order_id);

create or replace function public.set_order_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists order_queue_updated_at on public.order_queue;

create trigger order_queue_updated_at
  before update on public.order_queue
  for each row
  execute function public.set_order_queue_updated_at();

alter table public.order_queue enable row level security;

create policy "order_queue_select_own"
  on public.order_queue for select to authenticated
  using (auth.uid() = user_id);

create policy "order_queue_insert_own"
  on public.order_queue for insert to authenticated
  with check (auth.uid() = user_id);

create policy "order_queue_update_own"
  on public.order_queue for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "order_queue_delete_own"
  on public.order_queue for delete to authenticated
  using (auth.uid() = user_id);

alter publication supabase_realtime add table public.order_queue;
