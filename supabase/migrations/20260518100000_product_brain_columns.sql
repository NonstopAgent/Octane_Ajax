-- Product Brain evaluation columns for product_ideas
-- These store the deterministic scoring and compliance results from src/lib/product-brain/

alter table public.product_ideas
  add column if not exists brain_score jsonb not null default '{}'::jsonb,
  add column if not exists brain_validation jsonb not null default '{}'::jsonb,
  add column if not exists brain_verdict text
    constraint product_ideas_brain_verdict_check
    check (brain_verdict in ('strong', 'viable', 'weak', 'blocked') or brain_verdict is null),
  add column if not exists brain_evaluated_at timestamptz;

create index if not exists product_ideas_brain_verdict_idx
  on public.product_ideas (brain_verdict);

comment on column public.product_ideas.brain_score is
  'BrainScore JSON: {specificity, format_fit, compliance, demand, total}';

comment on column public.product_ideas.brain_validation is
  'BrainValidation JSON: {compliance_flags, compliance_warnings, strengths, weaknesses}';

comment on column public.product_ideas.brain_verdict is
  'Final Product Brain verdict: strong | viable | weak | blocked';
