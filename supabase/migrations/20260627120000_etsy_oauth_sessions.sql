-- Server-side PKCE session store for the Etsy OAuth flow. The code_verifier is
-- persisted keyed by the OAuth `state` so the callback can recover it without
-- depending on cookies, which browsers frequently drop across the multi-hop
-- Etsy -> Google -> Etsy sign-in redirect chain (bounce-tracking protections).
create table if not exists public.etsy_oauth_sessions (
  state text primary key,
  user_id uuid not null,
  code_verifier text not null,
  created_at timestamptz not null default now()
);

create index if not exists etsy_oauth_sessions_created_idx
  on public.etsy_oauth_sessions (created_at);

-- No RLS policies: only the service role (server) may touch these short-lived
-- PKCE verifiers. anon/auth clients must never read or write them.
alter table public.etsy_oauth_sessions enable row level security;
