-- Tutor approval for new student accounts.
-- Existing accounts stay active; new sign-ups start unapproved until the tutor approves them.
alter table public.profiles
  add column if not exists approved boolean not null default false;

update public.profiles set approved = true;

-- Browser clients (anon / authenticated) can never approve themselves.
-- Only the service role (the `manage` Edge Function) or the SQL editor can change `approved`.
create or replace function public.protect_profile_approval()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(auth.role(), '') in ('authenticated', 'anon') then
      new.approved := false;
    end if;
  elsif new.approved is distinct from old.approved
        and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'Only the tutor can approve students.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_approval on public.profiles;
create trigger protect_profile_approval
  before insert or update on public.profiles
  for each row execute function public.protect_profile_approval();
