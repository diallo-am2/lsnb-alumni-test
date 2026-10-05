import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

let db: PGlite

async function migration(name: string) {
  await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
}

// public.handle_new_member() creates the profile row when an auth user is inserted.
async function member(name: string): Promise<string> {
  const result = await db.query<{ id: string }>('select gen_random_uuid()::text as id')
  const id = result.rows[0]!.id
  await db.query(
    'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
    [id, `${id}@example.test`, JSON.stringify({ first_name: name, last_name: 'Test', member_role: 'alumni' })],
  )
  return id
}

/** Runs `fn` as the given signed-in member (role `authenticated`, RLS enforced). */
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

const validOffer = {
  kind: 'scholarship',
  title: 'Bourse d’excellence 2027',
  organization: 'Fondation Exemple',
  summary: 'Une bourse complète pour étudier en master à l’étranger.',
  description: 'Description détaillée de la bourse, des conditions et du calendrier de candidature.',
}

async function publish(authorId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const o = { ...validOffer, ...overrides }
  const { rows } = await db.query<{ id: string }>(
    `insert into public.opportunities
       (author_id, kind, title, organization, summary, description, apply_url, extra_links, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, coalesce($9, 'published')::public.opportunity_status)
     returning id`,
    [authorId, o.kind, o.title, o.organization, o.summary, o.description, o.apply_url ?? null,
      JSON.stringify(o.extra_links ?? []), o.status ?? null],
  )
  return rows[0]!.id
}

const addMedia = (offerId: string, path: string, kind: 'image' | 'document' = 'image') =>
  db.query('insert into public.opportunity_media (opportunity_id, kind, storage_path) values ($1, $2, $3)', [offerId, kind, path])

const visibleOffers = async (userId: string) =>
  as(userId, async () => (await db.query<{ id: string }>('select id from public.opportunities')).rows.map((r) => r.id))

describe('opportunities migration', { concurrency: false }, () => {
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
    await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated')
  })
  after(async () => { await db.close() })

  it('can be applied twice and creates a private bucket', async () => {
    await migration('202610050002_opportunities.sql')
    const { rows } = await db.query<{ public: boolean; file_size_limit: string }>(
      "select public, file_size_limit from storage.buckets where id = 'opportunity-media'",
    )
    assert.equal(rows[0]?.public, false)
    assert.equal(Number(rows[0]?.file_size_limit), 8388608)
  })

  describe('constraints', () => {
    it('accepts a valid offer with defaults and https links', async () => {
      const author = await member('Awa')
      const id = await publish(author, {
        apply_url: 'https://fondation.example.org/candidater',
        extra_links: [{ label: 'Site', url: 'https://fondation.example.org' }],
      })
      const { rows } = await db.query<{ status: string; is_remote: boolean }>(
        'select status, is_remote from public.opportunities where id = $1', [id])
      assert.deepEqual(rows[0], { status: 'published', is_remote: false })
    })

    for (const [label, overrides, pattern] of [
      ['an http apply_url', { apply_url: 'http://example.org' }, /apply_url/],
      ['a javascript: apply_url', { apply_url: 'javascript:alert(1)' }, /apply_url/],
      ['a too short title', { title: 'Bo' }, /title/],
      ['a too short description', { description: 'trop court' }, /description/],
      ['more than 5 extra links', {
        extra_links: Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, url: 'https://example.org' })) }, /extra_links/],
      ['an extra link without https', { extra_links: [{ label: 'x', url: 'ftp://example.org' }] }, /extra_links/],
      ['an extra link without label', { extra_links: [{ url: 'https://example.org' }] }, /extra_links/],
      ['extra_links that is not an array', { extra_links: { label: 'x' } }, /extra_links/],
    ] as const) {
      it(`rejects ${label}`, async () => {
        const author = await member('Awa')
        await assert.rejects(() => publish(author, overrides as Record<string, unknown>), pattern)
      })
    }
  })

  describe('row level security', () => {
    it('lets any member read published offers, but only the author sees closed ones', async () => {
      const author = await member('Awa')
      const reader = await member('Issa')
      const open = await publish(author)
      const closed = await publish(author)
      await as(author, () => db.query("update public.opportunities set status = 'closed' where id = $1", [closed]))
      assert.ok((await visibleOffers(reader)).includes(open))
      assert.ok(!(await visibleOffers(reader)).includes(closed))
      assert.ok((await visibleOffers(author)).includes(closed))
    })

    it('hides every offer from signed-out visitors', async () => {
      const author = await member('Awa')
      await publish(author)
      await db.exec('set role anon')
      try {
        await assert.rejects(() => db.query('select id from public.opportunities'), /permission denied/)
      } finally {
        await db.exec('reset role')
      }
    })

    it('prevents publishing in someone else\'s name or with a non-published status', async () => {
      const me = await member('Awa')
      const other = await member('Issa')
      await assert.rejects(() => as(me, () => publish(other)), /row-level security/)
      await assert.rejects(() => as(me, () => publish(me, { status: 'closed' })), /row-level security/)
      await as(me, () => publish(me))
    })

    it('prevents editing or deleting another member\'s offer', async () => {
      const author = await member('Awa')
      const other = await member('Issa')
      const id = await publish(author)
      const updated = await as(other, () => db.query("update public.opportunities set title = 'Détourné ici' where id = $1 returning id", [id]))
      assert.equal(updated.rows.length, 0)
      const deleted = await as(other, () => db.query('delete from public.opportunities where id = $1 returning id', [id]))
      assert.equal(deleted.rows.length, 0)
      const mine = await as(author, () => db.query("update public.opportunities set title = 'Titre mis à jour' where id = $1 returning title", [id]))
      assert.equal(mine.rows[0]?.title, 'Titre mis à jour')
    })

    it('lets the author close and reopen, but not set hidden', async () => {
      const author = await member('Awa')
      const id = await publish(author)
      await as(author, () => db.query("update public.opportunities set status = 'closed' where id = $1", [id]))
      await as(author, () => db.query("update public.opportunities set status = 'published' where id = $1", [id]))
      await assert.rejects(
        () => as(author, () => db.query("update public.opportunities set status = 'hidden' where id = $1", [id])),
        /row-level security/,
      )
    })
  })

  describe('rate limit', () => {
    it('refuses a 6th offer within 24 hours', async () => {
      const author = await member('Awa')
      for (let i = 0; i < 5; i++) await publish(author)
      await assert.rejects(() => publish(author), /5 offres par 24 heures/)
      const other = await member('Issa')
      await publish(other)
    })
  })

  describe('reports', () => {
    it('lets a member report once, never their own offer', async () => {
      const author = await member('Awa')
      const reader = await member('Issa')
      const id = await publish(author)
      const report = (who: string) => as(who, () => db.query(
        "insert into public.opportunity_reports (opportunity_id, reporter_id, reason) values ($1, $2, 'Offre suspecte, demande de paiement')", [id, who]))
      await assert.rejects(() => report(author), /row-level security/)
      await report(reader)
      await assert.rejects(() => report(reader), /duplicate key/)
    })

    it('hides an offer after 3 distinct reports and freezes it for the author', async () => {
      const author = await member('Awa')
      const id = await publish(author)
      const reporters = [await member('R1'), await member('R2'), await member('R3')]
      for (const [index, who] of reporters.entries()) {
        await as(who, () => db.query(
          "insert into public.opportunity_reports (opportunity_id, reporter_id, reason) values ($1, $2, 'Arnaque probable, lien douteux')", [id, who]))
        const status = (await db.query<{ status: string }>('select status from public.opportunities where id = $1', [id])).rows[0]?.status
        assert.equal(status, index < 2 ? 'published' : 'hidden')
      }
      const reader = await member('Issa')
      assert.ok(!(await visibleOffers(reader)).includes(id))
      assert.ok((await visibleOffers(author)).includes(id))
      const edit = await as(author, () => db.query("update public.opportunities set status = 'published' where id = $1 returning id", [id]))
      assert.equal(edit.rows.length, 0)
    })
  })

  describe('media', () => {
    it('allows 5 images and 1 document, refuses more', async () => {
      const author = await member('Awa')
      const id = await publish(author)
      for (let i = 0; i < 5; i++) await as(author, () => addMedia(id, `${author}/${id}/img-${i}.png`))
      await assert.rejects(() => as(author, () => addMedia(id, `${author}/${id}/img-6.png`)), /Maximum 5 images/)
      await as(author, () => addMedia(id, `${author}/${id}/dossier.pdf`, 'document'))
      await assert.rejects(() => as(author, () => addMedia(id, `${author}/${id}/autre.pdf`, 'document')), /Un seul document PDF/)
    })

    it('refuses a storage path outside the author folder', async () => {
      const author = await member('Awa')
      const other = await member('Issa')
      const id = await publish(author)
      await assert.rejects(() => as(author, () => addMedia(id, `${other}/${id}/x.png`)), /Chemin de fichier invalide/)
    })

    it('refuses media from a non-author, but lets members read media of visible offers', async () => {
      const author = await member('Awa')
      const other = await member('Issa')
      const id = await publish(author)
      await as(author, () => addMedia(id, `${author}/${id}/cover.png`))
      await assert.rejects(() => as(other, () => addMedia(id, `${author}/${id}/intrus.png`)), /row-level security/)
      const seen = await as(other, () => db.query('select storage_path from public.opportunity_media where opportunity_id = $1', [id]))
      assert.equal(seen.rows.length, 1)
    })

    it('removes media rows when the offer is deleted', async () => {
      const author = await member('Awa')
      const id = await publish(author)
      await as(author, () => addMedia(id, `${author}/${id}/cover.png`))
      await as(author, () => db.query('delete from public.opportunities where id = $1', [id]))
      const { rows } = await db.query('select 1 from public.opportunity_media where opportunity_id = $1', [id])
      assert.equal(rows.length, 0)
    })
  })
})
