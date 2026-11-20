-- Run this in Supabase SQL Editor. Then create a PRIVATE bucket named homework-files.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  role text not null check (role in ('tutor','student')) default 'student',
  created_at timestamptz default now()
);
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  meet_url text not null,
  created_at timestamptz default now()
);
create table public.homework (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  due_date date,
  file_url text,
  created_at timestamptz default now()
);
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homework(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  file_url text not null,
  feedback text,
  submitted_at timestamptz default now(),
  reviewed_at timestamptz
);

-- Create a profile automatically. New accounts default to student; change a tutor's role
-- in the Supabase Table Editor after signup, or implement an invite-only tutor flow.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,email,full_name,role)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),'student');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.homework enable row level security;
alter table public.submissions enable row level security;

create or replace function public.is_tutor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='tutor');
$$;
create policy "Users can read own profile and tutors can see profiles" on public.profiles
for select using (id = auth.uid() or public.is_tutor());
-- Role changes are intentionally not allowed from the client. Set the first tutor role
-- manually in Supabase SQL Editor after signup: update public.profiles set role='tutor' where email='you@example.com';

create policy "Class participants can read" on public.classes
for select using (tutor_id=auth.uid() or student_id=auth.uid());
create policy "Tutor can create classes" on public.classes
for insert with check (tutor_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='tutor'));
create policy "Tutor can update own classes" on public.classes
for update using (tutor_id=auth.uid()) with check (tutor_id=auth.uid());
create policy "Tutor can delete own classes" on public.classes
for delete using (tutor_id=auth.uid());

create policy "Homework participants can read" on public.homework
for select using (tutor_id=auth.uid() or student_id=auth.uid());
create policy "Tutor can create homework" on public.homework
for insert with check (tutor_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='tutor'));
create policy "Tutor can update own homework" on public.homework
for update using (tutor_id=auth.uid()) with check (tutor_id=auth.uid());
create policy "Tutor can delete own homework" on public.homework
for delete using (tutor_id=auth.uid());

create policy "Participants can read submissions" on public.submissions
for select using (student_id=auth.uid() or exists(select 1 from public.homework h where h.id=homework_id and h.tutor_id=auth.uid()));
create policy "Student can submit own work" on public.submissions
for insert with check (student_id=auth.uid() and exists(select 1 from public.homework h where h.id=homework_id and h.student_id=auth.uid()));
create policy "Tutor can review submissions" on public.submissions
for update using (exists(select 1 from public.homework h where h.id=homework_id and h.tutor_id=auth.uid()))
with check (exists(select 1 from public.homework h where h.id=homework_id and h.tutor_id=auth.uid()));

-- Storage: private bucket; authenticated users can upload to their own folder.
insert into storage.buckets(id,name,public) values('homework-files','homework-files',false)
on conflict (id) do nothing;
create policy "Users upload into own folder" on storage.objects
for insert to authenticated with check (bucket_id='homework-files' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Authenticated users read homework files" on storage.objects
for select to authenticated using (bucket_id='homework-files' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_tutor()));
