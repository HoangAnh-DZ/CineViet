import { randomBytes } from "node:crypto";
// Isolated QA only; never accepts a Production host or database.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import assert from "node:assert/strict";
import { Pool } from "pg";
const env = parseEnv(await readFile(".vercel/security_audit_20261018.env", "utf8"));
const url = new URL(env.SECURITY_TEST_DATABASE_URL);
assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
assert.equal(url.pathname, "/security_audit_20261018");
const admin = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 1,
});
assert.ok(
  process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "finance"),
);
const finance = process.argv[2] === "finance";
const db = finance
  ? "financial_reporting_20261018_" + randomBytes(4).toString("hex")
  : "referral_reporting_20261018";
if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [db])).rows.length)
  await admin.query(`CREATE DATABASE ${db}`);
await admin.end();
url.pathname = "/" + db;
const owner = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 1,
});
if (
  !(await owner.query("SELECT 1 FROM information_schema.schemata WHERE schema_name='cinevjet'"))
    .rows.length
) {
  for (const name of (await readdir("database/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await owner.query(await readFile("database/migrations/" + name, "utf8"));
  await owner.query(await readFile("database/seed.sql", "utf8"));
}
await owner.query(
  "INSERT INTO cinevjet.referral_policy_versions(id,level1_bps,level2_bps,level3_bps,reason) VALUES('legacy-10-percent',1000,0,0,'Immutable pre-migration orders only; preserves historical first-purchase policy') ON CONFLICT(id) DO NOTHING",
);
// Refresh the not-yet-released trigger definition only on this isolated QA database.
const migration = await readFile(
  "database/migrations/0021_unrestricted_referral_rates.sql",
  "utf8",
);
const triggerStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION cinevjet.capture_referral_snapshot()",
);
const triggerEnd = migration.indexOf("END $$;", triggerStart) + "END $$;".length;
await owner.query(
  migration
    .slice(triggerStart, triggerEnd)
    .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"),
);
const role = finance ? "cinevjet_runtime_finance_20261018" : "cinevjet_runtime_referrals_20261018";
let policy = (await readFile("database/security/runtime-role-candidate.sql", "utf8")).replaceAll(
  "cinevjet_runtime",
  role,
);
if (!(await owner.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rows.length)
  await owner.query(policy);
else
  await owner.query(policy.slice(policy.indexOf("GRANT USAGE ON SCHEMA")).replace("COMMIT;", ""));
await owner.query(
  (await readFile("database/security/referral-reporting-grants-proposed.sql", "utf8")).replaceAll(
    "cinevjet_runtime",
    role,
  ),
);
await owner.query(
  (await readFile("database/security/account-security-grants-proposed.sql", "utf8")).replaceAll(
    "cinevjet_runtime",
    role,
  ),
);
const actor = (await owner.query("SELECT current_user name")).rows[0].name;
await owner.query(`GRANT ${role} TO "${actor.replaceAll('"', '""')}"`);
const runtime = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  options: `-c role=${role}`,
  max: 1,
});
assert.equal((await runtime.query("SELECT current_user name")).rows[0].name, role);
await writeFile(
  finance ? ".vercel/financial_qa.env" : ".vercel/referral_qa.env",
  `REFERRAL_TEST_DATABASE_URL=${url.toString()}\nREFERRAL_QA_ROLE=${role}\n`,
);
await runtime.end();
await owner.end();
console.log("Isolated referral QA schema and restricted role ready; no Production changes.");
