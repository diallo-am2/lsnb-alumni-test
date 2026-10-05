begin;

-- Opportunities ("Offres"): scholarships, internships, jobs and other posts
-- shared by members. Published immediately; readable by signed-in members only.
--
-- Safeguards instead of prior moderation:
--   * at most 5 new offers per author per 24 hours;
--   * a member can report an offer; 3 distinct reports hide it automatically
--     (status = 'hidden'). Restoring one is a manual, administrator action:
--       update public.opportunities set status = 'published' where id = '<id>';
--   * https:// only for every link, size limits on every text field.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'opportunity_kind') then
    create type public.opportunity_kind as enum ('scholarship', 'internship', 'job', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'opportunity_status') then
    create type public.opportunity_status as enum ('published', 'closed', 'hidden');
  end if;
  if not exists (select 1 from pg_type where typname = 'opportunity_media_kind') then
    create type public.opportunity_media_kind as enum ('image', 'document');
  end if;
end
$$;

create or replace function public.is_https_url(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value ~ '^https://[^[:space:]]+$' and char_length(value) <= 500
$$;

-- extra_links: json array of at most 5 objects {"label": text, "url": https url}
create or replace function public.valid_opportunity_links(links jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(links) is distinct from 'array' or jsonb_array_length(links) > 5 then
    return false;
  end if;
  for item in select value from jsonb_array_elements(links) loop
    if jsonb_typeof(item) is distinct from 'object'
       or coalesce(jsonb_typeof(item -> 'label'), '') <> 'string'
       or coalesce(jsonb_typeof(item -> 'url'), '') <> 'string'
       or char_length(btrim(item ->> 'label')) not between 1 and 60
       or not public.is_https_url(item ->> 'url') then
      return false;
    end if;
  end loop;
  return true;
end
$$;

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind public.opportunity_kind not null,
  title text not null check (char_length(btrim(title)) between 5 and 140),
  organization text not null check (char_length(btrim(organization)) between 2 and 120),
  summary text not null check (char_length(btrim(summary)) between 20 and 280),
  description text not null check (char_length(btrim(description)) between 20 and 8000),
  country text check (country is null or char_length(country) <= 80),
  city text check (city is null or char_length(city) <= 80),
  is_remote boolean not null default false,
  domain text check (domain is null or char_length(domain) <= 80),
  apply_url text check (apply_url is null or public.is_https_url(apply_url)),
  extra_links jsonb not null default '[]'::jsonb check (public.valid_opportunity_links(extra_links)),
  deadline date,
  status public.opportunity_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists opportunities_status_created_idx on public.opportunities(status, created_at desc);
create index if not exists opportunities_author_idx on public.opportunities(author_id, created_at desc);
create index if not exists opportunities_kind_idx on public.opportunities(kind);

-- Images (max 5, the first one is the cover) and one PDF document per offer.
create table if not exists public.opportunity_media (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  kind public.opportunity_media_kind not null,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  alt_text text check (alt_text is null or char_length(alt_text) <= 200),
  position integer not null default 0 check (position between 0 and 10),
  created_at timestamptz not null default now()
);

create index if not exists opportunity_media_offer_idx on public.opportunity_media(opportunity_id, kind, position);

create table if not exists public.opportunity_reports (
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 10 and 500),
  created_at timestamptz not null default now(),
  primary key (opportunity_id, reporter_id)
);

-- Triggers ------------------------------------------------------------------

drop trigger if exists set_opportunities_updated_at on public.opportunities;
create trigger set_opportunities_updated_at
before update on public.opportunities
for each row execute function public.set_updated_at();

create or replace function public.enforce_opportunity_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.opportunities
    where author_id = new.author_id and created_at > now() - interval '24 hours'
  ) >= 5 then
    raise exception 'Limite atteinte : 5 offres par 24 heures. Réessayez plus tard.';
  end if;
  return new;
end
$$;

drop trigger if exists enforce_opportunity_rate_limit on public.opportunities;
create trigger enforce_opportunity_rate_limit
before insert on public.opportunities
for each row execute function public.enforce_opportunity_rate_limit();

create or replace function public.enforce_opportunity_media_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  offer_author uuid;
  existing integer;
begin
  select author_id into offer_author from public.opportunities where id = new.opportunity_id;
  if offer_author is null or split_part(new.storage_path, '/', 1) <> offer_author::text then
    raise exception 'Chemin de fichier invalide pour cette offre.';
  end if;

  select count(*) into existing
  from public.opportunity_media
  where opportunity_id = new.opportunity_id and kind = new.kind;

  if new.kind = 'image' and existing >= 5 then
    raise exception 'Maximum 5 images par offre.';
  end if;
  if new.kind = 'document' and existing >= 1 then
    raise exception 'Un seul document PDF par offre.';
  end if;
  return new;
end
$$;

drop trigger if exists enforce_opportunity_media_rules on public.opportunity_media;
create trigger enforce_opportunity_media_rules
before insert on public.opportunity_media
for each row execute function public.enforce_opportunity_media_rules();

create or replace function public.hide_reported_opportunity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.opportunity_reports where opportunity_id = new.opportunity_id
  ) >= 3 then
    update public.opportunities
    set status = 'hidden'
    where id = new.opportunity_id and status = 'published';
  end if;
  return new;
end
$$;

drop trigger if exists hide_reported_opportunity on public.opportunity_reports;
create trigger hide_reported_opportunity
after insert on public.opportunity_reports
for each row execute function public.hide_reported_opportunity();

-- Row Level Security --------------------------------------------------------

alter table public.opportunities enable row level security;
alter table public.opportunity_media enable row level security;
alter table public.opportunity_reports enable row level security;

drop policy if exists "Members can read published opportunities" on public.opportunities;
create policy "Members can read published opportunities"
on public.opportunities for select
to authenticated
using (status = 'published' or author_id = auth.uid());

drop policy if exists "Members can publish opportunities" on public.opportunities;
create policy "Members can publish opportunities"
on public.opportunities for insert
to authenticated
with check (author_id = auth.uid() and status = 'published');

-- Authors may edit, close or reopen their own offers, but never touch a hidden one
-- and never set 'hidden' themselves.
drop policy if exists "Authors can update their opportunities" on public.opportunities;
create policy "Authors can update their opportunities"
on public.opportunities for update
to authenticated
using (author_id = auth.uid() and status <> 'hidden')
with check (author_id = auth.uid() and status in ('published', 'closed'));

drop policy if exists "Authors can delete their opportunities" on public.opportunities;
create policy "Authors can delete their opportunities"
on public.opportunities for delete
to authenticated
using (author_id = auth.uid());

drop policy if exists "Members can read media of visible opportunities" on public.opportunity_media;
create policy "Members can read media of visible opportunities"
on public.opportunity_media for select
to authenticated
using (exists (
  select 1 from public.opportunities o where o.id = opportunity_media.opportunity_id
));

drop policy if exists "Authors can add media" on public.opportunity_media;
create policy "Authors can add media"
on public.opportunity_media for insert
to authenticated
with check (exists (
  select 1 from public.opportunities o
  where o.id = opportunity_media.opportunity_id and o.author_id = auth.uid() and o.status <> 'hidden'
));

drop policy if exists "Authors can update media" on public.opportunity_media;
create policy "Authors can update media"
on public.opportunity_media for update
to authenticated
using (exists (
  select 1 from public.opportunities o
  where o.id = opportunity_media.opportunity_id and o.author_id = auth.uid() and o.status <> 'hidden'
))
with check (exists (
  select 1 from public.opportunities o
  where o.id = opportunity_media.opportunity_id and o.author_id = auth.uid()
));

drop policy if exists "Authors can delete media" on public.opportunity_media;
create policy "Authors can delete media"
on public.opportunity_media for delete
to authenticated
using (exists (
  select 1 from public.opportunities o
  where o.id = opportunity_media.opportunity_id and o.author_id = auth.uid()
));

drop policy if exists "Members can read their reports" on public.opportunity_reports;
create policy "Members can read their reports"
on public.opportunity_reports for select
to authenticated
using (reporter_id = auth.uid());

drop policy if exists "Members can report opportunities" on public.opportunity_reports;
create policy "Members can report opportunities"
on public.opportunity_reports for insert
to authenticated
with check (
  reporter_id = auth.uid()
  and exists (
    select 1 from public.opportunities o
    where o.id = opportunity_reports.opportunity_id and o.author_id <> auth.uid()
  )
);

-- Storage: private bucket (readable by signed-in members through signed URLs).
-- Files live under <author_id>/<opportunity_id>/<file>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'opportunity-media',
  'opportunity-media',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members can read opportunity media files" on storage.objects;
create policy "Members can read opportunity media files"
on storage.objects for select
to authenticated
using (bucket_id = 'opportunity-media');

drop policy if exists "Members can upload their opportunity media" on storage.objects;
create policy "Members can upload their opportunity media"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'opportunity-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Members can delete their opportunity media" on storage.objects;
create policy "Members can delete their opportunity media"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'opportunity-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
