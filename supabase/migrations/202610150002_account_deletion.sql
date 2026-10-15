begin;

-- Account deletion policy: deactivate immediately, then purge after 30 days.
-- Requests, offers and generated Highlight snapshots follow profile cascades.
alter table public.profiles
  add column if not exists deletion_requested_at timestamptz;

create index if not exists profiles_deletion_requested_idx
  on public.profiles(deletion_requested_at)
  where deletion_requested_at is not null;

create or replace function public.protect_account_deletion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
    and old.deletion_requested_at is not null
    and (new.deletion_requested_at is null or new.is_active) then
    raise exception 'Account deletion is already scheduled' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_account_deletion on public.profiles;
create trigger protect_account_deletion
before update on public.profiles
for each row execute function public.protect_account_deletion();

create or replace function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_at timestamptz;
begin
  update public.profiles
    set deletion_requested_at = coalesce(deletion_requested_at, clock_timestamp()),
        is_active = false,
        offers_mentoring = false,
        mentoring_topics = '{}'
    where id = auth.uid()
    returning deletion_requested_at into requested_at;
  if requested_at is null then
    raise exception 'Member profile not found' using errcode = 'P0002';
  end if;
  return requested_at;
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

-- Called by a trusted daily job. Public rows are hidden immediately; this
-- function removes Storage objects before auth.users cascades remove all rows
-- owned by the profile, including requests, offers and Highlight snapshots.
create or replace function public.purge_deleted_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_id uuid;
  purged integer := 0;
begin
  for member_id in
    select id from public.profiles
    where deletion_requested_at <= clock_timestamp() - interval '30 days'
    order by deletion_requested_at
    for update
  loop
    delete from storage.objects
      where bucket_id in ('avatars', 'opportunity-media')
        and name like member_id::text || '/%';
    delete from auth.users where id = member_id;
    purged := purged + 1;
  end loop;
  return purged;
end;
$$;

revoke all on function public.purge_deleted_accounts() from public, anon, authenticated;
grant execute on function public.purge_deleted_accounts() to service_role;

comment on column public.profiles.deletion_requested_at is
  'Account deactivation is immediate; a trusted daily purge removes the account after 30 days.';

commit;
