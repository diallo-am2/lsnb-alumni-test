begin;

-- Request inbox ("Demandes").
--
-- connection_requests already stores every mentoring request and every message
-- sent from an offer. This migration adds what the inbox needs:
--   * a reference to the offer a message is about (a soft reference, no foreign
--     key: deleting an offer must never block or alter somebody's message);
--   * the contact details the recipient chooses to share when accepting;
--   * a "seen" marker so the requester gets a badge when an answer arrives;
--   * a table that makes e-mail notifications idempotent.

alter table public.connection_requests
  add column if not exists opportunity_id uuid,
  add column if not exists opportunity_title text,
  add column if not exists shared_email text,
  add column if not exists shared_phone text,
  add column if not exists requester_seen_at timestamptz;

alter table public.connection_requests
  drop constraint if exists connection_requests_opportunity_title_check,
  drop constraint if exists connection_requests_shared_email_check,
  drop constraint if exists connection_requests_shared_phone_check,
  drop constraint if exists connection_requests_shared_only_when_accepted;

alter table public.connection_requests
  add constraint connection_requests_opportunity_title_check
    check (opportunity_title is null or char_length(opportunity_title) between 1 and 140),
  add constraint connection_requests_shared_email_check
    check (shared_email is null or (
      char_length(shared_email) <= 254 and shared_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    )),
  -- International format only (E.164): "+" then 8 to 15 digits, no spaces.
  add constraint connection_requests_shared_phone_check
    check (shared_phone is null or shared_phone ~ '^[+][1-9][0-9]{7,14}$'),
  add constraint connection_requests_shared_only_when_accepted
    check ((shared_email is null and shared_phone is null) or status = 'accepted'::public.connection_request_status);

-- One pending request per (requester, recipient, kind) — and now per offer, so
-- somebody interested in two offers of the same author can write about both.
drop index if exists public.connection_requests_pending_unique_idx;
create unique index if not exists connection_requests_pending_unique_idx
  on public.connection_requests(
    requester_id, recipient_id, request_kind,
    coalesce(opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'pending';

create index if not exists connection_requests_requester_idx
  on public.connection_requests(requester_id, status, created_at desc);

-- Who may change what on a request.
--   * the content (people, kind, message, offer) never changes;
--   * a pending request can be answered by its recipient. Accepting requires at
--     least one shared contact, declining shares nothing;
--   * an answered request is frozen, except that the requester can mark the
--     answer as seen (through mark_request_answers_seen()).
create or replace function public.protect_connection_request_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.requester_id <> old.requester_id
    or new.recipient_id <> old.recipient_id
    or new.request_kind <> old.request_kind
    or new.message <> old.message
    or new.opportunity_id is distinct from old.opportunity_id
    or new.opportunity_title is distinct from old.opportunity_title then
    raise exception 'Only the request status can be changed';
  end if;

  if old.status <> 'pending'::public.connection_request_status then
    if new.status <> old.status
      or new.shared_email is distinct from old.shared_email
      or new.shared_phone is distinct from old.shared_phone
      or new.responded_at is distinct from old.responded_at then
      raise exception 'Only pending requests can be answered';
    end if;
    if new.requester_seen_at is distinct from old.requester_seen_at
      and auth.uid() is distinct from old.requester_id then
      raise exception 'Only the requester can mark an answer as seen';
    end if;
    return new;
  end if;

  if new.requester_seen_at is distinct from old.requester_seen_at then
    raise exception 'A pending request has no answer to mark as seen';
  end if;

  if new.status = 'accepted'::public.connection_request_status
    and new.shared_email is null and new.shared_phone is null then
    raise exception 'Accepting a request requires sharing at least one contact';
  end if;

  new.responded_at = now();
  return new;
end;
$$;

-- Marks every answered request of the caller as seen (clears the badge).
create or replace function public.mark_request_answers_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.connection_requests
     set requester_seen_at = now()
   where requester_id = auth.uid()
     and status <> 'pending'::public.connection_request_status
     and requester_seen_at is null;
$$;

revoke all on function public.mark_request_answers_seen() from public, anon;
grant execute on function public.mark_request_answers_seen() to authenticated;

-- E-mail notifications are sent by the API. A row here means "already sent", so
-- a request can never trigger the same e-mail twice. Only the API (service role)
-- can read or write it.
create table if not exists public.request_notifications (
  request_id uuid not null references public.connection_requests(id) on delete cascade,
  event text not null check (event in ('created', 'accepted')),
  sent_at timestamptz not null default now(),
  primary key (request_id, event)
);

alter table public.request_notifications enable row level security;
revoke all on public.request_notifications from public, anon, authenticated;
grant select, insert, delete on public.request_notifications to service_role;

commit;
