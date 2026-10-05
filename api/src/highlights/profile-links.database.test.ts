import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

let db: PGlite

async function migration(name: string) {
  await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
}

// public.handle_new_member() creates the profile row when an auth user is inserted.
async function seedProfile(): Promise<string> {
  const result = await db.query<{ id: string }>('select gen_random_uuid()::text as id')
  const id = result.rows[0]!.id
  await db.query(
    'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
    [id, `${id}@example.test`, JSON.stringify({ first_name: 'Awa', last_name: 'Sanou', member_role: 'alumni' })],
  )
  return id
}

const setLinks = (id: string, linkedin: string | null, portfolio: string | null) => db.query(
  'update public.profiles set linkedin_url = $2, portfolio_url = $3 where id = $1', [id, linkedin, portfolio],
)

describe('profile links migration (linkedin_url, portfolio_url)', { concurrency: false }, () => {
  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create schema auth;
      create schema storage;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1, ''/'')';
    `)
    await migration('202609040001_initial_schema.sql')
  })
  after(async () => { await db.close() })

  it('keeps existing profiles valid: both columns are nullable and default to null', async () => {
    const id = await seedProfile()
    await migration('202610050001_profile_links.sql')
    const { rows } = await db.query<{ linkedin_url: string | null; portfolio_url: string | null }>(
      'select linkedin_url, portfolio_url from public.profiles where id = $1', [id],
    )
    assert.deepEqual(rows[0], { linkedin_url: null, portfolio_url: null })
  })

  it('can be applied twice without error', async () => {
    await migration('202610050001_profile_links.sql')
  })

  it('accepts null and https:// links', async () => {
    const id = await seedProfile()
    await setLinks(id, null, null)
    await setLinks(id, 'https://www.linkedin.com/in/awa-sanou', null)
    await setLinks(id, null, 'https://awa.example.org/portfolio?lang=fr')
    await setLinks(id, 'https://www.linkedin.com/in/awa-sanou', 'https://awa.example.org')
  })

  it('lets a member edit their own links but not another member\'s (RLS)', async () => {
    const me = await seedProfile()
    const other = await seedProfile()
    await db.exec("grant select, update on public.profiles to authenticated")
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [me])
    await db.exec('set role authenticated')
    try {
      await db.query("update public.profiles set linkedin_url = 'https://www.linkedin.com/in/me' where id = $1", [me])
      const foreign = await db.query("update public.profiles set linkedin_url = 'https://www.linkedin.com/in/x' where id = $1 returning id", [other])
      assert.equal(foreign.rows.length, 0)
    } finally {
      await db.exec('reset role')
      await db.query("select set_config('request.jwt.claim.sub', '', false)")
    }
    const { rows } = await db.query<{ id: string; linkedin_url: string | null }>(
      'select id, linkedin_url from public.profiles where id in ($1, $2)', [me, other],
    )
    assert.equal(rows.find((r) => r.id === me)?.linkedin_url, 'https://www.linkedin.com/in/me')
    assert.equal(rows.find((r) => r.id === other)?.linkedin_url, null)
  })

  for (const [label, value] of [
    ['http://', 'http://example.org'],
    ['javascript:', 'javascript:alert(1)'],
    ['a scheme-less value', 'www.linkedin.com/in/awa'],
    ['whitespace', 'https://example.org/a b'],
    ['an empty https:// prefix', 'https://'],
    ['more than 500 characters', `https://example.org/${'a'.repeat(500)}`],
  ] as const) {
    it(`rejects ${label} in both columns`, async () => {
      const id = await seedProfile()
      await assert.rejects(() => setLinks(id, value, null), /profiles_linkedin_url_https/)
      await assert.rejects(() => setLinks(id, null, value), /profiles_portfolio_url_https/)
    })
  }
})
