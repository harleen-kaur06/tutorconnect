-- Homework files now live in the tutor's Google Drive. Store the Drive file id and display info.
alter table public.homework
  add column if not exists drive_file_id text,
  add column if not exists file_name text,
  add column if not exists file_mime text;

alter table public.submissions
  add column if not exists drive_file_id text,
  add column if not exists file_name text,
  add column if not exists file_mime text;
