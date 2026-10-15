begin;

-- Keep email sign-ups able to save links from auth metadata on first insert.
create or replace function public.handle_new_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role public.member_role;
begin
  requested_role := case
    when new.raw_user_meta_data ->> 'member_role' = 'student' then 'student'::public.member_role
    else 'alumni'::public.member_role
  end;

  insert into public.profiles (
    id, first_name, last_name, member_role, graduation_year, specialty, city, country,
    experience, offers_mentoring, linkedin_url, portfolio_url
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'first_name', ''), 'Membre'),
    coalesce(nullif(new.raw_user_meta_data ->> 'last_name', ''), 'LSNB'),
    requested_role,
    nullif(new.raw_user_meta_data ->> 'graduation_year', '')::integer,
    coalesce(new.raw_user_meta_data ->> 'specialty', ''),
    new.raw_user_meta_data ->> 'city',
    new.raw_user_meta_data ->> 'country',
    coalesce(new.raw_user_meta_data ->> 'experience', ''),
    requested_role = 'alumni'::public.member_role
      and coalesce((new.raw_user_meta_data ->> 'offers_mentoring')::boolean, false),
    nullif(btrim(new.raw_user_meta_data ->> 'linkedin_url'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'portfolio_url'), '')
  );

  insert into public.profile_contacts (profile_id, email, is_visible)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce((new.raw_user_meta_data ->> 'contact_visible')::boolean, false)
  );
  return new;
end;
$$;

-- Google onboarding uses a distinct RPC so PostgREST never has to resolve
-- overloaded functions with the same name.
create or replace function public.complete_member_profile_with_links(
  p_first_name text,
  p_last_name text,
  p_member_role text,
  p_graduation_year integer,
  p_specialty text,
  p_city text,
  p_country text,
  p_experience text,
  p_gender text,
  p_offers_mentoring boolean,
  p_contact_visible boolean,
  p_terms_accepted boolean,
  p_linkedin_url text,
  p_portfolio_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed boolean;
  linkedin text := nullif(btrim(p_linkedin_url), '');
  portfolio text := nullif(btrim(p_portfolio_url), '');
begin
  if linkedin is not null and (linkedin !~ '^https://[^[:space:]]+$' or char_length(linkedin) > 500) then
    raise exception 'Invalid LinkedIn URL' using errcode = '22023';
  end if;
  if portfolio is not null and (portfolio !~ '^https://[^[:space:]]+$' or char_length(portfolio) > 500) then
    raise exception 'Invalid portfolio URL' using errcode = '22023';
  end if;

  completed := public.complete_member_profile(
    p_first_name, p_last_name, p_member_role, p_graduation_year, p_specialty,
    p_city, p_country, p_experience, p_gender, p_offers_mentoring,
    p_contact_visible, p_terms_accepted
  );
  if completed then
    update public.profiles
      set linkedin_url = linkedin, portfolio_url = portfolio
      where id = auth.uid();
  end if;
  return completed;
end;
$$;

revoke all on function public.complete_member_profile_with_links(text, text, text, integer, text, text, text, text, text, boolean, boolean, boolean, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_member_profile_with_links(text, text, text, integer, text, text, text, text, text, boolean, boolean, boolean, text, text)
  to authenticated;

commit;