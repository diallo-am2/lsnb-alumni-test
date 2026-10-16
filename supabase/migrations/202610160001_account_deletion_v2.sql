begin;

-- Account deletion, second version (issue #7).
-- A member can cancel during the 30-day grace period. Final deletion is
-- performed by a trusted script through Storage and Auth admin APIs.
alter table public.profiles
  add column if not exists deletion_notice_sent_at timestamptz;

drop function if exists public.purge_deleted_accounts();

create or replace function public.cancel_account_deletion()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  restored integer;
begin
  update public.profiles
    set deletion_requested_at = null,
        deletion_notice_sent_at = null,
        is_active = true
    where id = auth.uid()
      and deletion_requested_at is not null;
  get diagnostics restored = row_count;
  return restored > 0;
end;
$$;

revoke all on function public.cancel_account_deletion() from public, anon;
grant execute on function public.cancel_account_deletion() to authenticated;

create or replace function public.list_accounts_due_for_purge(p_limit integer default 50)
returns table (id uuid, deletion_requested_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.deletion_requested_at
  from public.profiles p
  where p.deletion_requested_at <= clock_timestamp() - interval '30 days'
  order by p.deletion_requested_at
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

revoke all on function public.list_accounts_due_for_purge(integer) from public, anon, authenticated;
grant execute on function public.list_accounts_due_for_purge(integer) to service_role;

create or replace function public.protect_account_deletion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.deletion_requested_at is distinct from old.deletion_requested_at
      or new.deletion_notice_sent_at is distinct from old.deletion_notice_sent_at then
      raise exception 'Use the account deletion functions' using errcode = '42501';
    end if;
    if old.deletion_requested_at is not null and new.is_active then
      raise exception 'Account deletion is already scheduled' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on column public.profiles.deletion_notice_sent_at is
  'Set once the confirmation e-mail is sent; cleared when deletion is cancelled.';

commit;
