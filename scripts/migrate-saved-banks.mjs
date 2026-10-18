import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { pgConfig } from "../scripts/pg-config.mjs";
process.loadEnvFile(".env.local");
const url = new URL(process.env.DATABASE_URL);
url.hostname = url.hostname.replace("-pooler", "");
process.env.DATABASE_URL = url.toString();
const c = new Client(pgConfig());
const name = "0019_saved_bank_accounts.sql",
  source = await readFile("database/migrations/" + name, "utf8");
assert.ok(
  !/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i.test(source.replace(/--[^\n]*/g, "")),
  "Migration must be additive schema only",
);
const checksum = createHash("sha256").update(source).digest("hex");
const tables = [
  "users",
  "wallets",
  "coin_wallets",
  "wallet_ledger",
  "coin_ledger",
  "withdrawals",
  "deposits",
  "vip_plans",
  "vip_subscriptions",
  "vip_purchase_requests",
  "payos_orders",
  "payment_events",
  "withdrawal_jobs",
  "referral_commissions",
  "reward_codes",
  "reward_code_redemptions",
];
async function fingerprints() {
  const out = {};
  for (const table of tables) {
    const value =
      table === "withdrawals"
        ? "to_jsonb(t)-'bank_account_id'-'bank_snapshot_ciphertext'"
        : "to_jsonb(t)";
    out[table] = (
      await c.query(
        `SELECT count(*)::int n,md5(COALESCE(jsonb_agg(${value} ORDER BY (${value})::text)::text,'[]')) hash FROM cinevjet.${table} t`,
      )
    ).rows[0];
  }
  return out;
}
try {
  await c.connect();
  const target = JSON.parse(await readFile(".vercel/bank-production-target.json", "utf8"));
  assert.equal(url.hostname, target.host);
  assert.equal(url.pathname, target.database);
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await c.query("SET LOCAL lock_timeout='5s'");
  await c.query("SELECT pg_advisory_xact_lock(839429170)");
  const applied = new Map(
    (await c.query("SELECT name,checksum FROM public.cinevjet_migrations")).rows.map((r) => [
      r.name,
      r.checksum,
    ]),
  );
  const pending = [];
  for (const file of (await readdir("database/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const hash = createHash("sha256")
      .update(await readFile("database/migrations/" + file, "utf8"))
      .digest("hex");
    if (applied.has(file))
      assert.equal(applied.get(file), hash, "Changed applied migration: " + file);
    else pending.push(file);
  }
  if (applied.has(name)) {
    assert.equal(applied.get(name), checksum);
    await c.query("ROLLBACK");
    console.log("Saved-bank migration already applied; no changes made.");
  } else {
    assert.deepEqual(pending, [name]);
    const before = await fingerprints();
    if (!process.argv.includes("--apply")) {
      await c.query("ROLLBACK");
      console.log("Migration preflight PASS: only additive saved-bank migration is pending.");
    } else {
      await c.query(source);
      const after = await fingerprints();
      assert.deepEqual(after, before, "Protected records must remain unchanged");
      await c.query("INSERT INTO public.cinevjet_migrations(name,checksum)VALUES($1,$2)", [
        name,
        checksum,
      ]);
      await c.query("COMMIT");
      await writeFile(
        ".vercel/saved-bank-migration.json",
        JSON.stringify({ name, checksum, protectedRecordsUnchanged: true }),
      );
      console.log(
        "Additive saved-bank migration PASS; existing users, balances, ledgers, withdrawals, VIP and payOS records unchanged.",
      );
    }
  }
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error(
    "Saved-bank migration stopped safely:",
    e instanceof assert.AssertionError ? e.message : e.code || "database_error",
  );
  process.exitCode = 1;
} finally {
  await c.end();
}
