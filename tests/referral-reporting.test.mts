import { createVipPurchase, approveVipPurchase } from "../src/server/vip-purchases";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle as pgDrizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as liteDrizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import {
  adminReferralPolicy,
  updateReferralPolicy,
  settleReferralCommission,
} from "../src/server/referral-policy";
import {
  financialReport,
  reportingCandidates,
  classifyReportingTransaction,
} from "../src/server/financial-reporting";
import { adminReferralReport } from "../src/server/referral-reporting";
import { referralDashboard } from "../src/server/referrals";
import { commissionAmount, referralPolicyInput } from "../src/domain/referral-policy";
import {
  createPayosOrder,
  receivePayosWebhook,
  reconcilePayosOrder,
} from "../src/server/payos-payments";
import { signData } from "../src/server/payos-client";
import { checkOrigin } from "../src/server/http";
let owner: Pool | undefined, runtime: Pool | undefined, lite: PGlite | undefined;
const role = process.env.REFERRAL_QA_ROLE || "cinevjet_runtime_referrals_20261018";
if (process.env.REFERRAL_TEST_DATABASE_URL) {
  const url = new URL(process.env.REFERRAL_TEST_DATABASE_URL);
  assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
  assert.match(
    url.pathname,
    /^\/(referral_reporting_20261018|financial_reporting_20261018_[a-f0-9]{8})$/,
  );
  assert.ok(
    ["cinevjet_runtime_referrals_20261018", "cinevjet_runtime_finance_20261018"].includes(role),
  );
  assert.equal(process.env.REFERRAL_QA_ROLE, role);
  const options = {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 12,
    statement_timeout: 20000,
  };
  owner = new Pool(options);
  runtime = new Pool({ ...options, options: `-c role=${role}` });
} else {
  lite = new PGlite();
  for (const file of (await readdir("database/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await lite.exec(await readFile("database/migrations/" + file, "utf8"));
  await lite.exec(await readFile("database/seed.sql", "utf8"));
}
const q = async (text: string, params: any[] = []): Promise<{ rows: Record<string, any>[] }> =>
  owner ? owner.query(text, params) : lite!.query(text, params);
const db = runtime ? pgDrizzle(runtime) : (liteDrizzle(lite!) as unknown as NodePgDatabase);
(globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase = db;
const prefix = randomUUID();
async function user(parent: string | null = null, isAdmin = false) {
  const id = randomUUID();
  await q(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name,referred_by) VALUES($1,$2,'unused','Referral QA',$3)",
    [id, id + "@example.invalid", parent],
  );
  await q("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
  await q("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
  if (isAdmin) await q("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [id]);
  return id;
}
const admin = await user(null, true),
  a = await user(),
  b = await user(a),
  c = await user(b),
  d = await user(c),
  regular = await user();
// A prior QA run may have edited policy; this is a fresh audited configuration for this run.
let policy = await adminReferralPolicy(admin);
policy = await updateReferralPolicy(admin, {
  expected_version: policy.version,
  rates_bps: [1000, 200, 100],
  reason: "Isolated QA default policy verification",
  confirmation: "CONFIRM_FUTURE_ORDERS",
});
const originalFetch = globalThis.fetch,
  infos = new Map<number, Record<string, any>>();
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.PAYOS_CLIENT_ID = "test-only-client";
process.env.PAYOS_API_KEY = "test-only-key";
process.env.PAYOS_CHECKSUM_KEY = "test-only-checksum";
process.env.NEXT_PUBLIC_APP_URL = "https://cine-vjet.cyou";
globalThis.fetch = async (input, init) => {
  assert.ok(String(input).startsWith("https://api-merchant.payos.vn/v2/payment-requests"));
  if (init?.method === "POST") {
    const p = JSON.parse(String(init.body)),
      data = {
        id: "qa-" + p.orderCode,
        paymentLinkId: "qa-" + p.orderCode,
        orderCode: p.orderCode,
        amount: p.amount,
        amountPaid: 0,
        amountRemaining: p.amount,
        status: "PENDING",
        currency: "VND",
        accountNumber: "123456789",
        accountName: "ISOLATED QA",
        bin: "970422",
        checkoutUrl: "https://pay.payos.vn/web/qa-" + p.orderCode,
        qrCode: "synthetic-qr",
      };
    infos.set(p.orderCode, data);
    return Response.json({ code: "00", data, signature: signData(data) });
  }
  const data = infos.get(Number(String(input).split("/").at(-1)));
  if (!data) return Response.json({ code: "101", desc: "Mã thanh toán không tồn tại" });
  return Response.json({ code: "00", data, signature: signData(data!) });
};
async function order(buyer = d, plan = "VIP_1") {
  return createPayosOrder(
    buyer,
    { kind: "VIP_PURCHASE", plan_id: plan, idempotency_key: randomUUID() },
    "https://cine-vjet.cyou",
  );
}
function paid(o: { order_code: number; amount: number }) {
  const info = infos.get(o.order_code)!;
  info.status = "PAID";
  info.amountPaid = o.amount;
  info.amountRemaining = 0;
  const data = {
    orderCode: o.order_code,
    amount: o.amount,
    description: "QA VIP",
    accountNumber: "123456789",
    reference: "QA/" + o.order_code,
    paymentLinkId: info.paymentLinkId,
    code: "00",
    currency: "VND",
  };
  return { code: "00", success: true, data, signature: signData(data) };
}
const balances = async () =>
  (
    await q(
      "SELECT user_id,balance::text FROM cinevjet.wallets WHERE user_id=ANY($1::text[]) ORDER BY user_id",
      [[a, b, c]],
    )
  ).rows;
let first: Awaited<ReturnType<typeof order>>;
test("F1/F2/F3 commissions and financial reports", async (t) => {
  await t.test("restricted role identity and least privilege", async () => {
    if (!runtime) return;
    assert.equal((await runtime.query("SELECT current_user name")).rows[0].name, role);
    for (const query of [
      "UPDATE cinevjet.referral_policy_control SET approved_total_bps=10000",
      "UPDATE cinevjet.referral_policy_control SET multilevel_approved=false",
      "DELETE FROM cinevjet.referral_policy_versions",
      "UPDATE cinevjet.wallet_ledger SET amount=amount",
      "DELETE FROM cinevjet.referral_commission_entries",
      "DELETE FROM cinevjet.reporting_classifications",
      `UPDATE cinevjet.users SET referred_by='${a}' WHERE id='${d}'`,
      "CREATE TABLE cinevjet.denied_fixture(id int)",
      "INSERT INTO cinevjet.admin_users(user_id) SELECT id FROM cinevjet.users LIMIT 1",
    ])
      await assert.rejects(runtime.query(query), (e) => (e as { code: string }).code === "42501");
    const f = (
      await runtime.query(
        "SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    assert.ok(Object.values(f).every((v) => v === false));
  });
  await t.test(
    "Admin-only configuration, technical validation and rates above 13/100 percent",
    async () => {
      assert.deepEqual(policy.rates_bps, [1000, 200, 100]);
      await assert.rejects(
        adminReferralPolicy(regular),
        (e) => (e as { status: number }).status === 403,
      );
      await assert.rejects(
        updateReferralPolicy(regular, {}),
        (e) => (e as { status: number }).status === 403,
      );
      const base = {
        expected_version: policy.version,
        rates_bps: [1000, 200, 100],
        reason: "Valid QA policy edit",
        confirmation: "CONFIRM_FUTURE_ORDERS",
      };
      for (const rates_bps of [
        [2147483648, 0, 0],
        [-1, 0, 0],
        [1000.5, 0, 0],
      ])
        assert.equal(referralPolicyInput.safeParse({ ...base, rates_bps }).success, false);
      for (const rates_bps of [
        [2000, 200, 100],
        [1500, 500, 300],
        [2500, 1000, 500],
        [12000, 200, 100],
        [2025, 250, 125],
      ]) {
        policy = await updateReferralPolicy(admin, {
          ...base,
          expected_version: policy.version,
          rates_bps,
        });
        assert.deepEqual(policy.rates_bps, rates_bps);
      }
      policy = await updateReferralPolicy(admin, { ...base, expected_version: policy.version });
      assert.equal(referralPolicyInput.safeParse({ ...base, amount: 1 }).success, false);
      assert.throws(() =>
        checkOrigin(
          new Request("https://cine-vjet.cyou/api/admin/referrals", {
            headers: { Origin: "https://attacker.invalid" },
          }),
        ),
      );
    },
  );
  await t.test("payment creation captures server ancestors and basis points", async () => {
    first = await order();
    const r = (
      await q("SELECT referral_snapshot FROM cinevjet.vip_purchase_requests WHERE id=$1", [
        first.id,
      ])
    ).rows[0].referral_snapshot;
    assert.deepEqual(r.beneficiaries, [c, b, a]);
    assert.deepEqual(r.rates_bps, [1000, 200, 100]);
    await assert.rejects(
      db.transaction((tx) => settleReferralCommission(tx, first.id)),
      (e) => (e as { status: number }).status === 409,
    );
    assert.equal(
      (
        await q("SELECT count(*) n FROM cinevjet.referral_commission_entries WHERE source_id=$1", [
          first.id,
        ])
      ).rows[0].n,
      "0",
    );
  });
  await t.test(
    "policy change freezes pending orders; stale editor rejected; audit retained",
    async () => {
      const previous = policy.version;
      policy = await updateReferralPolicy(admin, {
        expected_version: previous,
        rates_bps: [800, 300, 200],
        reason: "QA version change before payment completion",
        confirmation: "CONFIRM_FUTURE_ORDERS",
      });
      await assert.rejects(
        updateReferralPolicy(admin, {
          expected_version: previous,
          rates_bps: [1000, 200, 100],
          reason: "Stale concurrent configuration editor",
          confirmation: "CONFIRM_FUTURE_ORDERS",
        }),
        (e) => (e as { status: number }).status === 409,
      );
      const row = (
        await q(
          "SELECT previous_id,created_by FROM cinevjet.referral_policy_versions WHERE id=$1",
          [policy.version],
        )
      ).rows[0];
      assert.equal(row.previous_id, previous);
      assert.equal(row.created_by, admin);
    },
  );
  await t.test(
    "D buys 150000: C 15000, B 3000, A 1500; signed webhook replay/concurrent reconcile exactly once",
    async () => {
      const before = await balances(),
        w = paid(first);
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          i % 2 ? receivePayosWebhook(w) : reconcilePayosOrder(first.id, d, true),
        ),
      );
      const entries = (
        await q(
          "SELECT beneficiary_id,level,bps,amount::text FROM cinevjet.referral_commission_entries WHERE source_id=$1 ORDER BY level",
          [first.id],
        )
      ).rows;
      assert.deepEqual(
        entries.map((r) => [r.beneficiary_id, r.level, r.bps, Number(r.amount)]),
        [
          [c, 1, 1000, 15000],
          [b, 2, 200, 3000],
          [a, 3, 100, 1500],
        ],
      );
      const after = await balances();
      for (let i = 0; i < after.length; i++)
        assert.equal(
          Number(after[i].balance) - Number(before[i].balance),
          { [c]: 15000, [b]: 3000, [a]: 1500 }[after[i].user_id],
        );
      assert.equal(
        (
          await q(
            "SELECT count(*) n FROM cinevjet.wallet_ledger l JOIN cinevjet.referral_commission_entries c ON c.id=l.reference_id WHERE l.reference_type='REFERRAL_V2' AND c.source_id=$1",
            [first.id],
          )
        ).rows[0].n,
        "3",
      );
      await receivePayosWebhook(w);
      assert.deepEqual(await balances(), after);
    },
  );
  await t.test(
    "future purchase uses new rates; a buyer can generate another valid event without legacy UNIQUE restriction",
    async () => {
      const second = await order(d, "VIP_2");
      await receivePayosWebhook(paid(second));
      const amounts = (
        await q(
          "SELECT amount::text FROM cinevjet.referral_commission_entries WHERE source_id=$1 ORDER BY level",
          [second.id],
        )
      ).rows.map((r) => Number(r.amount));
      assert.deepEqual(amounts, [24000, 9000, 6000]);
      assert.equal(
        (
          await q("SELECT count(*) n FROM cinevjet.referral_commission_entries WHERE buyer_id=$1", [
            d,
          ])
        ).rows[0].n,
        "6",
      );
    },
  );
  await t.test(
    "missing ancestors pay only existing distance; no referral makes no commission",
    async () => {
      const one = await user(a),
        o = await order(one);
      await receivePayosWebhook(paid(o));
      const rows = (
        await q(
          "SELECT beneficiary_id,level,bps FROM cinevjet.referral_commission_entries WHERE source_id=$1",
          [o.id],
        )
      ).rows;
      assert.deepEqual(rows, [{ beneficiary_id: a, level: 1, bps: 800 }]);
      const orphan = await user(),
        no = await order(orphan);
      await receivePayosWebhook(paid(no));
      assert.equal(
        (
          await q(
            "SELECT count(*) n FROM cinevjet.referral_commission_entries WHERE source_id=$1",
            [no.id],
          )
        ).rows[0].n,
        "0",
      );
    },
  );
  await t.test("failed provider confirmation never credits commissions", async () => {
    const buyer = await user(c),
      o = await order(buyer),
      before = await balances(),
      w = paid(o);
    infos.get(o.order_code)!.status = "CANCELLED";
    await assert.rejects(receivePayosWebhook(w));
    assert.deepEqual(await balances(), before);
  });
  await t.test(
    "database refuses self-referral, parent changes and circular referrals",
    async () => {
      await assert.rejects(q("UPDATE cinevjet.users SET referred_by=id WHERE id=$1", [a]));
      await assert.rejects(q("UPDATE cinevjet.users SET referred_by=$1 WHERE id=$2", [d, a]));
      await assert.rejects(
        q("UPDATE cinevjet.vip_purchase_requests SET referral_snapshot=$1::jsonb WHERE id=$2", [
          JSON.stringify({}),
          first.id,
        ]),
      );
    },
  );
  await t.test(
    "integer rounding has no floating-point drift, including safe integer maximum",
    () => {
      assert.equal(commissionAmount(150000, 1000), 15000);
      assert.equal(commissionAmount(150001, 200), 3000);
      assert.equal(commissionAmount(999, 1), 0);
      assert.equal(commissionAmount(Number.MAX_SAFE_INTEGER, 10000), Number.MAX_SAFE_INTEGER);
    },
  );
  await t.test("network distances, earned amounts and ledger-backed history are real", async () => {
    const userReport = await referralDashboard(a);
    assert.deepEqual(userReport.policy.percentages, [8, 3, 2]);
    assert.ok(
      userReport.stats.level1 >= 1 && userReport.stats.level2 >= 1 && userReport.stats.level3 >= 1,
    );
    assert.ok(userReport.credited.f3 >= 7500);
    const r = await adminReferralReport(admin);
    assert.equal(r.stats.ledger_mismatches, 0);
    assert.equal(r.stats.total, r.stats.level1 + r.stats.level2 + r.stats.level3);
    assert.equal(r.stats.network, r.stats.direct);
    assert.ok(r.history.some((h) => h.source_id === first.id && h.bps === 1000));
  });
  await t.test(
    "manual bank approval uses the same three-level settlement transaction",
    async () => {
      await q(
        "UPDATE cinevjet.system_settings SET bank_name='QA BANK',account_number='123456789',account_name='ISOLATED QA',deposit_enabled=true WHERE id='default'",
      );
      const buyer = await user(c),
        old = process.env.PAYOS_API_KEY;
      delete process.env.PAYOS_API_KEY;
      let request: Awaited<ReturnType<typeof createVipPurchase>>;
      try {
        request = await createVipPurchase(buyer, {
          plan_id: "VIP_1",
          idempotency_key: randomUUID(),
        });
      } finally {
        process.env.PAYOS_API_KEY = old;
      }
      await approveVipPurchase(admin, request!.id, {
        action: "APPROVE",
        confirmed: true,
        evidence_reference: "QA-" + request!.id,
      });
      assert.deepEqual(
        (
          await q(
            "SELECT amount::text FROM cinevjet.referral_commission_entries WHERE source_id=$1 ORDER BY level",
            [request!.id],
          )
        ).rows.map((r) => Number(r.amount)),
        [12000, 4500, 3000],
      );
      const before = await balances();
      await assert.rejects(
        approveVipPurchase(admin, request!.id, {
          action: "APPROVE",
          confirmed: true,
          evidence_reference: "QA-" + request!.id,
        }),
        (e) => (e as { status: number }).status === 409,
      );
      assert.deepEqual(await balances(), before);
    },
  );
  await t.test(
    "legacy application orders keep NULL snapshot and old unique-history rules",
    async () => {
      const buyer = await user(a),
        id = randomUUID();
      await q(
        "INSERT INTO cinevjet.vip_purchase_requests(id,user_id,plan_id,plan_name,amount,duration_days,reward_tier,reward_schedule,benefits_json,bank_name,bank_account_number,bank_account_name,idempotency_key,provider) SELECT $1,$2,id,name,price,duration_days,reward_tier,checkin_rewards,benefits_json,'QA BANK','123456789','ISOLATED QA',$1,'MANUAL_BANK' FROM cinevjet.vip_plans WHERE id='VIP_1'",
        [id, buyer],
      );
      assert.equal(
        (await q("SELECT referral_snapshot FROM cinevjet.vip_purchase_requests WHERE id=$1", [id]))
          .rows[0].referral_snapshot,
        null,
      );
      await approveVipPurchase(admin, id, {
        action: "APPROVE",
        confirmed: true,
        evidence_reference: "QA-LEGACY-" + id,
      });
      assert.equal(
        (await q("SELECT amount::text FROM cinevjet.referral_commissions WHERE source_id=$1", [id]))
          .rows[0].amount,
        "15000",
      );
      assert.equal(
        (
          await q(
            "SELECT count(*) n FROM cinevjet.referral_commission_entries WHERE source_id=$1",
            [id],
          )
        ).rows[0].n,
        "0",
      );
      assert.ok(
        (
          await q(
            "SELECT 1 FROM pg_constraint WHERE conrelid='cinevjet.referral_commissions'::regclass AND pg_get_constraintdef(oid)='UNIQUE (referred_user_id)' ",
          )
        ).rows.length,
      );
    },
  );
  await t.test("withdrawal VND and Coin redemption split gross, fees and paid net", async () => {
    const before = await financialReport(admin);
    for (const asset of ["VND", "COIN"])
      await q(
        "INSERT INTO cinevjet.withdrawals(id,user_id,amount,fee,destination,status,idempotency_key,source_asset,coins_amount,coin_value_vnd,completed_at) VALUES($1,$2,50000,2000,'ISOLATED QA','COMPLETED',$1,$3,$4,$5,now())",
        [
          randomUUID(),
          regular,
          asset,
          asset === "COIN" ? 50000 : null,
          asset === "COIN" ? 1 : null,
        ],
      );
    const after = await financialReport(admin);
    assert.equal(after.totals.outgoing - before.totals.outgoing, 96000);
    assert.equal(after.totals.gross - before.totals.gross, 100000);
    assert.equal(after.totals.fees - before.totals.fees, 4000);
    assert.equal(after.totals.withdrawal_vnd - before.totals.withdrawal_vnd, 48000);
    assert.equal(after.totals.redemptions - before.totals.redemptions, 48000);
  });
  await t.test(
    "period KPI, daily/monthly use same paid source; no event-row duplication",
    async () => {
      await q(
        "INSERT INTO cinevjet.payment_events(id,order_id,source,event_key,state) VALUES($1,$2,'WEBHOOK',$3,'PAID'),($4,$2,'RECONCILIATION',$5,'PAID')",
        [randomUUID(), first.id, randomUUID(), randomUUID(), randomUUID()],
      );
      const f = await financialReport(admin),
        daily = f.chart.reduce((a, r) => a + r.income, 0),
        monthly = f.monthlyChart.reduce((a, r) => a + r.income, 0);
      assert.equal(daily, f.totals.income);
      assert.equal(monthly, f.totals.income);
      assert.equal(f.periods.find((p) => p.period === "TODAY")!.income, f.chart.at(-1)!.income);
      assert.equal(f.totals.income, f.totals.deposits + f.totals.vip);
      assert.equal(f.totals.outgoing, f.totals.gross - f.totals.fees);
    },
  );
  await t.test(
    "pending and missing completion timestamps excluded; VN midnight classified by completion",
    async () => {
      const before = await financialReport(admin),
        today = (await q("SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day"))
          .rows[0].day;
      for (const [key, status, time, amount] of [
        [
          "prior",
          "COMPLETED",
          new Date(Date.parse(today + "T00:00:00+07:00") - 1).toISOString(),
          51000,
        ],
        ["today", "COMPLETED", today + "T00:00:00+07:00", 57000],
        ["pending", "PENDING", null, 63000],
        ["missing", "COMPLETED", null, 69000],
      ])
        await q(
          "INSERT INTO cinevjet.deposits(id,user_id,amount,provider,status,idempotency_key,completed_at) VALUES($1,$2,$3,'MANUAL_BANK',$4,$1,$5)",
          [prefix + key, regular, amount, status, time],
        );
      const after = await financialReport(admin);
      assert.equal(after.totals.income - before.totals.income, 108000);
      assert.equal(
        after.periods.find((p) => p.period === "TODAY")!.income -
          before.periods.find((p) => p.period === "TODAY")!.income,
        57000,
      );
      assert.equal(after.quality.unverified - before.quality.unverified, 1);
    },
  );
  await t.test(
    "business report excludes only explicit confirmation, reversible audit, no financial mutations",
    async () => {
      const candidates = await reportingCandidates(admin),
        row = candidates.find((r) => r.id === first.id)!;
      assert.ok(row);
      assert.equal(row.excluded, false);
      const before = await financialReport(admin),
        cash = await balances(),
        ledger = (await q("SELECT count(*) n FROM cinevjet.wallet_ledger")).rows[0].n;
      const payload = {
        target_kind: row.kind,
        target_id: row.id,
        fingerprint: row.fingerprint,
        expected_revision: row.revision,
        excluded: true,
        reason: "Confirmed isolated synthetic QA order, report only",
        confirmation: "CONFIRM_REPORT_ONLY",
      };
      await assert.rejects(
        classifyReportingTransaction(regular, payload),
        (e) => (e as { status: number }).status === 403,
      );
      await assert.rejects(
        classifyReportingTransaction(admin, { ...payload, confirmation: undefined }),
      );
      await assert.rejects(
        classifyReportingTransaction(admin, { ...payload, fingerprint: "0".repeat(64) }),
        (e) => (e as { status: number }).status === 409,
      );
      await classifyReportingTransaction(admin, payload);
      const all = await financialReport(admin),
        business = await financialReport(admin, { mode: "BUSINESS" });
      assert.equal(all.totals.income, before.totals.income);
      assert.equal(all.totals.income - business.totals.income, 150000);
      const ar = await adminReferralReport(admin),
        br = await adminReferralReport(admin, { mode: "BUSINESS" });
      assert.equal(ar.stats.total - br.stats.total, 19500);
      const revision = (await reportingCandidates(admin)).find((r) => r.id === first.id)!.revision;
      await classifyReportingTransaction(admin, {
        ...payload,
        expected_revision: revision,
        excluded: false,
        reason: "Restore confirmed synthetic QA transaction to reporting",
      });
      assert.equal(
        (await financialReport(admin, { mode: "BUSINESS" })).totals.income,
        before.totals.income,
      );
      assert.deepEqual(await balances(), cash);
      assert.equal((await q("SELECT count(*) n FROM cinevjet.wallet_ledger")).rows[0].n, ledger);
      assert.equal(
        (await q("SELECT status FROM cinevjet.vip_purchase_requests WHERE id=$1", [first.id]))
          .rows[0].status,
        "COMPLETED",
      );
    },
  );
});
test.after(async () => {
  globalThis.fetch = originalFetch;
  await runtime?.end();
  await owner?.end();
  await lite?.close();
});
