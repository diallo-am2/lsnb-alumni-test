begin;

-- Atomic replacement of the files attached to an offer.
--
-- An offer holds at most 1 PDF and 5 images (trigger enforce_opportunity_media_rules),
-- so replacing a PDF, or an image on an offer that already has 5, means "remove the
-- old row, then add the new one". Doing that from the browser in two calls could
-- leave an offer without its file if the second call failed. This function does both
-- in one transaction: either the whole replacement happens, or nothing changes.
--
-- The caller uploads the new files to storage first, then calls this function with
-- their paths. It returns the storage paths of the removed files so the caller can
-- delete those objects afterwards (an orphaned object is harmless; a missing one is not).
--
-- security invoker: row-level security applies, so only the offer's author can use it.

create or replace function public.replace_opportunity_media(
  p_opportunity_id uuid,
  p_remove_ids uuid[],
  p_new jsonb
)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  next_position integer;
  removed_paths text[];
begin
  if jsonb_typeof(coalesce(p_new, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Liste de fichiers invalide.';
  end if;

  with removed as (
    delete from public.opportunity_media
    where opportunity_id = p_opportunity_id
      and id = any(coalesce(p_remove_ids, '{}'::uuid[]))
    returning storage_path
  )
  select coalesce(array_agg(storage_path), '{}'::text[]) into removed_paths from removed;

  select coalesce(max(position), -1) + 1 into next_position
  from public.opportunity_media
  where opportunity_id = p_opportunity_id and kind = 'image';

  for item in select value from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) loop
    insert into public.opportunity_media (opportunity_id, kind, storage_path, alt_text, position)
    values (
      p_opportunity_id,
      (item ->> 'kind')::public.opportunity_media_kind,
      item ->> 'storage_path',
      left(nullif(btrim(item ->> 'alt_text'), ''), 200),
      case when item ->> 'kind' = 'image' then least(next_position, 10) else 0 end
    );
    if item ->> 'kind' = 'image' then
      next_position := next_position + 1;
    end if;
  end loop;

  return removed_paths;
end;
$$;

revoke all on function public.replace_opportunity_media(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.replace_opportunity_media(uuid, uuid[], jsonb) to authenticated;

commit;
