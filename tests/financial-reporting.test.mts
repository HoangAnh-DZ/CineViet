import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  financialReport,
  reportingCandidates,
  classifyReportingTransaction,
  financialReportRevision,
} from "../src/server/financial-reporting";
import { dashboardOverview, moneyTransactions } from "../src/server/dashboard";
import { createVipPurchase, approveVipPurchase } from "../src/server/vip-purchases";
const url = new URL(process.env.REFERRAL_TEST_DATABASE_URL!);
assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
assert.match(url.pathname, /^\/financial_reporting_20261018(?:_[a-f0-9]{8})?$/);
const role = "cinevjet_runtime_finance_20261018";
assert.equal(process.env.REFERRAL_QA_ROLE, role);
const options = {
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 8,
  statement_timeout: 20000,
};
const owner = new Pool({ ...options, max: 1 }),
  runtime = new Pool({ ...options, options: `-c role=${role}` });
(
  globalThis as typeof globalThis & { cinevjetDatabase: ReturnType<typeof drizzle> }
).cinevjetDatabase = drizzle(runtime);
const q = owner.query.bind(owner);
await q(
  "UPDATE cinevjet.system_settings SET bank_name='QA BANK',account_number='123456789',account_name='ISOLATED QA',deposit_enabled=true WHERE id='default'",
);
async function user(admin = false, created?: string) {
  const id = randomUUID();
  await q(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name,created_at) VALUES($1,$2,'unused','Finance QA',COALESCE($3::timestamptz,now()))",
    [id, id + "@example.invalid", created || null],
  );
  await q("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
  await q("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
  if (admin) await q("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [id]);
  return id;
}
const admin = await user(true),
  buyer = await user(),
  otherAdmin = await user(true);
async function deposit(
  amount: number,
  status = "COMPLETED",
  time?: string,
  ledger = true,
  provider = "MANUAL_BANK",
) {
  const id = randomUUID(),
    at = time || (await q("SELECT now() t")).rows[0].t.toISOString();
  await q("BEGIN");
  try {
    await q(
      "INSERT INTO cinevjet.deposits(id,user_id,amount,provider,status,idempotency_key,completed_at) VALUES($1,$2,$3,$4,$5,$1,$6)",
      [id, buyer, amount, provider, status, status === "COMPLETED" ? at : null],
    );
    if (status === "COMPLETED" && ledger) {
      await q("UPDATE cinevjet.wallets SET balance=balance+$1 WHERE user_id=$2", [amount, buyer]);
      await q(
        "INSERT INTO cinevjet.wallet_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES($1,$2,$3,'DEPOSIT','DEPOSIT',$4)",
        [randomUUID(), buyer, amount, id],
      );
    }
    await q("COMMIT");
    return id;
  } catch (e) {
    await q("ROLLBACK");
    throw e;
  }
}
async function withdrawal(
  asset: "VND" | "COIN",
  amount: number,
  fee: number,
  status = "COMPLETED",
) {
  const id = randomUUID();
  await q("BEGIN");
  try {
    await q(
      "INSERT INTO cinevjet.withdrawals(id,user_id,amount,fee,destination,status,idempotency_key,source_asset,coins_amount,coin_value_vnd,completed_at) VALUES($1,$2,$3,$4,'QA BANK',$5,$1,$6,$7,$8,CASE WHEN $5='COMPLETED' THEN now() ELSE NULL END)",
      [
        id,
        buyer,
        amount,
        fee,
        status,
        asset,
        asset === "COIN" ? amount : null,
        asset === "COIN" ? 1 : null,
      ],
    );
    if (status === "COMPLETED") {
      const table = asset === "VND" ? "wallets" : "coin_wallets",
        ledger = asset === "VND" ? "wallet_ledger" : "coin_ledger",
        reference = asset === "VND" ? "WITHDRAWAL" : "REDEMPTION";
      await q(`UPDATE cinevjet.${table} SET balance=balance-$1 WHERE user_id=$2`, [amount, buyer]);
      await q(
        `INSERT INTO cinevjet.${ledger}(id,user_id,amount,type,reference_type,reference_id) VALUES($1,$2,$3,$4,$4,$5)`,
        [randomUUID(), buyer, -amount, reference, id],
      );
    }
    await q("COMMIT");
    return id;
  } catch (e) {
    await q("ROLLBACK");
    throw e;
  }
}
const candidate = async (id: string) =>
  (await reportingCandidates(admin)).find((r) => r.id === id)!;
async function payload(id: string, excluded = true) {
  const row = await candidate(id);
  return {
    target_kind: row.kind,
    target_id: id,
    fingerprint: row.fingerprint,
    expected_revision: row.revision,
    excluded,
    reason: "Verified synthetic isolated QA financial fixture",
    confirmation: "CONFIRM_REPORT_ONLY",
  };
}
const state = async () =>
  (
    await q(
      "SELECT (SELECT jsonb_agg(x ORDER BY user_id) FROM(SELECT user_id,balance,reserved FROM cinevjet.wallets) x) wallets,(SELECT jsonb_agg(x ORDER BY user_id) FROM(SELECT user_id,balance,reserved FROM cinevjet.coin_wallets) x) coins,(SELECT count(*)::text FROM cinevjet.wallet_ledger) wallet_ledger,(SELECT count(*)::text FROM cinevjet.coin_ledger) coin_ledger,(SELECT count(*)::text FROM cinevjet.vip_subscriptions) subscriptions",
    )
  ).rows[0];
let mainDeposit: string, vipId: string;
test("Financial reporting fixtures through the restricted PostgreSQL role", async (t) => {
  await t.test(
    "runtime role is actually used; empty reports and periods contain genuine zeros",
    async () => {
      assert.equal((await runtime.query("SELECT current_user name")).rows[0].name, role);
      const f = await financialReport(admin);
      assert.equal(f.totals.income, 0);
      assert.equal(f.totals.outgoing, 0);
      assert.equal(f.chart.length, 30);
      assert.equal(f.monthlyChart.length, 12);
      assert.ok(f.periods.every((p) => p.income === 0 && p.outgoing === 0));
    },
  );
  await t.test("pending, failed and rejected requests do not become completed cash", async () => {
    await deposit(100000, "PENDING");
    await deposit(100000, "FAILED");
    const f = await financialReport(admin);
    assert.equal(f.totals.income, 0);
    assert.equal(f.totals.outgoing, 0);
  });
  await t.test("completed deposit credits cash only once and leaves matching ledger", async () => {
    mainDeposit = await deposit(200000);
    const f = await financialReport(admin);
    assert.equal(f.totals.income, 200000);
    assert.equal(f.quality.ledger_mismatches, 0);
    assert.equal((await candidate(mainDeposit)).classification, "UNKNOWN");
  });
  await t.test("provider event replay does not multiply a payOS deposit", async () => {
    const id = await deposit(50000, "COMPLETED", undefined, true, "PAYOS"),
      order = randomUUID();
    await q(
      "INSERT INTO cinevjet.payos_orders(id,user_id,kind,deposit_id,amount,idempotency_key,status,payment_link_id,return_url,cancel_url,expires_at,settled_at) VALUES($1,$2,'DEPOSIT',$3,50000,$1,'PAID',$1,'https://example.invalid/return','https://example.invalid/cancel',now()+interval '1 hour',now())",
      [order, buyer, id],
    );
    for (let i = 0; i < 4; i++)
      await q(
        "INSERT INTO cinevjet.payment_events(id,order_id,source,event_key,state) VALUES($1,$2,'WEBHOOK',$1,'PAID')",
        [randomUUID(), order],
      );
    assert.equal((await financialReport(admin)).totals.income, 250000);
    assert.ok((await moneyTransactions(admin)).some((r) => r.id === id && r.order_code));
  });
  await t.test("direct paid VIP is distinct from deposited wallet money", async () => {
    const r = await createVipPurchase(buyer, { plan_id: "VIP_1", idempotency_key: randomUUID() });
    vipId = r.id;
    await approveVipPurchase(admin, r.id, {
      action: "APPROVE",
      confirmed: true,
      evidence_reference: "QA-" + r.id,
    });
    const f = await financialReport(admin);
    assert.equal(f.totals.deposits, 250000);
    assert.equal(f.totals.vip, 150000);
    assert.equal(f.totals.income, 400000);
    assert.equal(f.quality.ledger_mismatches, 0);
  });
  await t.test("internal wallet debit is not counted as a second bank receipt", async () => {
    const before = await financialReport(admin);
    await q("UPDATE cinevjet.wallets SET balance=balance-50000 WHERE user_id=$1", [buyer]);
    await q(
      "INSERT INTO cinevjet.wallet_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES($1,$2,-50000,'VIP_PURCHASE','WALLET_PURCHASE',$1)",
      [randomUUID(), buyer],
    );
    assert.equal((await financialReport(admin)).totals.income, before.totals.income);
  });
  await t.test(
    "completed VND withdrawal and Coin redemption split gross, fees and cash paid",
    async () => {
      await q("UPDATE cinevjet.coin_wallets SET balance=100000 WHERE user_id=$1", [buyer]);
      await q(
        "INSERT INTO cinevjet.coin_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES($1,$2,100000,'TEST','TEST',$1)",
        [randomUUID(), buyer],
      );
      await withdrawal("VND", 70000, 2800);
      await withdrawal("COIN", 35000, 1400);
      await withdrawal("COIN", 35000, 1400, "PENDING");
      await q("UPDATE cinevjet.coin_wallets SET reserved=35000 WHERE user_id=$1", [buyer]);
      const f = await financialReport(admin);
      assert.equal(f.totals.gross, 105000);
      assert.equal(f.totals.fees, 4200);
      assert.equal(f.totals.outgoing, 100800);
      assert.equal(f.totals.withdrawal_vnd, 67200);
      assert.equal(f.totals.redemptions, 33600);
      assert.equal(f.totals.profit, 299200);
      assert.equal(f.quality.ledger_mismatches, 0);
    },
  );
  await t.test(
    "unapproved test candidates stay in business; tables, KPI and charts use the same mode",
    async () => {
      const all = await dashboardOverview(admin, "ALL", true),
        business = await dashboardOverview(admin, "BUSINESS", true);
      assert.equal(all.metrics.income, business.metrics.income);
      assert.deepEqual(all.chart, business.chart);
      assert.deepEqual(
        all.transactions.map((t) => t.id),
        business.transactions.map((t) => t.id),
      );
    },
  );
  await t.test("confirmed exclusion is audited, idempotent and source-specific", async () => {
    const before = await state(),
      p = await payload(mainDeposit);
    await classifyReportingTransaction(admin, p);
    await classifyReportingTransaction(admin, p);
    assert.equal(
      (
        await q(
          "SELECT count(*)::int n FROM cinevjet.reporting_classifications WHERE target_id=$1",
          [mainDeposit],
        )
      ).rows[0].n,
      1,
    );
    const all = await dashboardOverview(admin, "ALL", true),
      business = await dashboardOverview(admin, "BUSINESS", true);
    assert.equal(all.metrics.income - business.metrics.income, 200000);
    assert.ok(
      all.transactions.some((r) => r.id === mainDeposit && r.reporting_classification === "TEST"),
    );
    assert.ok(!business.transactions.some((r) => r.id === mainDeposit));
    assert.ok(business.transactions.some((r) => r.id === vipId));
    assert.equal(
      business.chart.reduce((s, r) => s + r.income, 0),
      business.metrics.income,
    );
    assert.deepEqual(await state(), before);
  });
  await t.test(
    "restoration records an audit link and restores cash without financial mutations",
    async () => {
      const before = await state();
      await classifyReportingTransaction(admin, await payload(mainDeposit, false));
      assert.equal((await candidate(mainDeposit)).classification, "REAL");
      const rows = (
        await q(
          "SELECT id,previous_id,excluded,confirmed_by,reason FROM cinevjet.reporting_classifications WHERE target_id=$1 ORDER BY confirmed_at",
          [mainDeposit],
        )
      ).rows;
      assert.equal(rows.length, 2);
      assert.equal(rows[1].previous_id, rows[0].id);
      assert.equal(rows[1].confirmed_by, admin);
      assert.equal(rows[1].excluded, false);
      assert.equal((await financialReport(admin, { mode: "BUSINESS" })).totals.income, 400000);
      assert.deepEqual(await state(), before);
    },
  );
  await t.test(
    "concurrent contradictory classifications cannot overwrite a stale confirmation",
    async () => {
      const id = await deposit(50000, "PENDING"),
        p = await payload(id),
        before = await state();
      const results = await Promise.allSettled([
        classifyReportingTransaction(admin, p),
        classifyReportingTransaction(otherAdmin, { ...p, excluded: false }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        results.filter(
          (r) => r.status === "rejected" && (r.reason as { status: number }).status === 409,
        ).length,
        1,
      );
      assert.equal(
        (
          await q(
            "SELECT count(*)::int n FROM cinevjet.reporting_classifications WHERE target_id=$1",
            [id],
          )
        ).rows[0].n,
        1,
      );
      assert.deepEqual(await state(), before);
    },
  );
  await t.test(
    "user cannot classify a known real transaction or inject extra authority",
    async () => {
      const before = await state(),
        p = await payload(mainDeposit);
      await assert.rejects(
        classifyReportingTransaction(buyer, p),
        (e) => (e as { status: number }).status === 403,
      );
      await assert.rejects(classifyReportingTransaction(admin, { ...p, role: "ADMIN" }));
      await assert.rejects(classifyReportingTransaction(admin, { ...p, confirmation: undefined }));
      assert.equal((await candidate(mainDeposit)).classification, "REAL");
      assert.deepEqual(await state(), before);
    },
  );
  await t.test("source changes invalidate the confirmation fingerprint", async () => {
    const id = await deposit(100000, "PENDING"),
      p = await payload(id);
    await q("UPDATE cinevjet.deposits SET status='FAILED',updated_at=now() WHERE id=$1", [id]);
    await assert.rejects(
      classifyReportingTransaction(admin, p),
      (e) => (e as { status: number }).status === 409,
    );
    assert.equal((await candidate(id)).classification, "UNKNOWN");
  });
  await t.test(
    "23:59 and 00:00 use Vietnam completion dates rather than request creation",
    async () => {
      const start = (
          await q(
            "SELECT ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') t",
          )
        ).rows[0].t,
        baseline = await financialReport(admin);
      await deposit(60000, "COMPLETED", new Date(start.getTime() - 1).toISOString());
      await deposit(90000, "COMPLETED", start.toISOString());
      const f = await financialReport(admin);
      assert.equal(f.totals.income - baseline.totals.income, 150000);
      assert.equal(
        f.periods.find((p) => p.period === "TODAY")!.income -
          baseline.periods.find((p) => p.period === "TODAY")!.income,
        90000,
      );
      assert.equal(f.chart.at(-1)!.income, f.periods.find((p) => p.period === "TODAY")!.income);
    },
  );
  await t.test(
    "month boundary and user counts reconcile with daily and monthly buckets",
    async () => {
      const start = (
          await q(
            "SELECT (date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh') t",
          )
        ).rows[0].t,
        baseline = await financialReport(admin);
      await deposit(50000, "COMPLETED", new Date(start.getTime() - 1).toISOString());
      await deposit(80000, "COMPLETED", start.toISOString());
      await user(false, new Date(start.getTime() - 1).toISOString());
      await user();
      const f = await financialReport(admin),
        month = f.periods.find((p) => p.period === "MONTH")!,
        key = (await q("SELECT to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM') k")).rows[0]
          .k;
      assert.equal(
        month.income - baseline.periods.find((p) => p.period === "MONTH")!.income,
        80000,
      );
      assert.equal(f.monthlyChart.find((r) => r.day === key)!.income, month.income);
      assert.equal(f.users - baseline.users, 2);
      assert.equal(
        month.new_users - baseline.periods.find((p) => p.period === "MONTH")!.new_users,
        1,
      );
      assert.equal(
        f.periods.find((p) => p.period === "WEEK")!.income,
        f.chart.slice(-7).reduce((s, r) => s + r.income, 0),
      );
    },
  );
  await t.test(
    "ledger gaps are visible reconciliation errors, not silently reset cash",
    async () => {
      const before = await financialReport(admin);
      await deposit(70000, "COMPLETED", undefined, false);
      const f = await financialReport(admin);
      assert.equal(f.quality.ledger_mismatches - before.quality.ledger_mismatches, 1);
      assert.equal(f.totals.income - before.totals.income, 70000);
    },
  );
  await t.test(
    "revision stays stable on reads and changes on actual requests or classification",
    async () => {
      const first = await financialReportRevision(admin);
      await financialReport(admin);
      assert.equal(await financialReportRevision(admin), first);
      const id = await deposit(50000, "PENDING");
      const second = await financialReportRevision(admin);
      assert.notEqual(second, first);
      await classifyReportingTransaction(admin, await payload(id));
      assert.notEqual(await financialReportRevision(admin), second);
    },
  );
});
test.after(async () => {
  await runtime.end();
  await owner.end();
});
