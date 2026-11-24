-- Email the tutor whenever a new student registers.
create extension if not exists pg_net with schema extensions;

alter table public.profiles add column if not exists notified_at timestamptz;

create or replace function public.notify_new_registration() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.role = 'student' then
    begin
      perform net.http_post(
        url := 'https://fypmgequvfwxoqgwbpxm.supabase.co/functions/v1/notify-registration',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('id', new.id)
      );
    exception when others then
      null; -- never block a registration because the notification failed
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_registered on public.profiles;
create trigger on_profile_registered
  after insert on public.profiles
  for each row execute function public.notify_new_registration();
