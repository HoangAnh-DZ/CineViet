import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { pgConfig } from "../scripts/pg-config.mjs";
import { rewardsSnapshot, claimDailyCheckIn, openVipCheckinCycle } from "../src/server/rewards";
import { vipPlans } from "../src/server/account";
import { coinsToVnd } from "../src/domain/coins";
assert.ok(
  process.env.CINEVJET_TEST_BRANCH_ID?.startsWith("br-"),
  "Only an isolated test branch may run these tests",
);
assert.notEqual(process.env.CINEVJET_TEST_BRANCH_ID, "br-sparkling-art-b3p3erx4");
const pool = new Pool({ ...pgConfig(), max: 8 });
const fixtures = {
  FREE: { price: 0, rewards: [200, 300, 500, 700, 1000, 1300, 2000], total: 6000 },
  VIP_BASIC: {
    price: 49000,
    rewards: [5000, 7000, 9000, 12000, 15000, 20000, 31000],
    total: 99000,
  },
  VIP_PLUS: {
    price: 99000,
    rewards: [8000, 10000, 15000, 18000, 22000, 30000, 46000],
    total: 149000,
  },
  VIP_PREMIUM: {
    price: 199000,
    rewards: [12000, 18000, 25000, 30000, 40000, 50000, 74000],
    total: 249000,
  },
};
await pool.query(
  "CREATE TABLE IF NOT EXISTS public.cinevjet_test_clock(value timestamptz NOT NULL); DELETE FROM public.cinevjet_test_clock; INSERT INTO public.cinevjet_test_clock VALUES('2026-11-01T03:00:00Z'); CREATE OR REPLACE FUNCTION cinevjet.reward_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT value FROM public.cinevjet_test_clock $$",
);
async function at(day: number, hour = 3) {
  await pool.query("UPDATE public.cinevjet_test_clock SET value=$1", [
    new Date(Date.UTC(2026, 10, day, hour)).toISOString(),
  ]);
}
async function user() {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,'test-only','VIP Test')",
    [id, "vip-test-" + id + "@example.com"],
  );
  await pool.query("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
  await pool.query("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
  return id;
}
async function purchase(
  id: string,
  tier: keyof typeof fixtures = "VIP_BASIC",
  expires = "2026-12-01T03:00:00Z",
  verified = true,
) {
  const subscription = randomUUID(),
    reference = "test-purchase-" + randomUUID();
  await pool.query(
    "INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,started_at,expires_at,status,activation_reference,activation_verified_at) VALUES($1,$2,$3,'2026-11-01T00:00:00Z',$4,'ACTIVE',$5,$6)",
    [
      subscription,
      id,
      tier,
      expires,
      verified ? reference : null,
      verified ? "2026-11-01T00:00:00Z" : null,
    ],
  );
  return { subscription, reference };
}
async function count(table: string, id: string) {
  return Number(
    (await pool.query(`SELECT count(*)::int count FROM cinevjet.${table} WHERE user_id=$1`, [id]))
      .rows[0].count,
  );
}
async function balance(id: string) {
  return Number(
    (await pool.query("SELECT balance FROM cinevjet.coin_wallets WHERE user_id=$1", [id])).rows[0]
      .balance,
  );
}
test("VIP rewards on isolated Neon PostgreSQL", async (t) => {
  for (const [tier, expected] of Object.entries(fixtures))
    await t.test(tier + " schedule, price, endpoints and exact total", async () => {
      const plan = (await vipPlans()).find((p) => p.tier === tier)!;
      assert.equal(plan.price, expected.price);
      assert.deepEqual(plan.rewards, expected.rewards);
      assert.equal(plan.total, expected.total);
      if (tier !== "FREE") assert.equal(plan.difference, 50000);
    });
  await t.test("one coin is one VND; fractional and unsafe values rejected", () => {
    for (const n of [0, 1000, 50000, 99000]) assert.equal(coinsToVnd(n), n);
    for (const n of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => coinsToVnd(n));
  });
  await t.test("Free seven days credits 6000, once per date, then restarts", async () => {
    const id = await user();
    for (let d = 1; d <= 7; d++) {
      await at(d);
      const s = await claimDailyCheckIn(id);
      assert.equal(s.ledger[0].amount, fixtures.FREE.rewards[d - 1]);
      assert.equal(s.claimed_today, true);
    }
    assert.equal(await balance(id), 6000);
    assert.equal(await count("coin_ledger", id), 7);
    await at(8);
    const s = await rewardsSnapshot(id);
    assert.equal(s.days[0].status, "AVAILABLE");
    assert.equal(s.days[0].reward, 200);
  });
  for (const tier of ["VIP_BASIC", "VIP_PLUS", "VIP_PREMIUM"] as const)
    await t.test(
      tier + " activation, seven claims, completion, membership retained and Free thereafter",
      async () => {
        await at(1);
        const id = await user(),
          p = await purchase(id, tier),
          cycle = await openVipCheckinCycle(p.subscription, p.reference);
        assert.equal((await rewardsSnapshot(id)).cycle?.current_day, 0);
        for (let d = 1; d <= 7; d++) {
          await at(d);
          const s = await claimDailyCheckIn(id);
          assert.equal(s.days[d - 1].reward, fixtures[tier].rewards[d - 1]);
          assert.equal(s.cycle?.current_day, d);
        }
        const complete = await rewardsSnapshot(id);
        assert.equal(complete.cycle?.status, "COMPLETED");
        assert.equal(
          complete.days.every((d) => d.status === "CLAIMED"),
          true,
        );
        assert.equal(await balance(id), fixtures[tier].total);
        assert.equal(await count("coin_ledger", id), 7);
        assert.equal(await openVipCheckinCycle(p.subscription, p.reference), cycle);
        assert.equal(await count("vip_checkin_cycles", id), 1);
        for (let d = 8; d <= 21; d++) {
          await at(d);
          const s = await claimDailyCheckIn(id);
          assert.equal(s.reward_tier, "FREE");
          assert.ok(s.membership);
          assert.equal(s.cycle?.status, "COMPLETED");
        }
        assert.equal(await balance(id), fixtures[tier].total + 12000);
        assert.equal(await count("vip_checkin_cycles", id), 1);
      },
    );
  await t.test("concurrent duplicate purchase retries create exactly one cycle", async () => {
    await at(1);
    const id = await user(),
      p = await purchase(id);
    const cycles = await Promise.all(
      Array.from({ length: 12 }, () => openVipCheckinCycle(p.subscription, p.reference)),
    );
    assert.equal(new Set(cycles).size, 1);
    assert.equal(await count("vip_checkin_cycles", id), 1);
  });
  await t.test("concurrent claims credit wallet and ledger exactly once", async () => {
    await at(1);
    const id = await user(),
      p = await purchase(id, "VIP_PREMIUM");
    await openVipCheckinCycle(p.subscription, p.reference);
    const results = await Promise.all(Array.from({ length: 20 }, () => claimDailyCheckIn(id)));
    assert.equal(
      results.every((s) => s.wallet.balance === 12000),
      true,
    );
    assert.equal(await count("daily_checkins", id), 1);
    assert.equal(await count("coin_ledger", id), 1);
    assert.equal(await balance(id), 12000);
    assert.equal((await rewardsSnapshot(id)).cycle?.current_day, 1);
  });
  await t.test("membership alone and unverified/demo activation never open a cycle", async () => {
    await at(1);
    const id = await user(),
      p = await purchase(id, "VIP_BASIC", undefined, false);
    assert.equal((await rewardsSnapshot(id)).reward_tier, "FREE");
    await assert.rejects(openVipCheckinCycle(p.subscription, p.reference), /xác minh/);
    assert.equal(await count("vip_checkin_cycles", id), 0);
  });
  await t.test(
    "expiry makes unfinished cycle ineffective on reads and Free on next claim",
    async () => {
      await at(1);
      const id = await user(),
        p = await purchase(id, "VIP_PLUS", "2026-11-02T03:00:00Z");
      await openVipCheckinCycle(p.subscription, p.reference);
      await claimDailyCheckIn(id);
      await at(2);
      const s = await rewardsSnapshot(id);
      assert.equal(s.reward_tier, "FREE");
      assert.equal(s.cycle?.status, "EXPIRED");
      assert.equal(
        (await pool.query("SELECT status FROM cinevjet.vip_checkin_cycles WHERE user_id=$1", [id]))
          .rows[0].status,
        "ACTIVE",
      ); // GET is read-only.
      await claimDailyCheckIn(id);
      assert.equal(await balance(id), 8200);
      assert.equal((await rewardsSnapshot(id)).cycle?.status, "EXPIRED");
    },
  );
  await t.test(
    "upgrade cancels Basic, starts Plus day one without backfill, respects global daily limit",
    async () => {
      await at(1);
      const id = await user(),
        basic = await purchase(id);
      const old = await openVipCheckinCycle(basic.subscription, basic.reference);
      await claimDailyCheckIn(id);
      await pool.query("UPDATE public.cinevjet_test_clock SET value=value+interval '1 second'");
      const plus = await purchase(id, "VIP_PLUS");
      const fresh = await openVipCheckinCycle(plus.subscription, plus.reference);
      assert.equal((await rewardsSnapshot(id)).cycle?.current_day, 0);
      await claimDailyCheckIn(id);
      assert.equal(await balance(id), 5000);
      assert.equal(
        (await pool.query("SELECT status FROM cinevjet.vip_checkin_cycles WHERE id=$1", [old]))
          .rows[0].status,
        "CANCELLED",
      );
      assert.equal(await openVipCheckinCycle(basic.subscription, basic.reference), old);
      assert.equal((await rewardsSnapshot(id)).cycle?.id, fresh);
      await at(2);
      const s = await claimDailyCheckIn(id);
      assert.equal(s.cycle?.current_day, 1);
      assert.equal(await balance(id), 13000);
    },
  );
  await t.test("missed days retain next reward milestone; no consecutive-day reset", async () => {
    await at(1);
    const id = await user(),
      p = await purchase(id);
    await openVipCheckinCycle(p.subscription, p.reference);
    await claimDailyCheckIn(id);
    await at(4);
    const s = await claimDailyCheckIn(id);
    assert.equal(s.cycle?.current_day, 2);
    assert.equal(await balance(id), 12000);
  });
  await t.test(
    "Ho Chi Minh calendar midnight, not client date, defines claim uniqueness",
    async () => {
      const id = await user();
      await pool.query("UPDATE public.cinevjet_test_clock SET value='2026-11-01T16:59:59Z'");
      const one = await claimDailyCheckIn(id);
      assert.equal(one.calendar_date, "2026-11-01");
      await pool.query("UPDATE public.cinevjet_test_clock SET value='2026-11-01T17:00:00Z'");
      const two = await claimDailyCheckIn(id);
      assert.equal(two.calendar_date, "2026-11-02");
      assert.equal(await balance(id), 500);
    },
  );
  await t.test(
    "transaction failure rolls back check-in, ledger and cycle progress together",
    async () => {
      await at(1);
      const id = await user();
      const p = await purchase(id);
      await openVipCheckinCycle(p.subscription, p.reference);
      await pool.query(
        "UPDATE cinevjet.coin_wallets SET balance=9007199254740991 WHERE user_id=$1",
        [id],
      );
      await assert.rejects(claimDailyCheckIn(id));
      assert.equal(await count("daily_checkins", id), 0);
      assert.equal(await count("coin_ledger", id), 0);
      assert.equal(await balance(id), Number.MAX_SAFE_INTEGER);
      assert.equal((await rewardsSnapshot(id)).cycle?.current_day, 0);
    },
  );
  await t.test("cycle snapshots survive later admin price/schedule edits", async () => {
    await at(1);
    const id = await user(),
      p = await purchase(id);
    await openVipCheckinCycle(p.subscription, p.reference);
    await pool.query(
      "UPDATE cinevjet.vip_plans SET price=59000,checkin_rewards=ARRAY[1,2,3,4,5,6,7] WHERE id=$1",
      ["VIP_BASIC"],
    );
    assert.equal((await rewardsSnapshot(id)).total, 99000);
    await claimDailyCheckIn(id);
    assert.equal(await balance(id), 5000);
    await pool.query(
      "UPDATE cinevjet.vip_plans SET price=49000,checkin_rewards=$1::integer[] WHERE id=$2",
      [fixtures.VIP_BASIC.rewards, "VIP_BASIC"],
    );
  });
  await t.test("disabled reward configuration cannot credit or open new VIP cycles", async () => {
    await at(1);
    const id = await user();
    await pool.query("UPDATE cinevjet.vip_plans SET reward_enabled=false WHERE id='FREE'");
    assert.equal(
      (await rewardsSnapshot(id)).days.some((d) => d.status === "AVAILABLE"),
      false,
    );
    await assert.rejects(claimDailyCheckIn(id), /tạm dừng/);
    await pool.query("UPDATE cinevjet.vip_plans SET reward_enabled=true WHERE id='FREE'");
    const p = await purchase(id);
    await pool.query("UPDATE cinevjet.vip_plans SET reward_enabled=false WHERE id='VIP_BASIC'");
    await assert.rejects(openVipCheckinCycle(p.subscription, p.reference), /hợp lệ/);
    await pool.query("UPDATE cinevjet.vip_plans SET reward_enabled=true WHERE id='VIP_BASIC'");
  });
}).finally(async () => {
  await pool.query("UPDATE public.cinevjet_test_clock SET value='2026-11-01T03:00:00Z'");
  await pool.end();
});
