import pg from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { pgConfig } from "./pg-config.mjs";
const phase = process.argv[2];
assert.ok(["prepare", "catalog"].includes(phase));
const target = new URL(process.env.DATABASE_URL);
assert.equal(
  target.hostname,
  "ep-wandering-night-b339mvov-pooler.c-4.ap-southeast-1.aws.neon.tech",
);
assert.equal(target.pathname, "/cinevjet");
if (phase === "catalog") {
  const ready = JSON.parse(await readFile(".vercel/vip-bank-production-ready.json", "utf8"));
  assert.equal(ready.snapshotRuntimeVerified, true);
  assert.equal(ready.projectId, "prj_pS99SOdXtn13R4CD2XyIvmBgimCA");
}
const name = phase === "prepare" ? "0016_vip_bank_contracts.sql" : "0017_vip_official_coins.sql";
const source = await readFile("database/migrations/" + name, "utf8");
const checksum = createHash("sha256").update(source).digest("hex");
const client = new pg.Client(pgConfig());
const protectedTables = [
  "wallets",
  "coin_wallets",
  "wallet_ledger",
  "coin_ledger",
  "daily_checkins",
  "daily_watch_progress",
  "daily_mission_claims",
  "vip_subscriptions",
  "vip_purchase_requests",
  "payos_orders",
  "payment_events",
  "withdrawals",
  "deposits",
  "withdrawal_jobs",
  "referral_commissions",
  "reward_codes",
  "reward_code_redemptions",
];
async function fingerprints() {
  const out = {};
  for (const table of protectedTables) {
    const value = "to_jsonb(t)-'plan_snapshot'-'payment_reference'-'bank_evidence_reference'";
    out[table] = (
      await client.query(
        `SELECT count(*)::int count,md5(COALESCE(jsonb_agg(${value} ORDER BY (${value})::text)::text,'[]')) fingerprint FROM cinevjet.${table} t`,
      )
    ).rows[0];
  }
  return out;
}
try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SELECT pg_advisory_xact_lock(839429170)");
  const old = (
    await client.query("SELECT checksum FROM public.cinevjet_migrations WHERE name=$1", [name])
  ).rows[0];
  if (old) {
    assert.equal(old.checksum, checksum);
    await client.query("ROLLBACK");
    console.log(name + " already applied");
  } else {
    const before = await fingerprints();
    await client.query(source);
    const after = await fingerprints();
    assert.deepEqual(after, before, "Protected financial rows changed; rollback required");
    const missing = (
      await client.query(
        "SELECT (SELECT count(*)::int FROM cinevjet.vip_subscriptions WHERE plan_snapshot IS NULL)+(SELECT count(*)::int FROM cinevjet.vip_purchase_requests WHERE plan_snapshot IS NULL) AS n",
      )
    ).rows[0].n;
    assert.equal(missing, 0);
    await client.query("INSERT INTO public.cinevjet_migrations(name,checksum) VALUES($1,$2)", [
      name,
      checksum,
    ]);
    await client.query("COMMIT");
    await writeFile(
      ".vercel/vip-bank-migration-" + phase + ".json",
      JSON.stringify({
        phase,
        name,
        financialRecordsUnchanged: true,
        missingContracts: missing,
        before,
        after,
      }),
    );
    console.log(name + " PASS; protected financial rows unchanged; all contracts captured.");
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("VIP migration failed and was rolled back.", {
    code: error.code || error.cause?.code || "CHECK_FAILED",
  });
  process.exitCode = 1;
} finally {
  await client.end();
}
