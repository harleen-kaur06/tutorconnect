alter table public.profiles
  add column if not exists child_name text,
  add column if not exists grade text,
  add column if not exists learning_needs text,
  add column if not exists welcome_sent_at timestamptz;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.profiles(id,email,full_name,role,child_name,grade,learning_needs)
  values(new.id,new.email,
    coalesce(new.raw_user_meta_data->>'full_name',''),'student',
    new.raw_user_meta_data->>'child_name',
    new.raw_user_meta_data->>'grade',
    new.raw_user_meta_data->>'learning_needs');
  return new;
end; $$;
