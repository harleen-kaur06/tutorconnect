-- Store each class's length so the app can mark it completed and hide the Meet link afterwards.
-- Existing classes default to 60 minutes.
alter table public.classes
  add column if not exists duration_minutes integer not null default 60;
