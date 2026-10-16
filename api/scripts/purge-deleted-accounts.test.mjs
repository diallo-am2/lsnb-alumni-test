import assert from "node:assert/strict";
import test from "node:test";
import { purgeDueAccounts } from "./purge-deleted-accounts.mjs";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fakeFetch(files = [`${ID}/avatar.png`]) {
  const stored = new Set(files);
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push(`${init.method ?? "GET"} ${path}`);
    if (path.includes("list_accounts_due_for_purge")) return new Response(JSON.stringify([{ id: ID, deletion_requested_at: "2026-01-01T00:00:00Z" }]));
    if (path.includes("/storage/v1/object/list/avatars")) {
      const prefix = `${body.prefix}/`;
      return new Response(JSON.stringify([...stored].filter((file) => file.startsWith(prefix)).map((file) => ({ name: file.slice(prefix.length), id: file }))));
    }
    if (path.endsWith("/storage/v1/object/avatars") && init.method === "DELETE") {
      for (const file of body.prefixes) stored.delete(file);
      return new Response("[]");
    }
    if (path.includes("/auth/v1/admin/users/") && init.method === "DELETE") return new Response("{}", { status: 200 });
    return new Response("{}", { status: 404 });
  };
  return { fetchImpl, stored, calls };
}

test("removes Storage files before deleting the Auth user", async () => {
  const env = fakeFetch();
  const result = await purgeDueAccounts({ url: "https://supabase.test", secretKey: "sb_secret_test", fetchImpl: env.fetchImpl, log: () => undefined });
  assert.deepEqual({ due: result.due, purged: result.purged, failed: result.failed.length }, { due: 1, purged: 1, failed: 0 });
  assert.equal(env.stored.size, 0);
  assert.ok(env.calls.findIndex((call) => call.includes("DELETE /storage")) < env.calls.findIndex((call) => call.includes("DELETE /auth")));
});

test("dry run does not delete anything", async () => {
  const env = fakeFetch();
  const result = await purgeDueAccounts({ url: "https://supabase.test", secretKey: "sb_secret_test", fetchImpl: env.fetchImpl, log: () => undefined, dryRun: true });
  assert.equal(result.purged, 0);
  assert.equal(env.stored.size, 1);
});
