-- Phase 2: Product Brain persistence + generation artifacts (additive only)

-- ---------------------------------------------------------------------------
-- product_ideas: Product Brain scores / verdict (nullable — demo inserts unchanged)
-- ---------------------------------------------------------------------------
alter table public.product_ideas
  add column if not exists brain_score jsonb not null default '{}'::jsonb,
  add column if not exists brain_validation jsonb not null default '{}'::jsonb,
  add column if not exists brain_verdict text,
  add column if not exists brain_evaluated_at timestamptz;

comment on column public.product_ideas.brain_score is
  'Product Brain dimension scores (urgency, specificity, buyerClarity, usefulness, competitionRisk, complianceRisk, totalScore)';

comment on column public.product_ideas.brain_validation is
  'Product Brain validation snapshot (riskLevel, violations)';

comment on column public.product_ideas.brain_verdict is
  'approve_for_generation | needs_revision | blocked';

alter table public.product_ideas
  add constraint product_ideas_brain_verdict_check check (
    brain_verdict is null
    or brain_verdict in (
      'approve_for_generation',
      'needs_revision',
      'blocked'
    )
  );

create index if not exists product_ideas_brain_verdict_idx
  on public.product_ideas (brain_verdict)
  where brain_verdict is not null;

-- ---------------------------------------------------------------------------
-- product_generations: structure, LLM metadata, PDF placeholders, compliance
-- ---------------------------------------------------------------------------
create table if not exists public.product_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  product_idea_id uuid not null references public.product_ideas (id) on delete cascade,
  product_listing_id uuid references public.product_listings (id) on delete set null,
  structure jsonb not null default '{}'::jsonb,
  llm_provider text,
  llm_model text,
  prompt_version text,
  token_estimate_input integer,
  token_estimate_output integer,
  generation_status text not null default 'pending',
  pdf_storage_path text,
  pdf_public_url text,
  compliance_flags jsonb not null default '[]'::jsonb,
  compliance_warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_generations_status_check check (
    generation_status in (
      'pending',
      'queued',
      'generating',
      'ready',
      'failed'
    )
  ),
  constraint product_generations_token_estimates_check check (
    (token_estimate_input is null or token_estimate_input >= 0)
    and (token_estimate_output is null or token_estimate_output >= 0)
  )
);

comment on table public.product_generations is
  'Forge pipeline: generated product structure, LLM run metadata, PDF asset placeholders, compliance';

comment on column public.product_generations.structure is
  'Page/section layout and copy placeholders (JSON document)';

create index if not exists product_generations_user_id_idx
  on public.product_generations (user_id);

create index if not exists product_generations_product_idea_id_idx
  on public.product_generations (product_idea_id);

create index if not exists product_generations_product_listing_id_idx
  on public.product_generations (product_listing_id)
  where product_listing_id is not null;

create index if not exists product_generations_status_idx
  on public.product_generations (generation_status);

-- Keep updated_at fresh on row changes
create or replace function public.set_product_generations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists product_generations_set_updated_at on public.product_generations;

create trigger product_generations_set_updated_at
  before update on public.product_generations
  for each row
  execute function public.set_product_generations_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: product_generations (per-user, same pattern as product_listings)
-- ---------------------------------------------------------------------------
alter table public.product_generations enable row level security;

create policy "product_generations_select_own"
  on public.product_generations for select to authenticated
  using (auth.uid() = user_id);

create policy "product_generations_insert_own"
  on public.product_generations for insert to authenticated
  with check (auth.uid() = user_id);

create policy "product_generations_update_own"
  on public.product_generations for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "product_generations_delete_own"
  on public.product_generations for delete to authenticated
  using (auth.uid() = user_id);
