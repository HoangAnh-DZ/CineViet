import test from "node:test";
process.env.BANK_ACCOUNT_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { vipPlans } from "../src/server/account";
import { referralDashboard, referralFilters } from "../src/server/referrals";
import { createWithdrawalRequest, completeWithdrawal } from "../src/server/manual-money";
import { createRedemption } from "../src/server/redemption";
import { updateVipPlan } from "../src/server/admin-plans";
import { withdrawalFee, validWithdrawalSelection } from "../src/domain/product-policy";
import { autoPayoutEnabled } from "../src/server/payos-payout";

// All fixtures and financial operations stay in this disposable local database.
const db = new PGlite();
for (const file of (await readdir("database/migrations")).filter((f) => f.endsWith(".sql")).sort())
  await db.exec(await readFile(`database/migrations/${file}`, "utf8"));
await db.exec(await readFile("database/seed.sql", "utf8"));
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = drizzle(
  db,
) as unknown as NodePgDatabase;
delete process.env.PAYOS_API_KEY;
delete process.env.PAYOS_AUTO_PAYOUT_ENABLED;
async function user(parent: string | null = null, cash = 1000000) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name,referral_code,referred_by) VALUES($1,$2,'test-only','QA member',$3,$4)",
    [id, `${id}@example.invalid`, `CVJ-${id.slice(0, 10)}`, parent],
  );
  await db.query("INSERT INTO cinevjet.wallets(user_id,balance) VALUES($1,$2)", [id, cash]);
  await db.query("INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES($1,1000000)", [id]);
  return id;
}
const root = await user(),
  outsider = await user(),
  admin = await user();
await db.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [admin]);
async function finance() {
  return (
    await db.query(
      "SELECT (SELECT sum(balance) FROM cinevjet.wallets) cash,(SELECT sum(reserved) FROM cinevjet.wallets) held,(SELECT sum(balance) FROM cinevjet.coin_wallets) coins,(SELECT count(*) FROM cinevjet.wallet_ledger) ledger,(SELECT count(*) FROM cinevjet.referral_commissions) commissions,(SELECT count(*) FROM cinevjet.vip_subscriptions) vip",
    )
  ).rows[0];
}
const input = (amount: number, key = randomUUID()) => ({
  amount,
  bank_name: "MB",
  account_number: "123456789",
  account_name: "TEST ONLY",
  idempotency_key: key,
});
test("all six VIP descriptions match the supplied table without crediting principal", async () => {
  const before = await finance();
  const plans = await vipPlans();
  const table = [
    [150000, 5, 75, 75000, 225000],
    [300000, 8, 120, 120000, 420000],
    [500000, 12, 180, 180000, 680000],
    [1000000, 16, 240, 240000, 1240000],
    [2000000, 20, 300, 300000, 2300000],
    [5000000, 25, 375, 375000, 5375000],
  ];
  for (let i = 0; i < 6; i++) {
    const plan = plans.find((p) => p.id === `VIP_${i + 1}`)!;
    assert.equal(plan.duration_days, 15);
    assert.deepEqual(
      [
        plan.price,
        plan.mission_count,
        plan.total_videos,
        plan.additional_amount,
        plan.total_return,
      ],
      table[i],
    );
    assert.equal(plan.total_return - plan.price, plan.additional_amount);
  }
  assert.deepEqual(await finance(), before);
});
test("admin can edit description independently of actual mission rewards", async () => {
  const before = await finance();
  const plan = (await vipPlans()).find((p) => p.id === "VIP_1")!;
  await assert.rejects(() => updateVipPlan(root, plan.id, { ...plan }));
  const edited = await updateVipPlan(admin, plan.id, {
    name: plan.name,
    price: plan.price,
    duration_days: 15,
    active: true,
    purchase_enabled: true,
    mission_count: 5,
    mission_reward: plan.mission_reward,
    additional_amount: 90000,
  });
  assert.equal(edited.additional_amount, 90000);
  assert.equal(edited.mission_reward, 2600);
  assert.equal((await vipPlans()).find((p) => p.id === plan.id)!.total_return, 240000);
  assert.deepEqual(await finance(), before);
});
test("withdrawal presets have correct 4% fee, one hold and no duplicate charge", async () => {
  for (const [amount, fee, net] of [
    [35000, 1400, 33600],
    [70000, 2800, 67200],
    [110000, 4400, 105600],
    [110001, 4401, 105600],
  ]) {
    const id = await user(null, amount),
      body = input(amount);
    const first = await createWithdrawalRequest(id, body),
      second = await createWithdrawalRequest(id, body);
    assert.equal(second.id, first.id);
    assert.equal(first.fee, fee);
    assert.equal(first.amount - first.fee, net);
    const wallet = (
      await db.query("SELECT balance,reserved FROM cinevjet.wallets WHERE user_id=$1", [id])
    ).rows[0];
    assert.equal(Number(wallet.balance), amount);
    assert.equal(Number(wallet.reserved), amount);
    assert.equal(
      Number(
        (await db.query("SELECT count(*) AS n FROM cinevjet.withdrawals WHERE user_id=$1", [id]))
          .rows[0].n,
      ),
      1,
    );
    await assert.rejects(() => createWithdrawalRequest(id, input(amount)));
    await completeWithdrawal(admin, first.id, {
      action: "REJECT",
      reason: "Isolated test cleanup",
    });
    assert.equal(
      Number(
        (await db.query("SELECT reserved FROM cinevjet.wallets WHERE user_id=$1", [id])).rows[0]
          .reserved,
      ),
      0,
    );
  }
  assert.equal(autoPayoutEnabled(), false);
});
test("invalid, custom below threshold, overflow and over-balance withdrawals are rejected", async () => {
  for (const amount of [-1, 0, 35000.5, 50000, 70001, 109999, Number.MAX_SAFE_INTEGER]) {
    assert.equal(validWithdrawalSelection(amount), false);
    await assert.rejects(() => createWithdrawalRequest(root, input(amount)));
  }
  assert.equal(withdrawalFee(110001), 4401);
  await assert.rejects(() => createWithdrawalRequest(root, input(1000001)));
});
test("existing pending fee stays unchanged when the new policy is applied", async () => {
  const id = randomUUID(),
    key = randomUUID();
  await db.query(
    "INSERT INTO cinevjet.withdrawals(id,user_id,amount,fee,destination,idempotency_key,bank_name,bank_account_number,bank_account_name,user_note) VALUES($1,$2,110000,3000,'test-only',$3,'MB','123456789','TEST ONLY','')",
    [id, root, key],
  );
  const existing = await createWithdrawalRequest(root, input(110000, key));
  assert.equal(existing.fee, 3000);
});
test("coin redemption uses the defined rate and charges percentage once without touching VND", async () => {
  const before = (
    await db.query("SELECT balance FROM cinevjet.wallets WHERE user_id=$1", [outsider])
  ).rows[0];
  const body = {
    coins: 35000,
    bank_name: "MB",
    account_number: "123456789",
    account_name: "TEST ONLY",
    idempotency_key: randomUUID(),
  };
  const r = await createRedemption(outsider, body);
  assert.equal(r.amount, 35000);
  assert.equal(r.fee, 1400);
  assert.equal((await createRedemption(outsider, body)).id, r.id);
  assert.deepEqual(
    (await db.query("SELECT balance FROM cinevjet.wallets WHERE user_id=$1", [outsider])).rows[0],
    before,
  );
});
test("referral stats include exactly three levels, actual deposits, pagination and no private fields", async () => {
  const level1 = await user(root),
    level2 = await user(level1),
    level3 = await user(level2);
  await user(level3);
  for (let i = 0; i < 22; i++) await user(root);
  await db.query(
    "INSERT INTO cinevjet.deposits(id,user_id,amount,idempotency_key,status,provider) VALUES($1,$2,50000,$3,'COMPLETED','PAYOS'),($4,$5,50000,$6,'PENDING','PAYOS')",
    [randomUUID(), level2, randomUUID(), randomUUID(), level1, randomUUID()],
  );
  const before = await finance();
  const dashboard = await referralDashboard(root);
  assert.deepEqual(dashboard.stats, { total: 25, funded: 1, level1: 23, level2: 1, level3: 1 });
  assert.equal(dashboard.members.length, 20);
  assert.equal(dashboard.pagination.pages, 2);
  assert.equal((await referralDashboard(root, { page: 2 })).members.length, 5);
  assert.equal((await referralDashboard(root, { level: 2 })).members[0].level, 2);
  assert.equal((await referralDashboard(outsider)).stats.total, 0);
  assert.equal(dashboard.policy.status, "DRAFT");
  assert.deepEqual(dashboard.policy.percentages, [20, 5, 1]);
  assert.deepEqual(Object.keys(dashboard.members[0]).sort(), [
    "active",
    "funded",
    "joined_at",
    "level",
    "member_code",
    "nickname",
  ]);
  assert.equal(referralFilters.safeParse({ user_id: outsider }).success, false);
  assert.deepEqual(await finance(), before);
});
test("database prevents self referral, parent manipulation and referral cycles", async () => {
  const self = randomUUID();
  await assert.rejects(() =>
    db.query(
      "INSERT INTO cinevjet.users(id,email,password_hash,display_name,referred_by) VALUES($1,$2,'unused','Self',$1)",
      [self, `${self}@example.invalid`],
    ),
  );
  await assert.rejects(() =>
    db.query("UPDATE cinevjet.users SET referred_by=id WHERE id=$1", [root]),
  );
  const child = await user(root);
  await assert.rejects(() =>
    db.query("UPDATE cinevjet.users SET referred_by=$1 WHERE id=$2", [outsider, child]),
  );
  await assert.rejects(() =>
    db.query("UPDATE cinevjet.users SET referred_by=$1 WHERE id=$2", [child, root]),
  );
});
test.after(async () => db.close());
