begin;

-- Optional public links shown on a member's profile page.
-- Both columns are nullable: a profile without links stays valid, and existing
-- rows need no backfill. The "update their profile" RLS policy already lets a
-- member write these columns on their own row; no policy change is required.
alter table public.profiles
  add column if not exists linkedin_url text,
  add column if not exists portfolio_url text;

-- Defence in depth: the frontend validates too, but the database refuses
-- anything that is not an https:// URL without whitespace (so javascript:,
-- data: or http: values can never be rendered as a link).
alter table public.profiles drop constraint if exists profiles_linkedin_url_https;
alter table public.profiles add constraint profiles_linkedin_url_https
  check (linkedin_url is null or (linkedin_url ~ '^https://[^[:space:]]+$' and char_length(linkedin_url) <= 500));

alter table public.profiles drop constraint if exists profiles_portfolio_url_https;
alter table public.profiles add constraint profiles_portfolio_url_https
  check (portfolio_url is null or (portfolio_url ~ '^https://[^[:space:]]+$' and char_length(portfolio_url) <= 500));

comment on column public.profiles.linkedin_url is
  'Optional https:// link to the member''s LinkedIn profile. Public like the rest of the profile; never included in Highlight snapshots.';
comment on column public.profiles.portfolio_url is
  'Optional https:// link to the member''s portfolio or personal website. Public like the rest of the profile; never included in Highlight snapshots.';

commit;
