begin;

-- Guards on NEW connection requests (issue #6).
--
-- The row-level security policy only checks WHO sends a request. Nothing stopped a signed-in
-- member from calling the API directly and creating a request that is already "accepted", with a
-- contact of their choice, in somebody else's inbox. This trigger closes that gap and adds the
-- waiting period after a refusal.
--
-- It only applies to requests made by a signed-in member (auth.uid() is not null). Restores,
-- the replica and maintenance run without a member and are not affected.
--
-- Error messages are stable codes read by the site (src/lib/requestValidation.ts):
--   invalid_new_request   a new request must be pending and carry no answer
--   recipient_unavailable the recipient does not exist or is no longer active
--   request_cooldown      refused less than 24 h ago (the hint holds the end of the wait, UTC)

create or replace function public.guard_new_connection_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  blocked_until timestamptz;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.status <> 'pending'::public.connection_request_status
    or new.responded_at is not null
    or new.shared_email is not null
    or new.shared_phone is not null
    or new.requester_seen_at is not null then
    raise exception 'invalid_new_request' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles recipient
    where recipient.id = new.recipient_id and recipient.is_active
  ) then
    raise exception 'recipient_unavailable' using errcode = '42501';
  end if;

  -- After a refusal: 24 h before asking again, for mentoring requests and for messages about an
  -- offer (same person, same kind, same offer). Accepted requests never block a new one, and
  -- the requester cannot delete a refused request to get around the wait (only pending ones can
  -- be withdrawn).
  if new.request_kind = 'mentoring'::public.connection_request_kind or new.opportunity_id is not null then
    select max(r.responded_at) + interval '24 hours' into blocked_until
    from public.connection_requests r
    where r.requester_id = new.requester_id
      and r.recipient_id = new.recipient_id
      and r.request_kind = new.request_kind
      and r.opportunity_id is not distinct from new.opportunity_id
      and r.status = 'declined'::public.connection_request_status
      and r.responded_at > now() - interval '24 hours';

    if blocked_until is not null then
      raise exception 'request_cooldown'
        using errcode = 'P0001',
              hint = to_char(blocked_until at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_new_connection_request on public.connection_requests;
create trigger guard_new_connection_request
before insert on public.connection_requests
for each row execute function public.guard_new_connection_request();

commit;
