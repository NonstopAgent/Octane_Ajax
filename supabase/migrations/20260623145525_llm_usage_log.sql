-- LLM usage + estimated cost log. Powers the dashboard "LLM Cost · 7d" metric.
-- Rows are written best-effort from the central completeJson choke point and are
-- not user-attributed (the LLM layer has no request user), so reads are a global
-- rollup via the service client.
create table if not exists public.llm_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  task text,
  provider text not null default 'openai',
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists llm_usage_log_created_idx
  on public.llm_usage_log (created_at desc);

alter table public.llm_usage_log enable row level security;

-- Service role (server) bypasses RLS for inserts + the global cost rollup. This
-- policy lets a signed-in user read rows attributed to them (future per-user use).
drop policy if exists "llm_usage_own_read" on public.llm_usage_log;
create policy "llm_usage_own_read" on public.llm_usage_log
  for select using (auth.uid() = user_id);
