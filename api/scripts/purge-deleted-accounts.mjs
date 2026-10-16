import { pathToFileURL } from "node:url";

export const BUCKETS = ["avatars", "opportunity-media"];
const PAGE = 100;

function authHeaders(secretKey) {
  const headers = { apikey: secretKey };
  if (secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${secretKey}`;
  return headers;
}

export async function purgeDueAccounts({ url, secretKey, fetchImpl = fetch, log = console.log, dryRun = false, buckets = BUCKETS, limit = 100 }) {
  const base = url.trim().replace(/\/+$/, "");
  const headers = authHeaders(secretKey);

  async function call(path, { method = "GET", body, ok = [200] } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!ok.includes(response.status)) throw new Error(`${method} ${path.split("?")[0]} answered ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function listFiles(bucket, prefix) {
    const files = [];
    for (let offset = 0; ; offset += PAGE) {
      const items = await call(`/storage/v1/object/list/${bucket}`, { method: "POST", body: { prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } } });
      for (const item of items) {
        const path = `${prefix}/${item.name}`;
        if (item.id === null || item.id === undefined) files.push(...(await listFiles(bucket, path)));
        else files.push(path);
      }
      if (items.length < PAGE) return files;
    }
  }

  async function removeFiles(accountId) {
    for (const bucket of buckets) {
      const files = await listFiles(bucket, accountId);
      for (let index = 0; index < files.length; index += PAGE) {
        await call(`/storage/v1/object/${bucket}`, { method: "DELETE", body: { prefixes: files.slice(index, index + PAGE) } });
      }
      if (files.length > 0 && (await listFiles(bucket, accountId)).length > 0) throw new Error(`files of ${bucket}/${accountId} are still there after removal`);
    }
  }

  const due = await call("/rest/v1/rpc/list_accounts_due_for_purge", { method: "POST", body: { p_limit: limit } });
  const result = { due: due.length, purged: 0, failed: [] };
  if (dryRun) {
    for (const account of due) log(`Would purge account ${account.id} (requested ${account.deletion_requested_at}).`);
    return result;
  }

  for (const account of due) {
    try {
      await removeFiles(account.id);
      await call(`/auth/v1/admin/users/${account.id}`, { method: "DELETE", ok: [200, 204, 404] });
      result.purged += 1;
      log(`Purged account ${account.id}.`);
    } catch (error) {
      result.failed.push({ id: account.id, reason: error instanceof Error ? error.message : String(error) });
      log(`FAILED account ${account.id}: ${result.failed.at(-1).reason}`);
    }
  }
  log(`${result.purged} account(s) purged, ${result.failed.length} failed, ${result.due} due.`);
  return result;
}

async function main() {
  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  const result = await purgeDueAccounts({ url, secretKey, dryRun: process.argv.includes("--dry-run") });
  if (result.failed.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
