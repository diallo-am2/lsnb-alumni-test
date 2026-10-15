const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

if (!url || !secretKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");

const response = await fetch(`${url}/rest/v1/rpc/purge_deleted_accounts`, {
  method: "POST",
  headers: {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  },
  body: "{}",
});

if (!response.ok) throw new Error(`Account purge failed (${response.status}): ${await response.text()}`);
console.log(`Purged ${await response.json()} deleted account(s).`);
