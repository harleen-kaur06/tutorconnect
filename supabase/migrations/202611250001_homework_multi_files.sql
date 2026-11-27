-- Allow several attachments per homework assignment.
create table if not exists public.homework_files (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homework(id) on delete cascade,
  drive_file_id text not null,
  file_name text not null,
  file_mime text,
  created_at timestamptz not null default now()
);

create index if not exists homework_files_homework_id_idx on public.homework_files(homework_id);

alter table public.homework_files enable row level security;

-- The tutor and the assigned student can see the attachments.
-- Files are written only by the upload-file Edge Function (service role).
drop policy if exists "homework_files_select" on public.homework_files;
create policy "homework_files_select" on public.homework_files
  for select to authenticated
  using (exists (
    select 1 from public.homework h
    where h.id = homework_files.homework_id
      and (h.student_id = auth.uid() or h.tutor_id = auth.uid())
  ));
