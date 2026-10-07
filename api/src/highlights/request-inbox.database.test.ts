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

const OFFER_A = '11111111-1111-4111-8111-111111111111'
const OFFER_B = '22222222-2222-4222-8222-222222222222'

async function send(requester: string, recipient: string, extra: { offer?: string; message?: string } = {}) {
  const { rows } = await as(requester, () => db.query<{ id: string }>(
    `insert into public.connection_requests (requester_id, recipient_id, request_kind, message, opportunity_id, opportunity_title)
     values ($1, $2, 'contact', $3, $4, $5) returning id`,
    [requester, recipient, extra.message ?? 'Bonjour, pouvez-vous me parler de cette offre ?',
      extra.offer ?? null, extra.offer ? 'Bourse d’excellence' : null],
  ))
  return rows[0]!.id
}

const answer = (recipient: string, id: string, status: string, email: string | null, phone: string | null) =>
  as(recipient, () => db.query(
    'update public.connection_requests set status = $2, shared_email = $3, shared_phone = $4 where id = $1 returning id',
    [id, status, email, phone],
  ))

describe('request inbox migration', { concurrency: false }, () => {
  let legacyId: string

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create schema auth;
      grant usage on schema auth to anon, authenticated, service_role;
      create schema storage;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1, ''/'')';
    `)
    await migration('202609040001_initial_schema.sql')

    // A request created before the inbox existed must stay valid.
    const [a, b] = [await member('Awa'), await member('Issa')]
    const { rows } = await db.query<{ id: string }>(
      `insert into public.connection_requests (requester_id, recipient_id, request_kind, message)
       values ($1, $2, 'contact', 'Un ancien message de plus de vingt caractères.') returning id`, [a, b])
    legacyId = rows[0]!.id

    await migration('202610060001_request_inbox.sql')
    await db.exec('grant select, insert, update, delete on public.connection_requests to authenticated')
    await db.exec('grant select on public.profiles, public.profile_contacts to authenticated')
  })
  after(async () => { await db.close() })

  it('keeps existing requests valid and can be applied twice', async () => {
    await migration('202610060001_request_inbox.sql')
    const { rows } = await db.query<Record<string, unknown>>(
      'select opportunity_id, shared_email, shared_phone, requester_seen_at from public.connection_requests where id = $1',
      [legacyId],
    )
    assert.deepEqual(rows[0], { opportunity_id: null, shared_email: null, shared_phone: null, requester_seen_at: null })
  })

  it('lets the recipient accept while sharing a WhatsApp number, visible to both and to nobody else', async () => {
    const [awa, issa, stranger] = [await member('A'), await member('B'), await member('C')]
    const id = await send(awa, issa)
    const { rows } = await answer(issa, id, 'accepted', null, '+22670123456')
    assert.equal(rows.length, 1)

    const asRequester = await as(awa, () => db.query<{ shared_phone: string; shared_email: string | null; responded_at: string }>(
      'select shared_phone, shared_email, responded_at from public.connection_requests where id = $1', [id]))
    assert.equal(asRequester.rows[0]?.shared_phone, '+22670123456')
    assert.equal(asRequester.rows[0]?.shared_email, null)
    assert.ok(asRequester.rows[0]?.responded_at)

    const asStranger = await as(stranger, () => db.query('select id from public.connection_requests where id = $1', [id]))
    assert.equal(asStranger.rows.length, 0)
  })

  it('lets the recipient accept while sharing an e-mail address', async () => {
    const [awa, issa] = [await member('A'), await member('B')]
    const id = await send(awa, issa)
    assert.equal((await answer(issa, id, 'accepted', 'issa@example.org', null)).rows.length, 1)
  })

  it('refuses an acceptance that shares nothing', async () => {
    const [awa, issa] = [await member('A'), await member('B')]
    const id = await send(awa, issa)
    await assert.rejects(answer(issa, id, 'accepted', null, null), /at least one contact/)
  })

  it('refuses malformed phone numbers and e-mail addresses', async () => {
    const [awa, issa] = [await member('A'), await member('B')]
    const id = await send(awa, issa)
    for (const phone of ['0612345678', '+33 6 12 34 56 78', '+1234', '+0123456789', 'whatsapp', '+226701234567890123']) {
      await assert.rejects(answer(issa, id, 'accepted', null, phone), /shared_phone_check/, phone)
    }
    for (const email of ['issa', 'issa@', '@example.org', 'is sa@example.org']) {
      await assert.rejects(answer(issa, id, 'accepted', email, null), /shared_email_check/, email)
    }
  })

  it('shares nothing when declining', async () => {
    const [awa, issa] = [await member('A'), await member('B')]
    const id = await send(awa, issa)
    await assert.rejects(answer(issa, id, 'declined', null, '+22670123456'), /shared_only_when_accepted/)
    assert.equal((await answer(issa, id, 'declined', null, null)).rows.length, 1)
  })

  it('freezes an answered request', async () => {
    const [awa, issa] = [await member('A'), await member('B')]
    const id = await send(awa, issa)
    await answer(issa, id, 'accepted', 'issa@example.org', null)
    await assert.rejects(answer(issa, id, 'declined', null, null), /Only pending requests can be answered/)
    await assert.rejects(answer(issa, id, 'accepted', 'autre@example.org', null), /Only pending requests can be answered/)
  })

  it('does not let the requester answer their own request or read what it never received', async () => {
    const [awa, issa] = [await member('A'), await member('B')]
    const id = await send(awa, issa)
    const own = await as(awa, () => db.query(
      "update public.connection_requests set status = 'accepted', shared_phone = '+22670123456' where id = $1 returning id", [id]))
    assert.equal(own.rows.length, 0)
  })

  it('never lets anyone rewrite the message or the offer', async () => {
    const [awa, issa] = [await member('A'), await member('B')]
    const id = await send(awa, issa, { offer: OFFER_A })
    await assert.rejects(as(issa, () => db.query(
      "update public.connection_requests set message = 'Un autre message de plus de vingt caractères' where id = $1", [id])), /Only the request status can be changed/)
    await assert.rejects(as(issa, () => db.query(
      'update public.connection_requests set opportunity_title = $2 where id = $1', [id, 'Autre titre'])), /Only the request status can be changed/)
  })

  it('marks answers as seen for the requester only', async () => {
    const [awa, issa] = [await member('A'), await member('B')]
    const answered = await send(awa, issa, { offer: OFFER_A })
    const pending = await send(awa, issa, { offer: OFFER_B })
    await answer(issa, answered, 'accepted', 'issa@example.org', null)

    // The recipient cannot clear the requester's badge...
    await assert.rejects(as(issa, () => db.query(
      'update public.connection_requests set requester_seen_at = now() where id = $1', [answered])), /Only the requester/)
    // ...nor can a pending request carry a "seen" marker.
    await assert.rejects(as(issa, () => db.query(
      'update public.connection_requests set requester_seen_at = now() where id = $1', [pending])), /no answer to mark/)

    await as(issa, () => db.query('select public.mark_request_answers_seen()'))
    let unseen = await db.query('select id from public.connection_requests where id = $1 and requester_seen_at is null', [answered])
    assert.equal(unseen.rows.length, 1, 'the recipient does not own this answer')

    await as(awa, () => db.query('select public.mark_request_answers_seen()'))
    unseen = await db.query('select id from public.connection_requests where id = $1 and requester_seen_at is null', [answered])
    assert.equal(unseen.rows.length, 0)
    const stillPending = await db.query('select requester_seen_at from public.connection_requests where id = $1', [pending])
    assert.equal(stillPending.rows[0]?.requester_seen_at, null)
  })

  it('allows one pending message per offer, but not two for the same offer', async () => {
    const [awa, issa] = [await member('A'), await member('B')]
    await send(awa, issa, { offer: OFFER_A })
    await send(awa, issa, { offer: OFFER_B })
    await assert.rejects(send(awa, issa, { offer: OFFER_A }), /connection_requests_pending_unique_idx/)

    // Messages that are not about an offer (mentoring, profile contact) keep the old rule.
    await send(awa, issa)
    await assert.rejects(send(awa, issa), /connection_requests_pending_unique_idx/)
  })

  it('keeps notification bookkeeping out of reach of members and idempotent for the API', async () => {
    const [awa, issa] = [await member('A'), await member('B')]
    const id = await send(awa, issa)
    await assert.rejects(as(awa, () => db.query(
      "insert into public.request_notifications (request_id, event) values ($1, 'created')", [id])), /permission denied/)
    await assert.rejects(as(awa, () => db.query('select * from public.request_notifications')), /permission denied/)

    await db.exec('set role service_role')
    try {
      await db.query("insert into public.request_notifications (request_id, event) values ($1, 'created')", [id])
      const duplicate = await db.query(
        "insert into public.request_notifications (request_id, event) values ($1, 'created') on conflict do nothing returning request_id", [id])
      assert.equal(duplicate.rows.length, 0)
    } finally {
      await db.exec('reset role')
    }
  })
})
