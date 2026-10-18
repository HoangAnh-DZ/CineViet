import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
process.env.BANK_ACCOUNT_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { vipPlans, entitlements } from "../src/server/account";
import {
  createVipPurchase,
  approveVipPurchase,
  vipBankRequest,
  userVipPurchases,
} from "../src/server/vip-purchases";
import { createPayosOrder, receivePayosWebhook } from "../src/server/payos-payments";
import { signData } from "../src/server/payos-client";
import {
  missionsSnapshot,
  claimMission,
  startRewardWatch,
  heartbeatRewardWatch,
} from "../src/server/missions";
import { updateVipPlan } from "../src/server/admin-plans";
import { createRewardCode, redeemRewardCode } from "../src/server/reward-codes";
import { createRedemption, redemptionSnapshot } from "../src/server/redemption";
import { withdrawalTransactions } from "../src/server/dashboard";
import { coinsToVnd, COIN_VALUE_VND } from "../src/domain/coins";
const db = new PGlite();
const files = (await readdir("database/migrations")).filter((n) => n.endsWith(".sql")).sort();
for (const f of files.filter((n) => n < "0016"))
  await db.exec(await readFile("database/migrations/" + f, "utf8"));
await db.exec(await readFile("database/seed.sql", "utf8"));
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = drizzle(
  db,
) as unknown as NodePgDatabase;
process.env.AUTH_SECRET = "local-only-vip-bank-test-secret-at-least-32";
process.env.PAYOS_CLIENT_ID = "isolated-client";
process.env.PAYOS_API_KEY = "";
process.env.PAYOS_CHECKSUM_KEY = "isolated-checksum";
async function user() {
  const id = randomUUID();
  await db.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,'unused','VIP QA')",
    [id, id + "@example.invalid"],
  );
  await db.query("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
  await db.query("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
  return id;
}
const admin = await user(),
  oldActive = await user(),
  oldPending = await user();
await db.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [admin]);
await db.exec(
  "UPDATE cinevjet.system_settings SET bank_name='QA BANK',account_number='123456789',account_name='LOCAL QA ONLY'; UPDATE cinevjet.vip_plans SET reward_tier='FREE',checkin_rewards=ARRAY[200,300,500,700,1000,1300,2000],reward_enabled=true WHERE id='FREE'",
);
const pendingId = randomUUID(),
  oldSubscription = randomUUID();
await db.query(
  "INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,status,started_at,expires_at) VALUES($1,$2,'VIP_1','ACTIVE',now(),now()+interval '15 days')",
  [oldSubscription, oldActive],
);
for (const [uid, id, sub] of [
  [oldActive, randomUUID(), oldSubscription],
  [oldPending, pendingId, null],
])
  await db.query(
    "INSERT INTO cinevjet.vip_purchase_requests(id,user_id,plan_id,plan_name,amount,duration_days,reward_tier,reward_schedule,benefits_json,bank_name,bank_account_number,bank_account_name,idempotency_key,provider,status,subscription_id) SELECT $1,$2,id,name,price,duration_days,reward_tier,checkin_rewards,benefits_json,'legacy','','',$3,'PAYOS',$4,$5 FROM cinevjet.vip_plans WHERE id='VIP_1'",
    [id, uid, randomUUID(), sub ? "COMPLETED" : "PENDING", sub],
  );
await db.query(
  "INSERT INTO cinevjet.payos_orders(id,user_id,kind,vip_purchase_id,amount,plan_id,idempotency_key,return_url,cancel_url,expires_at,status,payment_link_id,account_number) VALUES($1,$2,'VIP_PURCHASE',$1,150000,'VIP_1',$3,'https://example.invalid/return','https://example.invalid/cancel',now()+interval '30 minutes','PENDING','legacy-vip-link','123456789')",
  [pendingId, oldPending, randomUUID()],
);
async function fingerprint() {
  return (
    await db.query(
      "SELECT (SELECT json_agg(x ORDER BY id) FROM (SELECT id,user_id,plan_id,status,started_at,expires_at FROM cinevjet.vip_subscriptions) x) subs,(SELECT json_agg(x ORDER BY user_id) FROM cinevjet.coin_wallets x) coins,(SELECT json_agg(x ORDER BY user_id) FROM cinevjet.wallets x) cash,(SELECT json_agg(x ORDER BY id) FROM cinevjet.payos_orders x) payments,(SELECT json_agg(x ORDER BY id) FROM (SELECT id,user_id,amount,status,subscription_id,created_at FROM cinevjet.vip_purchase_requests) x) requests",
    )
  ).rows[0];
}
const before = await fingerprint();
await db.exec(await readFile("database/migrations/0016_vip_bank_contracts.sql", "utf8"));
await db.exec(await readFile("database/migrations/0017_vip_official_coins.sql", "utf8"));
const after = await fingerprint();
test("additive migration and catalog update preserve existing financial records and VIP dates", async () => {
  assert.deepEqual(after, before);
  assert.equal((await missionsSnapshot(oldActive)).missions[0].reward, 3000);
  assert.equal(
    (
      await db.query("SELECT plan_snapshot FROM cinevjet.vip_purchase_requests WHERE id=$1", [
        pendingId,
      ])
    ).rows[0].plan_snapshot.mission_reward,
    3000,
  );
  await assert.rejects(
    db.query(
      "UPDATE cinevjet.vip_subscriptions SET plan_snapshot=jsonb_set(plan_snapshot,'{mission_reward}','1') WHERE id=$1",
      [oldSubscription],
    ),
  );
  assert.ok((await entitlements(oldActive)).includes("VIP_MOVIES"));
});
test("six official plans use exact integer coins, quotas and unchanged prices", async () => {
  const expected = [
    [150000, 5, 75, 2600],
    [300000, 8, 120, 3375],
    [500000, 12, 180, 3889],
    [1000000, 16, 240, 5917],
    [2000000, 20, 300, 9667],
    [5000000, 25, 375, 19333],
  ];
  const plans = (await vipPlans()).filter((p) => p.price > 0);
  assert.equal(plans.length, 6);
  for (let i = 0; i < 6; i++) {
    const p = plans.find((p) => p.id === `VIP_${i + 1}`)!;
    assert.equal(p.duration_days, 15);
    assert.deepEqual([p.price, p.mission_count, p.total_videos, p.mission_reward], expected[i]);
    assert.equal(coinsToVnd(p.mission_reward), p.mission_reward);
  }
  assert.equal(COIN_VALUE_VND, 1);
});
test("bank requests are owned, idempotent and do not activate VIP or credit coins", async () => {
  const uid = await user(),
    other = await user(),
    key = randomUUID();
  const input = { plan_id: "VIP_1", idempotency_key: key };
  const requests = await Promise.all(
    Array.from({ length: 5 }, () => createVipPurchase(uid, input)),
  );
  const r = requests[0];
  assert.ok(requests.every((x) => x.id === r.id));
  assert.match(r.payment_reference!, /^CVJ[A-F0-9]{16}$/);
  assert.equal(
    (await createVipPurchase(uid, { ...input, idempotency_key: randomUUID() })).id,
    r.id,
  );
  assert.equal(r.amount, 150000);
  assert.equal(r.plan.mission_reward, 2600);
  assert.equal(r.transfer_bank.account_number, "123456789");
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM cinevjet.vip_subscriptions WHERE user_id=$1", [
        uid,
      ])
    ).rows[0].n,
    0,
  );
  assert.equal(
    Number(
      (await db.query("SELECT balance FROM cinevjet.coin_wallets WHERE user_id=$1", [uid])).rows[0]
        .balance,
    ),
    0,
  );
  assert.equal((await vipBankRequest(uid, { id: r.id }))!.id, r.id);
  await assert.rejects(() => vipBankRequest(other, { id: r.id }));
  for (const extra of [{ amount: 1 }, { status: "PAID" }, { mission_reward: 999999 }])
    await assert.rejects(() => createVipPurchase(uid, { ...input, ...extra }));
  await assert.rejects(() => createVipPurchase(other, input));
  await assert.rejects(() =>
    approveVipPurchase(uid, r.id, {
      action: "APPROVE",
      confirmed: true,
      evidence_reference: "QA-1",
    }),
  );
  await assert.rejects(() =>
    approveVipPurchase(admin, r.id, {
      action: "APPROVE",
      confirmed: false,
      evidence_reference: "QA-1",
    }),
  );
  await assert.rejects(() =>
    approveVipPurchase(admin, r.id, { action: "APPROVE", confirmed: true }),
  );
  await approveVipPurchase(admin, r.id, {
    action: "APPROVE",
    confirmed: true,
    evidence_reference: "LOCAL-VIP-BANK-1",
  });
  await assert.rejects(() =>
    approveVipPurchase(admin, r.id, {
      action: "APPROVE",
      confirmed: true,
      evidence_reference: "LOCAL-VIP-BANK-1",
    }),
  );
  assert.equal((await missionsSnapshot(uid)).missions[0].reward, 2600);
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM cinevjet.vip_subscriptions WHERE user_id=$1", [
        uid,
      ])
    ).rows[0].n,
    1,
  );
  const state = await missionsSnapshot(uid);
  await db.query(
    "INSERT INTO cinevjet.daily_watch_progress(user_id,calendar_date,watched_ms) VALUES($1,$2,30000)",
    [uid, state.calendar_date],
  );
  await claimMission(uid, { mission_id: state.missions[0].id, calendar_date: state.calendar_date });
  await claimMission(uid, { mission_id: state.missions[0].id, calendar_date: state.calendar_date });
  assert.equal(
    Number(
      (await db.query("SELECT balance FROM cinevjet.coin_wallets WHERE user_id=$1", [uid])).rows[0]
        .balance,
    ),
    2600,
  );
  const otherRequest = await createVipPurchase(other, {
    plan_id: "VIP_2",
    idempotency_key: randomUUID(),
  });
  await assert.rejects(() =>
    approveVipPurchase(admin, otherRequest.id, {
      action: "APPROVE",
      confirmed: true,
      evidence_reference: "local-vip-bank-1",
    }),
  );
  assert.equal((await vipBankRequest(other, { id: otherRequest.id }))!.status, "PENDING");
});
test("editing the sale catalog cannot alter a paid or pending contract", async () => {
  const uid = await user();
  const r = await createVipPurchase(uid, { plan_id: "VIP_3", idempotency_key: randomUUID() });
  const p = (await vipPlans()).find((p) => p.id === "VIP_3")!;
  const input = {
    name: p.name,
    price: p.price,
    duration_days: 15,
    active: true,
    purchase_enabled: true,
    mission_count: 12,
    mission_reward: 9999,
  };
  await updateVipPlan(admin, p.id, input);
  assert.equal((await vipBankRequest(uid, { id: r.id }))!.plan.mission_reward, 3889);
  await approveVipPurchase(admin, r.id, {
    action: "APPROVE",
    confirmed: true,
    evidence_reference: "LOCAL-VIP-BANK-3",
  });
  assert.equal((await missionsSnapshot(uid)).missions[0].reward, 3889);
  await updateVipPlan(admin, p.id, { ...input, mission_reward: 3889 });
});
test("existing verified VIP webhooks still settle once after migrations 0016–0017", async (t) => {
  process.env.PAYOS_API_KEY = "isolated-api";
  t.after(() => {
    process.env.PAYOS_API_KEY = "";
  });
  const uid = await user();
  await assert.rejects(() =>
    createVipPurchase(oldPending, { plan_id: "VIP_1", idempotency_key: randomUUID() }),
  );
  const row = (await db.query("SELECT * FROM cinevjet.payos_orders WHERE id=$1", [pendingId]))
    .rows[0];
  const info = {
    id: "legacy-vip-link",
    orderCode: Number(row.order_code),
    amount: 150000,
    amountPaid: 150000,
    amountRemaining: 0,
    status: "PAID",
    transactions: [],
  };
  t.mock.method(globalThis, "fetch", async (input) => {
    assert.ok(String(input).startsWith("https://api-merchant.payos.vn/"));
    return Response.json({ code: "00", desc: "success", data: info, signature: signData(info) });
  });
  const data = {
    orderCode: Number(row.order_code),
    amount: 150000,
    currency: "VND",
    paymentLinkId: "legacy-vip-link",
    code: "00",
    reference: "LEGACY-LOCAL-BANK-1",
    description: "CVJ",
    accountNumber: "123456789",
  };
  const event = { code: "00", success: true, data, signature: signData(data) };
  for (let n = 0; n < 5; n++) await receivePayosWebhook(event);
  assert.equal((await missionsSnapshot(oldPending)).missions[0].reward, 3000);
  assert.equal((await userVipPurchases(oldPending))[0].status, "COMPLETED");
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM cinevjet.vip_subscriptions WHERE user_id=$1", [
        oldPending,
      ])
    ).rows[0].n,
    1,
  );
  process.env.PAYOS_API_KEY = "";
  const manual = await createVipPurchase(uid, { plan_id: "VIP_1", idempotency_key: randomUUID() });
  process.env.PAYOS_API_KEY = "isolated-api";
  const forged = { ...data, orderCode: 999999999 };
  await assert.rejects(() =>
    receivePayosWebhook({ code: "00", success: true, data: forged, signature: signData(forged) }),
  );
  assert.equal((await vipBankRequest(uid, { id: manual.id }))!.status, "PENDING");
});
test("100k coins and two 35k holds remain 30k available, 70k held, two Admin requests", async () => {
  const uid = await user(),
    code = await createRewardCode(admin, { reward_coins: 100000 });
  await redeemRewardCode(uid, { code: code.code });
  const ids = [];
  for (let i = 0; i < 2; i++)
    ids.push(
      (
        await createRedemption(uid, {
          coins: 35000,
          bank_name: "QA BANK",
          account_number: "123456789",
          account_name: "LOCAL QA",
          idempotency_key: randomUUID(),
        })
      ).id,
    );
  const s = await redemptionSnapshot(uid);
  assert.equal(s.available, 30000);
  assert.equal(s.reserved, 70000);
  const adminRows = await withdrawalTransactions(admin, { q: uid });
  assert.equal(adminRows.total, 2);
  assert.deepEqual(adminRows.items.map((r) => r.id).sort(), ids.sort());
});
test("all six activated quotas are enforced server-side and verified playback claims reset by Vietnam day", async () => {
  await db.exec(
    "CREATE OR REPLACE FUNCTION cinevjet.reward_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT COALESCE(NULLIF(current_setting('cinevjet.test_now',true),'')::timestamptz,clock_timestamp()) $$",
  );
  let now = Date.parse("2026-12-11T03:00:00Z");
  const clock = async () => {
    await db.query("SELECT set_config('cinevjet.test_now',$1,false)", [
      new Date(now).toISOString(),
    ]);
  };
  await clock();
  try {
    let viewer = "";
    for (let i = 0; i < 6; i++) {
      const uid = await user(),
        r = await createVipPurchase(uid, {
          plan_id: `VIP_${i + 1}`,
          idempotency_key: randomUUID(),
        });
      await approveVipPurchase(admin, r.id, {
        action: "APPROVE",
        confirmed: true,
        evidence_reference: `LOCAL-QUOTA-${i + 1}`,
      });
      const s = await missionsSnapshot(uid),
        count = [5, 8, 12, 16, 20, 25][i],
        reward = [2600, 3375, 3889, 5917, 9667, 19333][i];
      assert.equal(s.missions.length, count);
      assert.equal(s.missions.at(-1)!.target_seconds, count * 30);
      assert.ok(s.missions.every((m) => m.reward === reward && m.status === "IN_PROGRESS"));
      await assert.rejects(() =>
        claimMission(uid, { mission_id: s.missions[0].id, calendar_date: s.calendar_date }),
      );
      if (i === 5) viewer = uid;
    }
    const source = (
      await db.query(
        "SELECT v.id FROM cinevjet.video_sources v JOIN cinevjet.movies m ON m.id=v.movie_id WHERE v.is_active AND v.format='MP4' AND m.status='PUBLISHED' AND NOT m.vip_required AND m.type='MOVIE' AND v.episode_id IS NULL LIMIT 1",
      )
    ).rows[0];
    assert.ok(source);
    let session = await startRewardWatch(viewer, { source_id: source.id, position: 0 });
    for (let seconds = 15; seconds <= 30; seconds += 15) {
      now += 15000;
      await clock();
      session = await heartbeatRewardWatch(viewer, {
        ...session,
        position: seconds,
        playing: true,
      });
    }
    const s = await missionsSnapshot(viewer);
    assert.equal(s.missions[0].status, "AVAILABLE");
    assert.equal(s.missions[1].status, "IN_PROGRESS");
    await claimMission(viewer, { mission_id: s.missions[0].id, calendar_date: s.calendar_date });
    assert.equal(
      Number(
        (await db.query("SELECT balance FROM cinevjet.coin_wallets WHERE user_id=$1", [viewer]))
          .rows[0].balance,
      ),
      19333,
    );
    now += 86400000;
    await clock();
    const next = await missionsSnapshot(viewer);
    assert.notEqual(next.calendar_date, s.calendar_date);
    assert.ok(next.missions.every((m) => m.status === "IN_PROGRESS" && m.watched_seconds === 0));
  } finally {
    await db.query("SELECT set_config('cinevjet.test_now','',false)");
  }
});
test.after(() => db.close());
