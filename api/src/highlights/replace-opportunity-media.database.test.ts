import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

let db: PGlite

async function migration(name: string) {
  await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
}

async function member(name: string): Promise<string> {
  const result = await db.query<{ id: string }>('select gen_random_uuid()::text as id')
  const id = result.rows[0]!.id
  await db.query(
    'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
    [id, `${id}@example.test`, JSON.stringify({ first_name: name, last_name: 'Test', member_role: 'alumni' })],
  )
  return id
}

async function as<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
  await db.exec('set role authenticated')
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', '', false)")
  }
}

async function offer(authorId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.opportunities (author_id, kind, title, organization, summary, description)
     values ($1, 'scholarship', 'Bourse d’excellence 2027', 'Fondation Exemple',
             'Une bourse complète pour étudier en master à l’étranger.',
             'Description détaillée de la bourse, des conditions et du calendrier de candidature.')
     returning id`, [authorId])
  return rows[0]!.id
}

let counter = 0
const path = (authorId: string, ext: string) => `${authorId}/${crypto.randomUUID()}-${counter++}.${ext}`

async function addMedia(offerId: string, p: string, kind: 'image' | 'document', position = 0): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'insert into public.opportunity_media (opportunity_id, kind, storage_path, position) values ($1, $2, $3, $4) returning id',
    [offerId, kind, p, position])
  return rows[0]!.id
}

const replace = (userId: string, offerId: string, remove: string[], add: object[]) =>
  as(userId, async () => (await db.query<{ replace_opportunity_media: string[] }>(
    'select public.replace_opportunity_media($1, $2::uuid[], $3::jsonb)',
    [offerId, remove, JSON.stringify(add)])).rows[0]!.replace_opportunity_media)

const media = async (offerId: string) => (await db.query<{ id: string; kind: string; storage_path: string; alt_text: string | null; position: number }>(
  'select id, kind, storage_path, alt_text, position from public.opportunity_media where opportunity_id = $1 order by kind, position, created_at', [offerId])).rows

describe('replace_opportunity_media', { concurrency: false }, () => {
  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create schema storage;
      grant usage on schema public, auth, storage to anon, authenticated, service_role;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1, ''/'')';
    `)
    await migration('202609040001_initial_schema.sql')
    await migration('202610050002_opportunities.sql')
    await migration('202610070001_replace_opportunity_media.sql')
    await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated')
  })
  after(async () => { await db.close() })

  it('can be applied twice', async () => {
    await migration('202610070001_replace_opportunity_media.sql')
  })

  it('replaces the only PDF, which the one-PDF rule alone would refuse, and returns the old path', async () => {
    const author = await member('Awa')
    const id = await offer(author)
    const oldPath = path(author, 'pdf')
    const oldDoc = await addMedia(id, oldPath, 'document')
    const newPath = path(author, 'pdf')

    // Why this function exists: adding the new PDF before removing the old one is refused.
    await assert.rejects(addMedia(id, path(author, 'pdf'), 'document'), /Un seul document PDF par offre/)

    const removed = await replace(author, id, [oldDoc], [{ kind: 'document', storage_path: newPath, alt_text: 'dossier-candidature.pdf' }])

    assert.deepEqual(removed, [oldPath])
    const rows = await media(id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.storage_path, newPath)
    assert.equal(rows[0]?.alt_text, 'dossier-candidature.pdf')
  })

  it('replaces an image on an offer that already has five, appending after the existing ones', async () => {
    const author = await member('Awa')
    const id = await offer(author)
    const ids: string[] = []
    for (let position = 0; position < 5; position++) ids.push(await addMedia(id, path(author, 'jpg'), 'image', position))

    await replace(author, id, [ids[2]!], [{ kind: 'image', storage_path: path(author, 'webp'), alt_text: '  Affiche  ' }])

    const rows = (await media(id)).filter((row) => row.kind === 'image')
    assert.equal(rows.length, 5)
    assert.equal(rows.some((row) => row.id === ids[2]), false)
    const added = rows.find((row) => row.alt_text === 'Affiche')
    assert.ok(added, 'alt text is trimmed')
    assert.equal(added?.position, 5)
  })

  it('adds files without removing anything and keeps positions in range', async () => {
    const author = await member('Awa')
    const id = await offer(author)
    await replace(author, id, [], [
      { kind: 'image', storage_path: path(author, 'jpg'), alt_text: '' },
      { kind: 'image', storage_path: path(author, 'png') },
      { kind: 'document', storage_path: path(author, 'pdf') },
    ])
    const rows = await media(id)
    assert.deepEqual(rows.filter((r) => r.kind === 'image').map((r) => r.position), [0, 1])
    assert.equal(rows.find((r) => r.kind === 'image')?.alt_text, null)
    assert.equal(rows.filter((r) => r.kind === 'document').length, 1)
  })

  it('is all or nothing: a refused addition leaves the removed file in place', async () => {
    const author = await member('Awa')
    const id = await offer(author)
    const oldDoc = await addMedia(id, path(author, 'pdf'), 'document')
    const before = await media(id)

    await assert.rejects(replace(author, id, [oldDoc], [
      { kind: 'document', storage_path: path(author, 'pdf') },
      { kind: 'document', storage_path: path(author, 'pdf') },
    ]), /Un seul document PDF par offre/)

    assert.deepEqual(await media(id), before)
  })

  it('refuses a path outside the author folder and rolls back', async () => {
    const author = await member('Awa')
    const other = await member('Issa')
    const id = await offer(author)
    const oldDoc = await addMedia(id, path(author, 'pdf'), 'document')
    const before = await media(id)

    await assert.rejects(replace(author, id, [oldDoc], [{ kind: 'document', storage_path: path(other, 'pdf') }]), /Chemin de fichier invalide/)
    assert.deepEqual(await media(id), before)
  })

  it('only touches the given offer, even if the ids belong to another one', async () => {
    const author = await member('Awa')
    const first = await offer(author)
    const second = await offer(author)
    const foreignDoc = await addMedia(second, path(author, 'pdf'), 'document')

    const removed = await replace(author, first, [foreignDoc], [])

    assert.deepEqual(removed, [])
    assert.equal((await media(second)).length, 1)
  })

  it('does not let another member change an offer\'s files (row-level security)', async () => {
    const author = await member('Awa')
    const stranger = await member('Issa')
    const id = await offer(author)
    const doc = await addMedia(id, path(author, 'pdf'), 'document')

    assert.deepEqual(await replace(stranger, id, [doc], []), [])
    await assert.rejects(replace(stranger, id, [], [{ kind: 'image', storage_path: path(stranger, 'jpg') }]))
    assert.equal((await media(id)).length, 1)
  })

  it('rejects a malformed list', async () => {
    const author = await member('Awa')
    const id = await offer(author)
    await assert.rejects(as(author, () => db.query(
      "select public.replace_opportunity_media($1, '{}'::uuid[], '{\"kind\":\"image\"}'::jsonb)", [id])), /Liste de fichiers invalide/)
  })
})
