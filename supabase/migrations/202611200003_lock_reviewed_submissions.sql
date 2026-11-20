-- Once a tutor has sent feedback, the submission (and its feedback) can no longer be changed.
create or replace function public.lock_reviewed_submissions()
returns trigger language plpgsql as $$
begin
  if old.reviewed_at is not null then
    raise exception 'This submission has already been reviewed and cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_reviewed_submissions on public.submissions;
create trigger lock_reviewed_submissions
  before update on public.submissions
  for each row execute function public.lock_reviewed_submissions();
