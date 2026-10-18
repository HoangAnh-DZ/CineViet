import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
import { pgConfig } from "./pg-config.mjs";
const base = new URL(process.env.DATABASE_URL || "");
const qaHost = process.env.PAYOS_QA_HOST;
if (qaHost) {
  if (
    !qaHost.endsWith(".neon.tech") ||
    qaHost === base.hostname ||
    qaHost === base.hostname.replace("-pooler", "")
  )
    throw new Error("A separate QA compute is required.");
  base.hostname = qaHost.replace("-pooler", "");
} else if (
  process.env.PAYOS_PRODUCTION_MIGRATION !== "confirmed" ||
  base.hostname !== "ep-wandering-night-b339mvov-pooler.c-4.ap-southeast-1.aws.neon.tech"
)
  throw new Error("Explicit verified production migration target is required.");
else base.hostname = base.hostname.replace("-pooler", "");
process.env.DATABASE_URL = base.toString();
const client = new pg.Client(pgConfig());
const tables = [
  "users",
  "wallets",
  "coin_wallets",
  "wallet_ledger",
  "coin_ledger",
  "deposits",
  "withdrawals",
  "vip_purchase_requests",
  "vip_subscriptions",
  "vip_plans",
  "daily_checkins",
  "referral_commissions",
  "money_audit",
];
const names = new Map();
async function fingerprints() {
  const out = {};
  for (const table of tables) {
    if (!names.has(table)) {
      const c = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='cinevjet' AND table_name=$1 ORDER BY ordinal_position",
        [table],
      );
      names.set(
        table,
        c.rows.map((x) => '"' + x.column_name.replaceAll('"', '""') + '"').join(","),
      );
    }
    out[table] = (
      await client.query(
        `SELECT count(*)::int n,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) hash FROM (SELECT ${names.get(table)} FROM cinevjet.${table}) t`,
      )
    ).rows[0];
  }
  return JSON.stringify(out);
}
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SELECT pg_advisory_xact_lock(839429170)");
  const source = await readFile("database/migrations/0012_payos_queue.sql", "utf8"),
    checksum = createHash("sha256").update(source).digest("hex");
  const applied = await client.query(
    "SELECT checksum FROM public.cinevjet_migrations WHERE name='0012_payos_queue.sql'",
  );
  if (applied.rows.length) {
    if (applied.rows[0].checksum !== checksum)
      throw new Error("Applied migration checksum mismatch.");
    console.log("payOS migration already applied.");
  } else {
    // Keep financial fingerprint checks deterministic without changing any existing row.
    await client.query(
      "LOCK TABLE " + tables.map((t) => "cinevjet." + t).join(",") + " IN SHARE MODE",
    );
    const before = await fingerprints();
    await client.query(source);
    if ((await fingerprints()) !== before) throw new Error("Existing financial data changed.");
    await client.query("INSERT INTO public.cinevjet_migrations(name,checksum) VALUES($1,$2)", [
      "0012_payos_queue.sql",
      checksum,
    ]);
    console.log("PASS: additive payOS migration; 13 existing tables unchanged.");
  }
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Migration failed and rolled back.", e.code || e.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
