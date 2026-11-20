-- Run after the existing tutoring portal schema.
-- The refresh token and OAuth state are server-only: do not add client SELECT policies.

alter table public.classes
  add column if not exists google_event_id text,
  add column if not exists calendar_event_url text,
  add column if not exists meeting_status text not null default 'manual';

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  google_email text not null,
  refresh_token text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_oauth_states (
  state text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.google_calendar_connections enable row level security;
alter table public.google_oauth_states enable row level security;

-- Intentionally no policies on these two tables. Only Edge Functions using the
-- Supabase service-role key may read or write OAuth credentials/state.
