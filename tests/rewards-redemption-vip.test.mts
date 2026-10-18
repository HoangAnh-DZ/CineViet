import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgConfig } from "../scripts/pg-config.mjs";
import { createRedemption, redemptionSnapshot, redemptionHistory } from "../src/server/redemption";
import {
  createVipPurchase,
  approveVipPurchase,
  userVipPurchases,
} from "../src/server/vip-purchases";
import {
  completeWithdrawal,
  adminMoneyDetail,
  createWithdrawalRequest,
  createDepositRequest,
  approveDepositRequest,
  userMoneyRequests,
} from "../src/server/manual-money";
import { claimDailyCheckIn, rewardsSnapshot } from "../src/server/rewards";
import { dashboardOverview, moneyTransactions } from "../src/server/dashboard";
import { memberActivity } from "../src/features/admin/presentation-data";
import { redemptionInput, vipPurchaseInput } from "../src/domain/money";
import { COIN_VALUE_VND } from "../src/domain/coins";
if (!(process.env.DATABASE_URL && process.env.LEGACY_REWARDS_QA === "1")) {
  test("Legacy dedicated Neon QA suite", {skip: "Dedicated QA credentials/branch unavailable; current contracts, coins, withdrawals and playback claims are covered by vip-bank.test.mts"}, () => {});
} else {
const host = "ep-patient-surf-b3s99cl5-pooler.c-4.ap-southeast-1.aws.neon.tech";
const url = new URL(process.env.DATABASE_URL!);
assert.notEqual(
  url.hostname,
  host,
  "Start with the existing credential, then force the isolated QA host.",
);
url.hostname = host;
process.env.DATABASE_URL = url.toString();
const pool = new Pool({ ...pgConfig(), max: 10 });
(
  globalThis as typeof globalThis & { cinevjetDatabase: ReturnType<typeof drizzle> }
).cinevjetDatabase = drizzle(pool);
const tables = [
  "users",
  "movies",
  "episodes",
  "video_sources",
  "favorites",
  "watch_history",
  "wallets",
  "coin_wallets",
  "wallet_ledger",
  "coin_ledger",
  "daily_checkins",
  "vip_plans",
  "vip_subscriptions",
  "vip_checkin_cycles",
  "short_videos",
  "admin_users",
  "short_uploads",
  "deposits",
  "withdrawals",
];
async function fingerprints() {
  const rows: Record<string, unknown> = {};
  for (const t of tables) {
    const omit =
      t === "coin_wallets"
        ? "-'reserved'"
        : t === "withdrawals"
          ? "-'source_asset'-'coins_amount'-'coin_value_vnd'"
          : "";
    rows[t] = (
      await pool.query(
        `SELECT count(*)::int count,md5(COALESCE(jsonb_agg((to_jsonb(t)${omit}) ORDER BY (to_jsonb(t)${omit})::text)::text,'[]')) fingerprint FROM cinevjet.${t} t`,
      )
    ).rows[0];
  }
  return rows;
}
const before = await fingerprints();
const direct = new URL(url);
direct.hostname = direct.hostname.replace("-pooler", "");
const migration = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
  env: { ...process.env, DATABASE_URL: direct.toString() },
  encoding: "utf8",
});
assert.equal(migration.status, 0, migration.stderr);
assert.deepEqual(
  await fingerprints(),
  before,
  "Additive migration must preserve every pre-existing row/asset.",
);
await writeFile(
  "test-results/rewards-redemption-migration.json",
  JSON.stringify(
    {
      status: "PASS",
      branch: "br-quiet-silence-b30z8m9u",
      unchangedTables: tables.length,
      productionWritten: false,
    },
    null,
    2,
  ),
);
async function user(coins = 0, cash = 200000, admin = false) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)",
    [id, `${id}@redemption-qa.example.test`, "unused", "Redemption QA"],
  );
  await pool.query("INSERT INTO cinevjet.wallets(user_id,balance) VALUES($1,$2)", [id, cash]);
  await pool.query("INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES($1,$2)", [id, coins]);
  if (admin) await pool.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [id]);
  return id;
}
async function bill(id: string) {
  const key = randomUUID();
  await pool.query(
    "INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height) VALUES($1,$2,$3,'image/webp',120,10,10)",
    [key, id, `https://1uun41e8ziuloclw.public.blob.vercel-storage.com/qa-fixture-${key}.webp`],
  );
  return key;
}
const admin = await user(0, 0, true),
  admin2 = await user(0, 0, true),
  regular = await user();
const plans = (
  await pool.query(
    "SELECT * FROM cinevjet.vip_plans WHERE active AND reward_enabled AND reward_tier<>'FREE' ORDER BY price",
  )
).rows;
assert.ok(plans.length);
const plan = plans[0];
const redeem = (coins = 50000) => ({
  coins,
  bank_name: "TPBank",
  account_number: "1234567890",
  account_name: "QA ONLY",
  idempotency_key: randomUUID(),
});
const complete = { action: "COMPLETE", confirmed: true, note: "QA no real transfer" };
const approve = { action: "APPROVE", confirmed: true, note: "QA no real payment" };
const rejected = { action: "REJECT", reason: "QA thông tin chưa khớp", note: "INTERNAL QA" };
const status = (s: number) => (e: unknown) =>
  !!e && typeof e === "object" && "status" in e && e.status === s;
async function wallet(id: string, coin = true) {
  return (
    await pool.query(
      `SELECT balance::int,reserved::int FROM cinevjet.${coin ? "coin_wallets" : "wallets"} WHERE user_id=$1`,
      [id],
    )
  ).rows[0];
}
async function ledger(id: string, coin = true) {
  return (
    await pool.query(
      `SELECT * FROM cinevjet.${coin ? "coin_ledger" : "wallet_ledger"} WHERE user_id=$1`,
      [id],
    )
  ).rows;
}
async function purchase(id: string) {
  return { plan_id: String(plan.id), bill_id: await bill(id), idempotency_key: randomUUID() };
}
const results: { name: string; status: string }[] = [];
test("Reward redemption and direct VIP bank purchase on isolated Neon", async (t) => {
  const check = async (name: string, fn: () => Promise<void>) => {
    await t.test(name, async () => {
      try {
        await fn();
        results.push({ name, status: "PASS" });
      } catch (e) {
        results.push({ name, status: "FAIL" });
        throw e;
      }
    });
  };
  await check(
    "Redemption: invalid, negative, zero, fractional and forged rate/owner rejected",
    async () => {
      for (const coins of [0, -1, 0.1, NaN, Infinity, "50000"])
        assert.equal(redemptionInput.safeParse({ ...redeem(), coins }).success, false);
      for (const field of ["user_id", "amount", "coin_value_vnd", "source_asset", "fee"])
        assert.equal(redemptionInput.safeParse({ ...redeem(), [field]: 1 }).success, false);
      assert.equal(
        redemptionInput.safeParse({ ...redeem(), account_number: "abc" }).success,
        false,
      );
    },
  );
  await check(
    "Redemption: min and max rules plus insufficient coins preserve both wallets",
    async () => {
      const u = await user(40000);
      for (const n of [49999, 50000, 100000001])
        await assert.rejects(createRedemption(u, redeem(n)), status(400));
      assert.deepEqual(await wallet(u), { balance: 40000, reserved: 0 });
      assert.deepEqual(await wallet(u, false), { balance: 200000, reserved: 0 });
    },
  );
  await check("Redemption: suspended account blocked", async () => {
    const u = await user(100000);
    await pool.query("UPDATE cinevjet.users SET status='SUSPENDED' WHERE id=$1", [u]);
    await assert.rejects(createRedemption(u, redeem()), status(403));
  });
  await check("Redemption: actual rate and fee snapshot, pending reserves coins only", async () => {
    const u = await user(100000),
      r = await createRedemption(u, redeem());
    assert.equal(r.status, "PENDING");
    assert.equal(r.amount, 50000 * COIN_VALUE_VND);
    assert.equal(r.fee, 3000);
    assert.equal(r.source_asset, "COIN");
    assert.deepEqual(await wallet(u), { balance: 100000, reserved: 50000 });
    assert.equal((await redemptionSnapshot(u)).available, 50000);
    assert.equal((await ledger(u)).length, 0);
    assert.deepEqual(await wallet(u, false), { balance: 200000, reserved: 0 });
  });
  await check("Redemption: concurrent identical key reserves exactly once", async () => {
    const u = await user(100000),
      d = redeem(),
      r = await Promise.all([
        createRedemption(u, d),
        createRedemption(u, d),
        createRedemption(u, d),
      ]);
    assert.equal(new Set(r.map((x) => x.id)).size, 1);
    assert.equal((await wallet(u)).reserved, 50000);
    await assert.rejects(createRedemption(u, { ...d, coins: 60000 }), status(409));
    await assert.rejects(createRedemption(regular, d), status(409));
  });
  await check("Redemption: competing keys cannot spend held coins twice", async () => {
    const u = await user(75000);
    const r = await Promise.allSettled([
      createRedemption(u, redeem()),
      createRedemption(u, redeem()),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    assert.deepEqual(await wallet(u), { balance: 75000, reserved: 50000 });
  });
  await check("Redemption: ownership and Admin authorization enforced", async () => {
    const u = await user(100000),
      r = await createRedemption(u, redeem());
    assert.equal(
      (await redemptionHistory(regular)).some((x) => x.id === r.id),
      false,
    );
    await assert.rejects(adminMoneyDetail(regular, "WITHDRAWAL", r.id), status(403));
    await assert.rejects(completeWithdrawal(regular, r.id, complete), status(403));
    assert.equal(
      (await adminMoneyDetail(admin, "WITHDRAWAL", r.id)).bank_account_number,
      "1234567890",
    );
  });
  await check("Redemption: explicit transfer confirmation required", async () => {
    const u = await user(100000),
      r = await createRedemption(u, redeem());
    await assert.rejects(completeWithdrawal(admin, r.id, { action: "COMPLETE" }), status(400));
    await assert.rejects(
      completeWithdrawal(admin, r.id, { action: "APPROVE", confirmed: true }),
      status(400),
    );
    assert.equal((await wallet(u)).reserved, 50000);
  });
  await check(
    "Redemption: concurrent completion creates one negative coin ledger, never cash ledger",
    async () => {
      const u = await user(100000),
        r = await createRedemption(u, redeem());
      const outcomes = await Promise.allSettled([
        completeWithdrawal(admin, r.id, complete),
        completeWithdrawal(admin2, r.id, complete),
      ]);
      assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
      assert.deepEqual(await wallet(u), { balance: 50000, reserved: 0 });
      assert.deepEqual(await wallet(u, false), { balance: 200000, reserved: 0 });
      const l = await ledger(u);
      assert.equal(l.length, 1);
      assert.equal(Number(l[0].amount), -50000);
      assert.equal(l[0].type, "EXCHANGE");
      assert.equal((await ledger(u, false)).length, 0);
      assert.equal((await redemptionHistory(u))[0].status, "COMPLETED");
      await assert.rejects(completeWithdrawal(admin, r.id, rejected), status(409));
      assert.equal(
        (await adminMoneyDetail(admin, "WITHDRAWAL", r.id)).audit?.action,
        "REDEMPTION_COMPLETED",
      );
    },
  );
  await check("Redemption: rejection returns held coins exactly once", async () => {
    const u = await user(100000),
      r = await createRedemption(u, redeem());
    await completeWithdrawal(admin, r.id, rejected);
    assert.deepEqual(await wallet(u), { balance: 100000, reserved: 0 });
    await assert.rejects(completeWithdrawal(admin, r.id, rejected), status(409));
    assert.equal((await ledger(u)).length, 0);
    assert.equal((await redemptionHistory(u))[0].review_note, rejected.reason);
    assert.equal("admin_note" in (await redemptionHistory(u))[0], false);
  });
  await check("Redemption: failed transfer returns held coins exactly once", async () => {
    const u = await user(100000),
      r = await createRedemption(u, redeem());
    const out = await Promise.allSettled([
      completeWithdrawal(admin, r.id, { ...rejected, action: "FAIL" }),
      completeWithdrawal(admin2, r.id, { ...rejected, action: "FAIL" }),
    ]);
    assert.equal(out.filter((x) => x.status === "fulfilled").length, 1);
    assert.deepEqual(await wallet(u), { balance: 100000, reserved: 0 });
    assert.equal((await redemptionHistory(u))[0].status, "FAILED");
    assert.equal(
      (await adminMoneyDetail(admin, "WITHDRAWAL", r.id)).audit?.action,
      "REDEMPTION_FAILED",
    );
  });
  await check("Redemption: pending limit and database asset constraints", async () => {
    const u = await user(400000);
    for (let i = 0; i < 5; i++) await createRedemption(u, redeem());
    await assert.rejects(createRedemption(u, redeem()), status(429));
    await assert.rejects(
      pool.query("UPDATE cinevjet.coin_wallets SET reserved=balance+1 WHERE user_id=$1", [u]),
    );
    await assert.rejects(
      pool.query(
        "UPDATE cinevjet.withdrawals SET coins_amount=NULL WHERE user_id=$1 AND source_asset='COIN'",
        [u],
      ),
    );
  });
  await check(
    "Regression: cash withdrawal and redemption remain independent, key collisions rejected",
    async () => {
      const u = await user(100000),
        d = redeem(),
        r = await createRedemption(u, d);
      await assert.rejects(
        createWithdrawalRequest(u, { ...d, amount: d.coins, coins: undefined }),
        () => true,
      );
      const { coins, ...cash } = d;
      await assert.rejects(createWithdrawalRequest(u, { ...cash, amount: coins }), status(409));
      const w = await createWithdrawalRequest(u, {
        ...cash,
        amount: 50000,
        idempotency_key: randomUUID(),
      });
      await completeWithdrawal(admin, w.id, complete);
      assert.deepEqual(await wallet(u, false), { balance: 150000, reserved: 0 });
      assert.equal((await wallet(u)).reserved, 50000);
      await completeWithdrawal(admin, r.id, rejected);
      assert.deepEqual(await wallet(u), { balance: 100000, reserved: 0 });
      const list = await userMoneyRequests(u);
      assert.equal(list.filter((x) => x.source_asset === "VND").length, 1);
      assert.equal(list.filter((x) => x.source_asset === "COIN").length, 1);
    },
  );
  await check(
    "Regression: check-in alongside redemption retains holds and credits once",
    async () => {
      const u = await user(100000);
      await Promise.all([
        createRedemption(u, redeem()),
        claimDailyCheckIn(u),
        claimDailyCheckIn(u),
      ]);
      const state = await rewardsSnapshot(u),
        l = await ledger(u);
      assert.equal(l.length, 1);
      assert.ok(Number(l[0].amount) > 0);
      assert.equal(state.wallet.balance, 100000 + Number(l[0].amount));
      assert.equal((await wallet(u)).reserved, 50000);
      assert.equal(state.claimed_today, true);
    },
  );
  await check("VIP: invalid or forged price/user/activation fields rejected", async () => {
    const d = await purchase(regular);
    for (const f of ["amount", "user_id", "status", "activation_reference", "duration_days"])
      assert.equal(vipPurchaseInput.safeParse({ ...d, [f]: 1 }).success, false);
    await assert.rejects(createVipPurchase(regular, { ...d, plan_id: "free" }), status(400));
  });
  await check("VIP: bill ownership and active plan are checked", async () => {
    const u = await user(),
      other = await user(),
      d = await purchase(other);
    await assert.rejects(createVipPurchase(u, d), status(400));
    await assert.rejects(createVipPurchase(u, { ...d, plan_id: "not-a-plan" }), status(400));
  });
  await check(
    "VIP: direct pending bill order uses real plan price, grants nothing and needs no cash",
    async () => {
      const u = await user(0, 0),
        r = await createVipPurchase(u, await purchase(u));
      assert.equal(r.amount, Number(plan.price));
      assert.equal(r.status, "PENDING");
      assert.equal(
        (await pool.query("SELECT id FROM cinevjet.vip_subscriptions WHERE user_id=$1", [u]))
          .rowCount,
        0,
      );
      assert.equal((await rewardsSnapshot(u)).reward_tier, "FREE");
      assert.deepEqual(await wallet(u, false), { balance: 0, reserved: 0 });
      assert.deepEqual(await wallet(u), { balance: 0, reserved: 0 });
    },
  );
  await check("VIP: concurrent retry creates one order and altered payload fails", async () => {
    const u = await user(),
      d = await purchase(u),
      r = await Promise.all([createVipPurchase(u, d), createVipPurchase(u, d)]);
    assert.equal(r[0].id, r[1].id);
    await assert.rejects(createVipPurchase(u, { ...d, note: "changed" }), status(409));
    await assert.rejects(createVipPurchase(regular, d), status(409));
  });
  await check("VIP: a bill cannot pay twice or be reused for a deposit", async () => {
    const u = await user(),
      d = await purchase(u);
    await createVipPurchase(u, d);
    await assert.rejects(
      createVipPurchase(u, { ...d, idempotency_key: randomUUID() }),
      status(409),
    );
    await assert.rejects(
      createDepositRequest(u, {
        amount: 100000,
        bill_id: d.bill_id,
        idempotency_key: randomUUID(),
      }),
      status(409),
    );
    const b = await bill(u);
    await createDepositRequest(u, { amount: 100000, bill_id: b, idempotency_key: randomUUID() });
    await assert.rejects(
      createVipPurchase(u, { ...d, bill_id: b, idempotency_key: randomUUID() }),
      status(409),
    );
  });
  await check("VIP: normal users and unconfirmed approval cannot activate", async () => {
    const u = await user(),
      r = await createVipPurchase(u, await purchase(u));
    await assert.rejects(approveVipPurchase(regular, r.id, approve), status(403));
    await assert.rejects(approveVipPurchase(admin, r.id, { action: "APPROVE" }), status(400));
    await assert.rejects(
      approveVipPurchase(admin, r.id, { action: "COMPLETE", confirmed: true }),
      status(400),
    );
    assert.equal((await rewardsSnapshot(u)).reward_tier, "FREE");
  });
  await check(
    "VIP: concurrent verified approval activates one membership and cycle atomically",
    async () => {
      const u = await user(),
        r = await createVipPurchase(u, await purchase(u)),
        before = await dashboardOverview(admin);
      const out = await Promise.allSettled([
        approveVipPurchase(admin, r.id, approve),
        approveVipPurchase(admin2, r.id, approve),
      ]);
      assert.equal(out.filter((x) => x.status === "fulfilled").length, 1);
      const s = (await pool.query("SELECT * FROM cinevjet.vip_subscriptions WHERE user_id=$1", [u]))
        .rows;
      const c = (
        await pool.query("SELECT * FROM cinevjet.vip_checkin_cycles WHERE user_id=$1", [u])
      ).rows;
      assert.equal(s.length, 1);
      assert.equal(c.length, 1);
      assert.ok(s[0].activation_verified_at);
      assert.equal(s[0].activation_reference, "VIP_PURCHASE/" + r.id);
      assert.deepEqual(c[0].reward_schedule, plan.checkin_rewards);
      assert.equal(Number(c[0].plan_price), Number(plan.price));
      const snap = await rewardsSnapshot(u);
      assert.equal(snap.reward_tier, plan.reward_tier);
      assert.equal(snap.wallet.balance, 0);
      await claimDailyCheckIn(u);
      assert.equal((await rewardsSnapshot(u)).wallet.balance, Number(plan.checkin_rewards[0]));
      assert.deepEqual(await wallet(u, false), { balance: 200000, reserved: 0 });
      assert.equal((await ledger(u, false)).length, 0);
      const after = await dashboardOverview(admin);
      assert.equal(after.metrics.income - before.metrics.income, Number(plan.price));
      assert.equal(after.metrics.outgoing, before.metrics.outgoing);
      assert.equal(
        (await adminMoneyDetail(admin, "VIP_PURCHASE", r.id)).audit?.action,
        "VIP_APPROVED",
      );
      await assert.rejects(approveVipPurchase(admin, r.id, approve), status(409));
    },
  );
  await check(
    "VIP: rejection leaves membership/cycle/wallet untouched and reason visible only to owner",
    async () => {
      const u = await user(),
        r = await createVipPurchase(u, await purchase(u));
      await approveVipPurchase(admin, r.id, rejected);
      await assert.rejects(approveVipPurchase(admin, r.id, approve), status(409));
      assert.equal(
        (await pool.query("SELECT id FROM cinevjet.vip_subscriptions WHERE user_id=$1", [u]))
          .rowCount,
        0,
      );
      const own = (await userVipPurchases(u))[0];
      assert.equal(own.status, "REJECTED");
      assert.equal(own.review_note, rejected.reason);
      assert.equal("admin_note" in own, false);
      assert.equal(
        (await userVipPurchases(regular)).some((x) => x.id === r.id),
        false,
      );
    },
  );
  await check(
    "VIP: renewal preserves remaining duration, replaces cycle without duplicate credit",
    async () => {
      const u = await user(),
        r = await createVipPurchase(u, await purchase(u));
      await approveVipPurchase(admin, r.id, approve);
      const old = (
        await pool.query(
          "SELECT expires_at FROM cinevjet.vip_subscriptions WHERE user_id=$1 AND status='ACTIVE'",
          [u],
        )
      ).rows[0];
      const second = await createVipPurchase(u, await purchase(u));
      await approveVipPurchase(admin, second.id, approve);
      const s = (
        await pool.query(
          "SELECT expires_at FROM cinevjet.vip_subscriptions WHERE user_id=$1 AND status='ACTIVE'",
          [u],
        )
      ).rows;
      assert.equal(s.length, 1);
      assert.equal(
        new Date(s[0].expires_at).getTime() - new Date(old.expires_at).getTime(),
        Number(plan.duration_days) * 86400000,
      );
      assert.equal((await ledger(u)).length, 0);
      assert.equal(
        (
          await pool.query(
            "SELECT id FROM cinevjet.vip_checkin_cycles WHERE user_id=$1 AND status='ACTIVE'",
            [u],
          )
        ).rowCount,
        1,
      );
    },
  );
  await check("Regression: approved cash deposit still credits cash only", async () => {
    const u = await user(123, 0),
      r = await createDepositRequest(u, {
        amount: 100000,
        bill_id: await bill(u),
        idempotency_key: randomUUID(),
      });
    await approveDepositRequest(admin, r.id, approve);
    assert.deepEqual(await wallet(u, false), { balance: 100000, reserved: 0 });
    assert.deepEqual(await wallet(u), { balance: 123, reserved: 0 });
  });
  await check(
    "Admin: money rows and member summary distinguish coin redemption from cash",
    async () => {
      const u = await user(100000),
        r = await createRedemption(u, redeem());
      await completeWithdrawal(admin, r.id, complete);
      const rows = await moneyTransactions(admin);
      const row = rows.find((x) => x.id === r.id)!;
      assert.equal(row.source_asset, "COIN");
      assert.equal(row.coins_amount, 50000);
      const activity = await memberActivity(admin, u);
      assert.equal(activity.money.withdrawn, 0);
      assert.equal(activity.money.coins, 50000);
      assert.equal(activity.transactions[0].kind, "Đổi thưởng");
      assert.equal(activity.rewards[0].amount, -50000);
    },
  );
  await writeFile(
    "test-results/rewards-redemption-server.json",
    JSON.stringify(
      {
        status: results.every((r) => r.status === "PASS") ? "PASS" : "FAIL",
        tests: results.length,
        results,
        branch: "br-quiet-silence-b30z8m9u",
        realPostgresConcurrency: true,
        productionWritten: false,
      },
      null,
      2,
    ),
  );
});
test.after(async () => {
  await pool.end();
});

}
