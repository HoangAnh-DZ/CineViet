import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgConfig } from "../scripts/pg-config.mjs";
import { createRewardCode, redeemRewardCode } from "../src/server/reward-codes";
import { createRedemption, redemptionSnapshot, redemptionHistory } from "../src/server/redemption";
import { rewardsSnapshot } from "../src/server/rewards";
import { balances } from "../src/server/account";
import { withdrawalTransactions } from "../src/server/dashboard";
import { adminMoneyDetail, completeWithdrawal } from "../src/server/manual-money";
import { runPayoutWorker } from "../src/server/withdrawal-queue";
import { autoPayoutEnabled } from "../src/server/payos-payout";

// A blank, temporary database on a nonproduction Neon branch. Never use the input URL as-is.
process.loadEnvFile(".env.local");
const host = "ep-dawn-boat-b3eq3mnu-pooler.c-4.ap-southeast-1.aws.neon.tech";
const url = new URL(process.env.DATABASE_URL!);
assert.notEqual(url.hostname, host);
url.hostname = host;
url.pathname = "/financial_sync_qa_20261015";
process.env.DATABASE_URL = url.toString();
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
for (const key of Object.keys(process.env)) if (key.startsWith("PAYOS_")) delete process.env[key];
const migrated = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
  env: process.env,
  encoding: "utf8",
});
assert.equal(migrated.status, 0, migrated.stderr);
const pool = new Pool({ ...pgConfig(), max: 10 });
(
  globalThis as typeof globalThis & { cinevjetDatabase: ReturnType<typeof drizzle> }
).cinevjetDatabase = drizzle(pool);
await pool.query(await readFile("database/seed.sql", "utf8"));
await pool.query(
  "UPDATE cinevjet.vip_plans SET reward_tier='FREE',checkin_rewards=ARRAY[200,300,500,700,1000,1300,2000],reward_enabled=true WHERE id='FREE'",
);
async function user() {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,'test-only','Financial sync QA')",
    [id, `${id}@example.invalid`],
  );
  await pool.query("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
  await pool.query("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
  return id;
}
const admin = await user(),
  member = await user(),
  outsider = await user();
await pool.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [admin]);
const request = (key = randomUUID()) => ({
  coins: 35000,
  bank_name: "QA Bank",
  account_number: "123456789",
  account_name: "ISOLATED QA",
  idempotency_key: key,
});
async function credit(id: string) {
  const code = await createRewardCode(admin, { reward_coins: 100000, max_redemptions: 2 });
  await redeemRewardCode(id, { code: code.code });
  return code;
}
async function consistent(id: string, total: number, held: number) {
  const [reward, redeem, account] = await Promise.all([
    rewardsSnapshot(id),
    redemptionSnapshot(id),
    balances(id),
  ]);
  assert.deepEqual(
    [reward.wallet.balance, reward.wallet.reserved, reward.wallet.available],
    [total, held, total - held],
  );
  assert.deepEqual(
    [redeem.balance, redeem.reserved, redeem.available],
    [total, held, total - held],
  );
  assert.equal(account.coins, total - held);
  const sums = (
    await pool.query(
      "SELECT (SELECT COALESCE(sum(amount),0) FROM cinevjet.coin_ledger WHERE user_id=$1) ledger,(SELECT COALESCE(sum(coins_amount),0) FROM cinevjet.withdrawals WHERE user_id=$1 AND source_asset='COIN' AND status IN ('PENDING','PROCESSING')) held",
      [id],
    )
  ).rows[0];
  assert.equal(Number(sums.ledger), total);
  assert.equal(Number(sums.held), held);
}
test("real PostgreSQL: code → two holds → admin → reload → reject → evidence completion", async (t) => {
  let first: Awaited<ReturnType<typeof createRedemption>>, second: typeof first;
  await t.test("code credits ledger once and both APIs agree", async () => {
    const code = await credit(member);
    await assert.rejects(() => redeemRewardCode(member, { code: code.code }));
    await consistent(member, 100000, 0);
  });
  await t.test("first request persists ID, holds 35k and quotes 4% once", async () => {
    first = await createRedemption(member, request());
    assert.equal(first.status, "PENDING");
    assert.equal(first.coins_amount, 35000);
    assert.equal(first.coin_value_vnd, 1);
    assert.equal(first.amount, 35000);
    assert.equal(first.fee, 1400);
    assert.equal(first.amount - first.fee, 33600);
    await consistent(member, 100000, 35000);
    assert.equal((await withdrawalTransactions(admin, { q: member })).total, 1); // Email includes the user ID.
    assert.equal(
      (await withdrawalTransactions(admin)).items.some((r) => r.id === first.id),
      true,
    );
  });
  await t.test(
    "second request and fresh snapshots preserve 30k available, admin sees both",
    async () => {
      second = await createRedemption(member, request());
      assert.notEqual(first.id, second.id);
      await consistent(member, 100000, 70000);
      const page = await withdrawalTransactions(admin, { status: "PENDING" });
      assert.equal(page.items.filter((r) => [first.id, second.id].includes(r.id)).length, 2);
      const history = await redemptionHistory(member);
      assert.equal(history.length, 2);
      assert.ok(history.every((r) => r.bank_account_number?.startsWith("••••")));
      assert.equal(
        (await adminMoneyDetail(admin, "WITHDRAWAL", first.id)).bank_account_number,
        "123456789",
      );
      await assert.rejects(() => withdrawalTransactions(outsider));
      await assert.rejects(() => adminMoneyDetail(outsider, "WITHDRAWAL", first.id));
      assert.equal((await redemptionHistory(outsider)).length, 0);
    },
  );
  await t.test("rejection releases only once", async () => {
    await assert.rejects(() =>
      completeWithdrawal(admin, first.id, { action: "COMPLETE", confirmed: true }),
    );
    await completeWithdrawal(admin, first.id, { action: "REJECT", reason: "Isolated QA" });
    await assert.rejects(() =>
      completeWithdrawal(admin, first.id, { action: "REJECT", reason: "Retry" }),
    );
    await consistent(member, 100000, 35000);
  });
  await t.test(
    "acceptance, evidence enforcement and completion debit once without payout",
    async () => {
      await completeWithdrawal(admin, second.id, { action: "PROCESS" });
      await completeWithdrawal(admin, second.id, { action: "PROCESS" });
      assert.equal(
        (await redemptionHistory(member)).find((r) => r.id === second.id)?.status,
        "PROCESSING",
      );
      await assert.rejects(() =>
        completeWithdrawal(admin, second.id, { action: "COMPLETE", confirmed: true }),
      );
      await consistent(member, 100000, 35000);
      const proof = randomUUID();
      await pool.query(
        "INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height) VALUES($1,$2,$3,'image/webp',100,10,10)",
        [proof, admin, `https://example.invalid/isolated-proof/${proof}.webp`],
      );
      await completeWithdrawal(admin, second.id, {
        action: "COMPLETE",
        confirmed: true,
        evidence_reference: `QA-NO-TRANSFER-${second.id}`,
        proof_bill_id: proof,
      });
      await assert.rejects(() =>
        completeWithdrawal(admin, second.id, {
          action: "COMPLETE",
          confirmed: true,
          evidence_reference: `QA-NO-TRANSFER-${second.id}`,
          proof_bill_id: proof,
        }),
      );
      await consistent(member, 65000, 0);
      const ledger = await pool.query(
        "SELECT amount FROM cinevjet.coin_ledger WHERE reference_id=$1 AND reference_type='REDEMPTION'",
        [second.id],
      );
      assert.equal(ledger.rows.length, 1);
      assert.equal(Number(ledger.rows[0].amount), -35000);
      assert.equal(
        (
          await pool.query("SELECT count(*) n FROM cinevjet.wallet_ledger WHERE user_id=$1", [
            member,
          ])
        ).rows[0].n,
        "0",
      );
      assert.equal(autoPayoutEnabled(), false);
      assert.equal((await runPayoutWorker()).dispatched, false);
      assert.equal(
        (await withdrawalTransactions(admin, { status: "COMPLETED", q: second.id })).total,
        1,
      );
    },
  );
  await t.test(
    "insufficient funds, duplicate keys, changed payload and concurrent competing keys",
    async () => {
      const id = await user();
      await credit(id);
      const body = request();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => createRedemption(id, body)),
      );
      assert.equal(new Set(results.map((r) => r.id)).size, 1);
      await consistent(id, 100000, 35000);
      await assert.rejects(() => createRedemption(id, { ...body, account_number: "999999999" }));
      const races = await Promise.allSettled(
        Array.from({ length: 4 }, () => createRedemption(id, request())),
      );
      assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
      await consistent(id, 100000, 70000);
      await assert.rejects(() => createRedemption(id, request()));
      await consistent(id, 100000, 70000);
      const pending = (await redemptionHistory(id))[0];
      const terminal = await Promise.allSettled([
        completeWithdrawal(admin, pending.id, { action: "REJECT", reason: "QA" }),
        completeWithdrawal(admin, pending.id, { action: "FAIL", reason: "QA" }),
      ]);
      assert.equal(terminal.filter((r) => r.status === "fulfilled").length, 1);
      await consistent(id, 100000, 35000);
    },
  );
  await t.test("database insert failure rolls back reservation", async () => {
    const id = await user();
    await credit(id);
    await pool.query(
      "CREATE OR REPLACE FUNCTION cinevjet.qa_fail_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.bank_name='ROLLBACK QA' THEN RAISE EXCEPTION 'QA rollback'; END IF; RETURN NEW; END $$; DROP TRIGGER IF EXISTS qa_fail_withdrawal ON cinevjet.withdrawals; CREATE TRIGGER qa_fail_withdrawal BEFORE INSERT ON cinevjet.withdrawals FOR EACH ROW EXECUTE FUNCTION cinevjet.qa_fail_withdrawal()",
    );
    await assert.rejects(() => createRedemption(id, { ...request(), bank_name: "ROLLBACK QA" }));
    await consistent(id, 100000, 0);
    assert.equal((await redemptionHistory(id)).length, 0);
  });
  await t.test(
    "withdrawal filtering precedes pagination and includes older pending coin requests",
    async () => {
      const id = await user();
      await credit(id);
      const old = await createRedemption(id, request());
      await pool.query(
        "UPDATE cinevjet.withdrawals SET created_at=now()-interval '1 day' WHERE id=$1",
        [old.id],
      );
      for (let i = 0; i < 105; i++)
        await pool.query(
          "INSERT INTO cinevjet.deposits(id,user_id,amount,idempotency_key,provider) VALUES($1,$2,50000,$3,'QA')",
          [randomUUID(), id, randomUUID()],
        );
      assert.equal(
        (await withdrawalTransactions(admin, { status: "PENDING" })).items.some(
          (r) => r.id === old.id,
        ),
        true,
      );
      for (let i = 0; i < 33; i++)
        await pool.query(
          "INSERT INTO cinevjet.withdrawals(id,user_id,amount,fee,destination,idempotency_key,status,source_asset,coins_amount,coin_value_vnd) VALUES($1,$2,35000,1400,'QA',$3,'REJECTED','COIN',35000,1)",
          [randomUUID(), id, randomUUID()],
        );
      const p1 = await withdrawalTransactions(admin, {
          status: "REJECTED",
          q: `${id}@example.invalid`,
        }),
        p2 = await withdrawalTransactions(admin, {
          status: "REJECTED",
          q: `${id}@example.invalid`,
          page: 2,
        });
      assert.equal(p1.items.length, 30);
      assert.ok(p2.items.length > 0);
      assert.ok(p1.items.every((r) => !p2.items.some((s) => r.id === s.id)));
      assert.equal((await withdrawalTransactions(admin, { from: "2026-99-99" })).filters.from, "");
      await consistent(id, 100000, 35000);
    },
  );
});
test.after(async () => {
  await pool.end();
});
