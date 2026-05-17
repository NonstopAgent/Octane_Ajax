-- Octane Ajax — core schema, RLS, seed agents
-- Apply: supabase db push | supabase migration up

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ajax_agents (system agents — no user_id; shared across authenticated users)
-- ---------------------------------------------------------------------------
create table public.ajax_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  role text not null,
  status text not null default 'idle',
  current_room text,
  current_task_id uuid,
  autonomy_level int not null default 0,
  last_heartbeat timestamptz,
  created_at timestamptz not null default now(),
  constraint ajax_agents_status_check check (
    status in ('idle', 'working', 'waiting', 'error', 'offline')
  ),
  constraint ajax_agents_autonomy_level_check check (
    autonomy_level >= 0 and autonomy_level <= 100
  )
);

comment on table public.ajax_agents is 'Nova, Forge, Pixel — system agent registry';

-- ---------------------------------------------------------------------------
-- ajax_tasks (per-user demo tasks)
-- ---------------------------------------------------------------------------
create table public.ajax_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  agent_slug text not null references public.ajax_agents (slug) on update cascade,
  task_type text not null,
  status text not null default 'queued',
  priority int not null default 5,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ajax_tasks_status_check check (
    status in ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  constraint ajax_tasks_priority_check check (priority between 1 and 10)
);

create index ajax_tasks_user_id_idx on public.ajax_tasks (user_id);
create index ajax_tasks_agent_slug_idx on public.ajax_tasks (agent_slug);
create index ajax_tasks_status_idx on public.ajax_tasks (status);

alter table public.ajax_agents
  add constraint ajax_agents_current_task_id_fkey
  foreign key (current_task_id) references public.ajax_tasks (id) on delete set null;

-- ---------------------------------------------------------------------------
-- product_ideas
-- ---------------------------------------------------------------------------
create table public.product_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  source text not null default 'nova',
  niche text,
  title text,
  description text,
  seo_keywords text[] not null default '{}',
  trend_score numeric not null default 0,
  status text not null default 'idea',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint product_ideas_status_check check (
    status in ('idea', 'selected', 'rejected', 'archived')
  )
);

create index product_ideas_user_id_idx on public.product_ideas (user_id);
create index product_ideas_status_idx on public.product_ideas (status);
create index product_ideas_created_at_idx on public.product_ideas (created_at desc);

-- ---------------------------------------------------------------------------
-- product_listings
-- ---------------------------------------------------------------------------
create table public.product_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  product_idea_id uuid not null references public.product_ideas (id) on delete cascade,
  title text,
  description text,
  price numeric,
  mockup_url text,
  platform text not null default 'demo',
  external_listing_id text,
  status text not null default 'pending_review',
  created_at timestamptz not null default now(),
  constraint product_listings_status_check check (
    status in (
      'draft',
      'pending_review',
      'approved',
      'rejected',
      'published',
      'archived'
    )
  )
);

create index product_listings_user_id_idx on public.product_listings (user_id);
create index product_listings_product_idea_id_idx on public.product_listings (product_idea_id);
create index product_listings_status_idx on public.product_listings (status);

-- ---------------------------------------------------------------------------
-- review_queue
-- ---------------------------------------------------------------------------
create table public.review_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  listing_id uuid not null references public.product_listings (id) on delete cascade,
  status text not null default 'pending',
  reviewer_notes text,
  rejection_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint review_queue_status_check check (
    status in ('pending', 'approved', 'rejected')
  ),
  constraint review_queue_listing_id_unique unique (listing_id)
);

create index review_queue_user_id_idx on public.review_queue (user_id);
create index review_queue_status_idx on public.review_queue (status);

-- ---------------------------------------------------------------------------
-- agent_feedback
-- ---------------------------------------------------------------------------
create table public.agent_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  agent_slug text not null references public.ajax_agents (slug) on update cascade,
  related_listing_id uuid references public.product_listings (id) on delete set null,
  feedback_type text not null,
  feedback_text text not null,
  created_at timestamptz not null default now(),
  constraint agent_feedback_type_check check (
    feedback_type in ('rejection', 'approval_note', 'quality', 'style', 'other')
  )
);

create index agent_feedback_user_id_idx on public.agent_feedback (user_id);
create index agent_feedback_agent_slug_idx on public.agent_feedback (agent_slug);

-- ---------------------------------------------------------------------------
-- factory_events (realtime-friendly activity log)
-- ---------------------------------------------------------------------------
create table public.factory_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  event_type text not null,
  agent_slug text references public.ajax_agents (slug) on update cascade on delete set null,
  room text,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index factory_events_user_id_idx on public.factory_events (user_id);
create index factory_events_created_at_idx on public.factory_events (created_at desc);
create index factory_events_event_type_idx on public.factory_events (event_type);

-- ---------------------------------------------------------------------------
-- content_jobs
-- ---------------------------------------------------------------------------
create table public.content_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  listing_id uuid not null references public.product_listings (id) on delete cascade,
  platform text not null default 'demo',
  content_type text not null default 'slideshow',
  status text not null default 'queued',
  asset_url text,
  caption text,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  constraint content_jobs_status_check check (
    status in ('queued', 'generating', 'ready', 'scheduled', 'published', 'failed')
  )
);

create index content_jobs_user_id_idx on public.content_jobs (user_id);
create index content_jobs_listing_id_idx on public.content_jobs (listing_id);
create index content_jobs_status_idx on public.content_jobs (status);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.ajax_agents enable row level security;
alter table public.ajax_tasks enable row level security;
alter table public.product_ideas enable row level security;
alter table public.product_listings enable row level security;
alter table public.review_queue enable row level security;
alter table public.agent_feedback enable row level security;
alter table public.factory_events enable row level security;
alter table public.content_jobs enable row level security;

-- ajax_agents: shared read/update for demo (seeded system agents)
create policy "ajax_agents_select_authenticated"
  on public.ajax_agents
  for select
  to authenticated
  using (true);

create policy "ajax_agents_insert_authenticated"
  on public.ajax_agents
  for insert
  to authenticated
  with check (true);

create policy "ajax_agents_update_authenticated"
  on public.ajax_agents
  for update
  to authenticated
  using (true)
  with check (true);

create policy "ajax_agents_delete_authenticated"
  on public.ajax_agents
  for delete
  to authenticated
  using (true);

-- Per-user tables: full CRUD on own rows
create policy "ajax_tasks_select_own"
  on public.ajax_tasks for select to authenticated
  using (auth.uid() = user_id);

create policy "ajax_tasks_insert_own"
  on public.ajax_tasks for insert to authenticated
  with check (auth.uid() = user_id);

create policy "ajax_tasks_update_own"
  on public.ajax_tasks for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "ajax_tasks_delete_own"
  on public.ajax_tasks for delete to authenticated
  using (auth.uid() = user_id);

create policy "product_ideas_select_own"
  on public.product_ideas for select to authenticated
  using (auth.uid() = user_id);

create policy "product_ideas_insert_own"
  on public.product_ideas for insert to authenticated
  with check (auth.uid() = user_id);

create policy "product_ideas_update_own"
  on public.product_ideas for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "product_ideas_delete_own"
  on public.product_ideas for delete to authenticated
  using (auth.uid() = user_id);

create policy "product_listings_select_own"
  on public.product_listings for select to authenticated
  using (auth.uid() = user_id);

create policy "product_listings_insert_own"
  on public.product_listings for insert to authenticated
  with check (auth.uid() = user_id);

create policy "product_listings_update_own"
  on public.product_listings for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "product_listings_delete_own"
  on public.product_listings for delete to authenticated
  using (auth.uid() = user_id);

create policy "review_queue_select_own"
  on public.review_queue for select to authenticated
  using (auth.uid() = user_id);

create policy "review_queue_insert_own"
  on public.review_queue for insert to authenticated
  with check (auth.uid() = user_id);

create policy "review_queue_update_own"
  on public.review_queue for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "review_queue_delete_own"
  on public.review_queue for delete to authenticated
  using (auth.uid() = user_id);

create policy "agent_feedback_select_own"
  on public.agent_feedback for select to authenticated
  using (auth.uid() = user_id);

create policy "agent_feedback_insert_own"
  on public.agent_feedback for insert to authenticated
  with check (auth.uid() = user_id);

create policy "agent_feedback_update_own"
  on public.agent_feedback for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "agent_feedback_delete_own"
  on public.agent_feedback for delete to authenticated
  using (auth.uid() = user_id);

create policy "factory_events_select_own"
  on public.factory_events for select to authenticated
  using (auth.uid() = user_id);

create policy "factory_events_insert_own"
  on public.factory_events for insert to authenticated
  with check (auth.uid() = user_id);

create policy "factory_events_update_own"
  on public.factory_events for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "factory_events_delete_own"
  on public.factory_events for delete to authenticated
  using (auth.uid() = user_id);

create policy "content_jobs_select_own"
  on public.content_jobs for select to authenticated
  using (auth.uid() = user_id);

create policy "content_jobs_insert_own"
  on public.content_jobs for insert to authenticated
  with check (auth.uid() = user_id);

create policy "content_jobs_update_own"
  on public.content_jobs for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "content_jobs_delete_own"
  on public.content_jobs for delete to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Realtime (factory floor event stream)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.factory_events;
alter publication supabase_realtime add table public.ajax_agents;

-- ---------------------------------------------------------------------------
-- Seed: Nova, Forge, Pixel
-- ---------------------------------------------------------------------------
insert into public.ajax_agents (name, slug, role, status, current_room, autonomy_level)
values
  ('Nova', 'nova', 'researcher', 'idle', 'research_lab', 0),
  ('Forge', 'forge', 'creator/operator', 'idle', 'design_press', 0),
  ('Pixel', 'pixel', 'media marketer', 'idle', 'media_studio', 0)
on conflict (slug) do update set
  name = excluded.name,
  role = excluded.role,
  current_room = excluded.current_room;
