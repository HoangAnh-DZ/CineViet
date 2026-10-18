import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as liteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pgConfig } from "../scripts/pg-config.mjs";
import {
  createPayosOrder,
  receivePayosWebhook,
  reconcilePayosOrder,
  reconcilePendingPayments,
  pendingVipPayment,
  paymentPresentation,
  storedPayosOrder,
} from "../src/server/payos-payments";
import { signData, verifySignature } from "../src/server/payos-client";
import {
  createWithdrawalRequest,
  completeWithdrawal,
  approveDepositRequest,
  userMoneyRequests,
} from "../src/server/manual-money";
import { createVipPurchase, approveVipPurchase } from "../src/server/vip-purchases";
import {
  claimPayout,
  runPayoutWorker,
  setQueueControl,
  queueAction,
  settlePayout,
} from "../src/server/withdrawal-queue";
import {
  autoPayoutEnabled,
  payoutCanonical,
  PayoutError,
  type PayoutJob,
  type PayoutInfo,
} from "../src/server/payos-payout";
import { checkOrigin } from "../src/server/http";
import { GET as workerGet, POST as workerPost } from "../src/app/api/internal/finance-worker/route";

let pg: PGlite | undefined, pool: Pool | undefined, runtimePool: Pool | undefined;
process.env.BANK_ACCOUNT_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
const qaHost = process.env.PAYOS_SECURITY_DATABASE_URL
  ? "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech"
  : process.env.PAYOS_QA_HOST;
if (qaHost) {
  assert.equal(
    qaHost,
    "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech",
    "Only the isolated QA branch is allowed",
  );
  const url = new URL(process.env.PAYOS_SECURITY_DATABASE_URL || process.env.DATABASE_URL!);
  if (process.env.PAYOS_SECURITY_DATABASE_URL) {
    assert.equal(url.hostname, qaHost);
    assert.equal(url.pathname, "/security_payos_20261018");
  } else assert.notEqual(url.hostname, qaHost);
  url.hostname = qaHost;
  process.env.DATABASE_URL = url.toString();
  pool = new Pool({ ...pgConfig(), max: 12 });
  if (process.env.PAYOS_SECURITY_RUNTIME_ROLE) {
    assert.ok(
      ["cinevjet_runtime_security_20261018", "cinevjet_runtime_review_20261018"].includes(
        process.env.PAYOS_SECURITY_RUNTIME_ROLE,
      ),
    );
    runtimePool = new Pool({
      ...pgConfig(),
      max: 12,
      options: `-c role=${process.env.PAYOS_SECURITY_RUNTIME_ROLE}`,
    });
  }
  (globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase =
    pgDrizzle(runtimePool || pool);
} else {
  pg = new PGlite();
  for (const file of (await readdir("database/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await pg.exec(await readFile("database/migrations/" + file, "utf8"));
  await pg.exec(await readFile("database/seed.sql", "utf8"));
  (globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase =
    liteDrizzle(pg) as unknown as NodePgDatabase;
}
async function query(text: string, params: unknown[] = []) {
  return pool ? pool.query(text, params) : pg!.query(text, params);
}
const originalFetch = globalThis.fetch;
process.env.PAYOS_CLIENT_ID = "test-only-client";
process.env.PAYOS_API_KEY = "test-only-api";
process.env.PAYOS_CHECKSUM_KEY = "test-only-checksum";
process.env.NEXT_PUBLIC_APP_URL = "https://cinevjet-hoanganh-dz.vercel.app";
const alternateOrigin = "https://www.cine-vjet.cyou";
process.env.VERCEL = "1";
process.env.CINEVJET_PRODUCTION_ORIGINS = JSON.stringify([
  process.env.NEXT_PUBLIC_APP_URL,
  alternateOrigin,
]);
const callbacks = new Map<number, { returnUrl: string; cancelUrl: string }>();
const infos = new Map<number, Record<string, unknown>>();
let creates = 0,
  providerRequests = 0,
  failCreateOnce = false,
  failBeforeCreate = false,
  lookupErrorOnce = false,
  delayLookupAfterCreate = false,
  failLookupCode = 0;
globalThis.fetch = async (input, init) => {
  providerRequests++;
  const url = String(input);
  if (url.includes("api.vietqr.io"))
    return Response.json({
      code: "00",
      data: [{ bin: "970422", shortName: "MB", name: "MB Bank", transferSupported: 1 }],
    });
  assert.ok(url.startsWith("https://api-merchant.payos.vn/v2/payment-requests"));
  if (init?.method === "POST") {
    const p = JSON.parse(String(init.body));
    verifySignature(
      {
        amount: p.amount,
        cancelUrl: p.cancelUrl,
        description: p.description,
        orderCode: p.orderCode,
        returnUrl: p.returnUrl,
      },
      p.signature,
    );
    assert.ok(p.description.length <= 9);
    assert.ok(p.expiredAt < 2147483647);
    callbacks.set(p.orderCode, { returnUrl: p.returnUrl, cancelUrl: p.cancelUrl });
    creates++;
    if (failBeforeCreate) {
      failBeforeCreate = false;
      throw new Error("Not accepted");
    }
    const data = {
      id: "link-" + p.orderCode,
      orderCode: p.orderCode,
      amount: p.amount,
      amountPaid: 0,
      amountRemaining: p.amount,
      status: "PENDING",
      currency: "VND",
      accountNumber: "123456789",
      accountName: "TEST",
      bin: "970422",
    };
    infos.set(p.orderCode, data);
    if (delayLookupAfterCreate) failLookupCode = p.orderCode;
    if (failCreateOnce) {
      failCreateOnce = false;
      throw new Error("Timeout after accepted");
    }
    const created = {
      ...data,
      paymentLinkId: data.id,
      checkoutUrl: "https://pay.payos.vn/web/" + data.id,
      qrCode: "test-only-qr",
    };
    return Response.json({ code: "00", data: created, signature: signData(created) });
  }
  const code = Number(url.split("/").at(-1)),
    data = infos.get(code);
  if (lookupErrorOnce) {
    lookupErrorOnce = false;
    return Response.json({ code: "101", desc: "Unknown provider failure" });
  }
  if (code === failLookupCode) throw new Error("Provider lookup unavailable");
  if (!data)
    return Response.json({ code: "101", desc: "Mã thanh toán không tồn tại" }, { status: 200 });
  return Response.json({ code: "00", data, signature: signData(data) });
};
const suffix = randomUUID(),
  user = "payos-qa-" + suffix,
  other = user + "-other",
  admin = user + "-admin";
for (const [id, cash] of [
  [user, 0],
  [other, 1000000],
  [admin, 0],
] as const) {
  await query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,'unused','Payment test')",
    [id, id + "@example.test"],
  );
  await query("INSERT INTO cinevjet.wallets(user_id,balance) VALUES($1,$2)", [id, cash]);
  await query("INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES($1,777)", [id]);
}
await query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [admin]);
const plan = (
  await query(
    "SELECT id,price,name,duration_days FROM cinevjet.vip_plans WHERE active AND purchase_enabled AND mission_count>0 ORDER BY price LIMIT 1",
  )
).rows[0] as { id: string; price: number };
async function wallet(id = user) {
  return (await query("SELECT balance,reserved FROM cinevjet.wallets WHERE user_id=$1", [id]))
    .rows[0] as { balance: string; reserved: string };
}
function pay(o: { order_code: number; amount: number }) {
  const i = infos.get(o.order_code)!;
  i.status = "PAID";
  i.amountPaid = o.amount;
  i.amountRemaining = 0;
}
function webhook(
  o: { order_code: number; amount: number },
  overrides: Record<string, unknown> = {},
) {
  const data = {
    orderCode: o.order_code,
    amount: o.amount,
    currency: "VND",
    paymentLinkId: infos.get(o.order_code)!.id,
    code: "00",
    reference: "ref-" + o.order_code,
    description: "CVJ",
    accountNumber: "123456789",
    ...overrides,
  };
  return { code: "00", success: true, data, signature: signData(data) };
}
const withdrawal = (amount = 110000) => ({
  amount,
  bank_name: "MB",
  bank_code: "970422",
  account_number: "123456789",
  account_name: "TEST USER",
  note: "",
  idempotency_key: randomUUID(),
});
function info(j: PayoutJob, state = "SUCCEEDED"): PayoutInfo {
  return {
    id: "payout-" + j.withdrawal_id,
    referenceId: j.reference_id,
    approvalState:
      state === "FAILED" ? "FAILED" : state === "SUCCEEDED" ? "COMPLETED" : "PROCESSING",
    transactions: [
      {
        id: "tx-" + j.withdrawal_id,
        referenceId: j.reference_id,
        amount: j.amount - j.fee,
        toBin: j.bank_code,
        toAccountNumber: j.bank_account_number,
        state,
      },
    ],
  };
}
async function enable() {
  process.env.PAYOS_PAYOUT_CLIENT_ID = "test-only";
  process.env.PAYOS_PAYOUT_API_KEY = "test-only";
  process.env.PAYOS_PAYOUT_CHECKSUM_KEY = "test-only";
  process.env.PAYOS_AUTO_PAYOUT_ENABLED = "true";
  process.env.PAYOS_PAYOUT_ACCESS_VERIFIED = "true";
  await setQueueControl(admin, {
    paused: false,
    interval_seconds: 30,
    transaction_limit: 100000000,
    daily_limit: 100000000,
  });
}
async function resetDispatch() {
  await query(
    "UPDATE cinevjet.payout_control SET next_dispatch_at=now()-interval '1 minute',leased_until=NULL,lease_token=NULL",
  );
}
test(
  "payOS financial invariants on " + (pool ? "isolated Neon PostgreSQL" : "local PGlite"),
  async (t) => {
    await t.test("auth/origin isolation and missing config", async () => {
      process.env.CRON_SECRET = "qa-only-" + randomUUID();
      for (const method of [workerGet, workerPost]) {
        assert.equal(
          (await method(new Request("https://cinevjet.test/api/internal/finance-worker"))).status,
          401,
        );
        assert.equal(
          (
            await method(
              new Request("https://cinevjet.test/api/internal/finance-worker", {
                headers: { authorization: "Bearer invalid" },
              }),
            )
          ).status,
          401,
        );
      }
      assert.throws(() =>
        checkOrigin(
          new Request("https://cinevjet-hoanganh-dz.vercel.app/api/payments/payos", {
            headers: { origin: "https://evil.example" },
          }),
        ),
      );
      const key = process.env.PAYOS_API_KEY;
      delete process.env.PAYOS_API_KEY;
      await assert.rejects(() =>
        createPayosOrder(user, { kind: "DEPOSIT", amount: 100000, idempotency_key: randomUUID() }),
      );
      process.env.PAYOS_API_KEY = key;
    });
    let order: Awaited<ReturnType<typeof createPayosOrder>>;
    await t.test("create idempotency and lost response recovery", async () => {
      failCreateOnce = true;
      const input = { kind: "DEPOSIT", amount: 100000, idempotency_key: randomUUID() };
      order = await createPayosOrder(user, input, alternateOrigin);
      const repeated = pool
        ? await Promise.all(Array.from({ length: 4 }, () => createPayosOrder(user, input)))
        : [await createPayosOrder(user, input)];
      assert.ok(repeated.every((o) => o.id === order.id));
      assert.equal(creates, 1);
      const expected = alternateOrigin + "/payments/payos/" + order.id;
      assert.deepEqual(callbacks.get(order.order_code), {
        returnUrl: expected,
        cancelUrl: expected,
      });
      const stored = (
        await query("SELECT return_url,cancel_url FROM cinevjet.payos_orders WHERE id=$1", [
          order.id,
        ])
      ).rows[0];
      assert.equal(stored.return_url, expected);
      assert.equal(stored.cancel_url, expected);
      await assert.rejects(
        () => createPayosOrder(user, input, "https://attacker.invalid"),
        /chưa được cấu hình/,
      );
      assert.equal(order.status, "PENDING");
      assert.equal(Number((await wallet()).balance), 0);
      await assert.rejects(() => createPayosOrder(other, input));
      await assert.rejects(() => reconcilePayosOrder(order.id, other));
    });
    await t.test("fake/amount/link/currency/unknown webhook cannot credit", async () => {
      pay(order);
      for (const bad of [
        { amount: 1 },
        { paymentLinkId: "bad-link" },
        { currency: "USD" },
        { orderCode: 9999 },
      ])
        await assert.rejects(() => receivePayosWebhook(webhook(order, bad)));
      await assert.rejects(() =>
        receivePayosWebhook({ ...webhook(order), signature: "a".repeat(64) }),
      );
      assert.equal(Number((await wallet()).balance), 0);
    });
    await t.test(
      "status GET projection is owner-scoped and cannot settle a remotely paid order",
      async () => {
        const beforeRequests = providerRequests;
        const beforeWallet = await wallet();
        assert.equal((await storedPayosOrder(order.id, user)).status, "PENDING");
        await assert.rejects(storedPayosOrder(order.id, other));
        assert.equal(providerRequests, beforeRequests);
        assert.deepEqual(await wallet(), beforeWallet);
        assert.equal(
          Number(
            (
              await query("SELECT count(*) n FROM cinevjet.wallet_ledger WHERE reference_id=$1", [
                order.id,
              ])
            ).rows[0].n,
          ),
          0,
        );
      },
    );
    await t.test("ten webhooks plus reconciliation credit once", async () => {
      const calls = Array.from({ length: 10 }, () => () => receivePayosWebhook(webhook(order)));
      if (pool)
        await Promise.all([...calls.map((f) => f()), reconcilePayosOrder(order.id, user, true)]);
      else {
        for (const f of calls) await f();
        await reconcilePayosOrder(order.id, user, true);
      }
      assert.equal(Number((await wallet()).balance), 100000);
      assert.equal(
        Number(
          (
            await query("SELECT count(*) n FROM cinevjet.wallet_ledger WHERE reference_id=$1", [
              order.id,
            ])
          ).rows[0].n,
        ),
        1,
      );
      assert.equal(
        Number(
          (await query("SELECT balance FROM cinevjet.coin_wallets WHERE user_id=$1", [user]))
            .rows[0].balance,
        ),
        777,
      );
      await assert.rejects(() =>
        approveDepositRequest(admin, order.id, { action: "APPROVE", confirmed: true }),
      );
    });
    await t.test("two distinct deposits retain both credits", async () => {
      const a = await createPayosOrder(user, {
          kind: "DEPOSIT",
          amount: 50000,
          idempotency_key: randomUUID(),
        }),
        b = await createPayosOrder(user, {
          kind: "DEPOSIT",
          amount: 75000,
          idempotency_key: randomUUID(),
        });
      pay(a);
      pay(b);
      if (pool)
        await Promise.all([receivePayosWebhook(webhook(a)), receivePayosWebhook(webhook(b))]);
      else {
        await receivePayosWebhook(webhook(a));
        await receivePayosWebhook(webhook(b));
      }
      assert.equal(Number((await wallet()).balance), 225000);
    });
    await t.test(
      "cancel/expiry/underpayment and forged return leave balance unchanged",
      async () => {
        for (const state of ["CANCELLED", "EXPIRED", "UNDERPAID"]) {
          const o = await createPayosOrder(user, {
            kind: "DEPOSIT",
            amount: 50000,
            idempotency_key: randomUUID(),
          });
          infos.get(o.order_code)!.status = state;
          assert.equal((await reconcilePayosOrder(o.id, user, true)).status, state);
        }
        const source = await readFile("src/app/payments/payos/[id]/page.tsx", "utf8");
        assert.ok(!source.includes("searchParams"));
        assert.equal(Number((await wallet()).balance), 225000);
      },
    );
    await t.test(
      "uncreated expired order terminates and failed lookups don't monopolize reconciliation",
      async () => {
        failBeforeCreate = true;
        const input = { kind: "DEPOSIT", amount: 50000, idempotency_key: randomUUID() };
        await assert.rejects(() => createPayosOrder(user, input));
        const abandoned = (
          await query("SELECT id FROM cinevjet.payos_orders WHERE idempotency_key=$1", [
            input.idempotency_key,
          ])
        ).rows[0];
        await query(
          "UPDATE cinevjet.payos_orders SET expires_at=now()-interval '1 minute' WHERE id=$1",
          [abandoned.id],
        );
        assert.equal(
          (await reconcilePayosOrder(String(abandoned.id), user, true)).status,
          "EXPIRED",
        );
        const faulty = await createPayosOrder(user, {
          kind: "DEPOSIT",
          amount: 50000,
          idempotency_key: randomUUID(),
        });
        await query("UPDATE cinevjet.payos_orders SET checked_at=NULL WHERE id=$1", [faulty.id]);
        failLookupCode = faulty.order_code;
        assert.equal((await reconcilePendingPayments(1)).failed, 1);
        assert.ok(
          (await query("SELECT checked_at FROM cinevjet.payos_orders WHERE id=$1", [faulty.id]))
            .rows[0].checked_at,
        );
        failLookupCode = 0;
        infos.get(faulty.order_code)!.status = "CANCELLED";
        await reconcilePayosOrder(faulty.id, user, true);
        assert.equal(Number((await wallet()).balance), 225000);
      },
    );
    await t.test(
      "VIP price trusted, duplicate activation prevented, manual method respects lifetime purchase",
      async () => {
        await assert.rejects(() =>
          createPayosOrder(user, {
            kind: "VIP_PURCHASE",
            plan_id: plan.id,
            amount: 1,
            idempotency_key: randomUUID(),
          }),
        );
        const o = await createPayosOrder(user, {
          kind: "VIP_PURCHASE",
          plan_id: plan.id,
          idempotency_key: randomUUID(),
        });
        assert.equal(o.amount, Number(plan.price));
        const beforeCreates = creates;
        const restored = await pendingVipPayment(user, String(plan.id));
        assert.equal(restored?.id, o.id);
        assert.equal(await pendingVipPayment(admin, String(plan.id)), null);
        const duplicate = await createPayosOrder(
          user,
          {
            kind: "VIP_PURCHASE",
            plan_id: plan.id,
            idempotency_key: randomUUID(),
          },
          alternateOrigin,
        );
        assert.equal(duplicate.id, o.id);
        assert.equal(creates, beforeCreates);
        const callback = (
          await query("SELECT return_url,cancel_url FROM cinevjet.payos_orders WHERE id=$1", [o.id])
        ).rows[0];
        const expected = process.env.NEXT_PUBLIC_APP_URL + "/payments/payos/" + o.id;
        assert.equal(callback.return_url, expected);
        assert.equal(callback.cancel_url, expected);
        const presentation = await paymentPresentation(o, user);
        assert.equal(presentation.plan_name, plan.name);
        assert.equal(presentation.duration_days, Number(plan.duration_days));
        assert.equal(presentation.vip_expires_at, null);
        pay(o);
        await receivePayosWebhook(webhook(o));
        await receivePayosWebhook(webhook(o));
        const paidOrder = await reconcilePayosOrder(o.id, user);
        assert.ok((await paymentPresentation(paidOrder, user)).vip_expires_at);
        assert.equal(await pendingVipPayment(user, String(plan.id)), null);
        assert.equal(
          Number(
            (
              await query(
                "SELECT count(*) n FROM cinevjet.vip_subscriptions WHERE activation_reference=$1",
                ["VIP_PURCHASE/" + o.id],
              )
            ).rows[0].n,
          ),
          1,
        );
        await assert.rejects(() =>
          approveVipPurchase(admin, o.id, { action: "APPROVE", confirmed: true }),
        );
        const bill = randomUUID();
        await query(
          "INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height) VALUES($1,$2,$3,'image/webp',100,10,10)",
          [bill, user, "https://example.test/bill/" + bill],
        );
        const manualInput = { plan_id: plan.id, bill_id: bill, idempotency_key: randomUUID() };
        await assert.rejects(() => createVipPurchase(user, manualInput));
        const apiKey = process.env.PAYOS_API_KEY;
        delete process.env.PAYOS_API_KEY;
        let manual;
        try {
          await assert.rejects(() => createVipPurchase(user, manualInput), /chỉ được mua/);
          const unpurchased = (
            await query(
              "SELECT id FROM cinevjet.vip_plans WHERE active AND purchase_enabled AND price>0 AND mission_count>0 AND id<>$1 ORDER BY price LIMIT 1",
              [plan.id],
            )
          ).rows[0];
          manual = await createVipPurchase(user, {
            ...manualInput,
            plan_id: String(unpurchased.id),
          });
        } finally {
          process.env.PAYOS_API_KEY = apiKey;
        }
        await approveVipPurchase(admin, manual.id, {
          action: "APPROVE",
          confirmed: true,
          evidence_reference: `LOCAL-LEGACY-MANUAL-${manual.id}`,
        });
        assert.equal(Number((await wallet()).balance), 225000);
      },
    );
    await t.test(
      "withdrawal atomic reservation, double click, overdraft and masked account",
      async () => {
        const p = withdrawal(150000),
          r = await createWithdrawalRequest(user, p);
        const twice = await createWithdrawalRequest(user, p);
        assert.equal(r.id, twice.id);
        assert.equal(Number((await wallet()).reserved), 150000);
        assert.equal(
          Number(
            (
              await query(
                "SELECT count(*) n FROM cinevjet.withdrawal_jobs WHERE withdrawal_id=$1",
                [r.id],
              )
            ).rows[0].n,
          ),
          1,
        );
        await assert.rejects(() => createWithdrawalRequest(user, withdrawal(110000)));
        await assert.rejects(() =>
          completeWithdrawal(admin, r.id, { action: "COMPLETE", confirmed: true }),
        );
        const rows = await userMoneyRequests(user, "VND");
        assert.equal(rows.find((x) => x.id === r.id)!.bank_account_number, "••••6789");
        await completeWithdrawal(admin, r.id, { action: "REJECT", reason: "QA" });
        assert.equal(Number((await wallet()).reserved), 0);
      },
    );
    await t.test("parallel withdrawals cannot over-reserve", async () => {
      const requests = [withdrawal(150000), withdrawal(150000)];
      const result = pool
        ? await Promise.allSettled(requests.map((r) => createWithdrawalRequest(user, r)))
        : [
            await Promise.resolve(createWithdrawalRequest(user, requests[0])).then((value) => ({
              status: "fulfilled" as const,
              value,
            })),
            await createWithdrawalRequest(user, requests[1]).then(
              (value) => ({ status: "fulfilled" as const, value }),
              (reason) => ({ status: "rejected" as const, reason }),
            ),
          ];
      assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(Number((await wallet()).reserved), 150000);
      const accepted = result.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
        id: string;
      }>;
      await completeWithdrawal(admin, accepted.value.id, { action: "REJECT", reason: "QA" });
    });
    await t.test(
      "payout defaults disabled, canonical signature differs from collections",
      async () => {
        assert.equal(autoPayoutEnabled(), false);
        assert.equal(
          payoutCanonical({ z: null, a: "x y", nested: { b: 2, a: 1 } }),
          "a=x%20y&nested=%7B%22a%22%3A1%2C%22b%22%3A2%7D&z=",
        );
        assert.deepEqual(await runPayoutWorker(), { dispatched: false, auto_enabled: false });
      },
    );
    await enable();
    const first = await createWithdrawalRequest(other, withdrawal()),
      second = await createWithdrawalRequest(other, withdrawal());
    await t.test("pause then concurrent worker claim, FIFO, global interval", async () => {
      await setQueueControl(admin, {
        paused: true,
        interval_seconds: 30,
        transaction_limit: 100000000,
        daily_limit: 100000000,
      });
      assert.equal(await claimPayout(), null);
      await setQueueControl(admin, {
        paused: false,
        interval_seconds: 30,
        transaction_limit: 100000000,
        daily_limit: 100000000,
      });
      const claims = pool
        ? await Promise.all([claimPayout(), claimPayout()])
        : [await claimPayout(), await claimPayout()];
      assert.equal(claims.filter(Boolean).length, 1);
      const claimed = claims.find(Boolean)!;
      assert.equal(claimed.withdrawal_id, first.id);
      assert.equal(await claimPayout(), null);
      await settlePayout(claimed, info(claimed));
      await settlePayout(claimed, info(claimed));
      assert.equal(Number((await wallet(other)).balance), 1000000 - first.amount);
      assert.equal(await claimPayout(), null);
    });
    await t.test("worker crash reconciles old reference, never resubmits", async () => {
      await resetDispatch();
      await query(
        "UPDATE cinevjet.withdrawal_jobs SET status='PROCESSING',leased_until=now()-interval '1 minute' WHERE withdrawal_id=$1",
        [second.id],
      );
      let sends = 0;
      const result = await runPayoutWorker({
        submit: async (j) => {
          sends++;
          return info(j);
        },
        find: async (j) => info(j),
      });
      assert.equal(sends, 0);
      assert.equal(result.reconciled, true);
      assert.equal(Number((await wallet(other)).balance), 1000000 - first.amount - second.amount);
    });
    await t.test(
      "timeout unknown holds funds; provider absence does not refund/retry transfer",
      async () => {
        const r = await createWithdrawalRequest(other, withdrawal());
        await resetDispatch();
        await runPayoutWorker({
          submit: async () => {
            throw new PayoutError("NETWORK_UNKNOWN");
          },
          find: async () => null,
        });
        assert.equal(
          (
            await query("SELECT status FROM cinevjet.withdrawal_jobs WHERE withdrawal_id=$1", [
              r.id,
            ])
          ).rows[0].status,
          "NEEDS_RECONCILIATION",
        );
        await assert.rejects(() => queueAction(admin, r.id, "RETRY"));
        assert.equal(Number((await wallet(other)).reserved), r.amount);
        await resetDispatch();
        await query(
          "UPDATE cinevjet.withdrawal_jobs SET next_attempt_at=now()-interval '1 minute' WHERE withdrawal_id=$1",
          [r.id],
        );
        process.env.PAYOS_AUTO_PAYOUT_ENABLED = "false";
        await setQueueControl(admin, {
          paused: true,
          interval_seconds: 30,
          transaction_limit: null,
          daily_limit: null,
        });
        await runPayoutWorker(
          {
            submit: async () => {
              throw new Error("MUST NOT SEND");
            },
            find: async (j) => info(j, "FAILED"),
          },
          true,
        );
        await enable();
        assert.equal(Number((await wallet(other)).reserved), 0);
        assert.equal(Number((await wallet(other)).balance), 1000000 - first.amount - second.amount);
      },
    );
    await t.test("safe 429 retry uses same reference/key, success once", async () => {
      const r = await createWithdrawalRequest(other, withdrawal());
      await resetDispatch();
      let firstJob: PayoutJob | undefined;
      await runPayoutWorker({
        submit: async (j) => {
          firstJob = j;
          throw new PayoutError("RATE_LIMIT", 429);
        },
        find: async () => null,
      });
      assert.equal(
        (await query("SELECT status FROM cinevjet.withdrawal_jobs WHERE withdrawal_id=$1", [r.id]))
          .rows[0].status,
        "RETRY_WAIT",
      );
      await query(
        "UPDATE cinevjet.withdrawal_jobs SET next_attempt_at=now()-interval '1 minute' WHERE withdrawal_id=$1",
        [r.id],
      );
      await resetDispatch();
      await runPayoutWorker({
        submit: async (j) => {
          assert.equal(j.idempotency_key, firstJob!.idempotency_key);
          assert.equal(j.reference_id, firstJob!.reference_id);
          return info(j);
        },
        find: async () => null,
      });
      assert.equal(Number((await wallet(other)).balance), 670000);
    });
    await t.test(
      "rate-limit retry stops at five attempts and permits evidenced manual review",
      async () => {
        const r = await createWithdrawalRequest(other, withdrawal());
        for (let attempt = 1; attempt <= 5; attempt++) {
          await resetDispatch();
          await query(
            "UPDATE cinevjet.withdrawal_jobs SET next_attempt_at=now()-interval '1 minute' WHERE withdrawal_id=$1",
            [r.id],
          );
          const result = await runPayoutWorker({
            submit: async () => {
              throw new PayoutError("RATE_LIMIT", 429);
            },
            find: async () => null,
          });
          assert.equal(result.state, attempt < 5 ? "RETRY_WAIT" : "MANUAL_REVIEW");
        }
        await assert.rejects(() => queueAction(admin, r.id, "RETRY"));
        await completeWithdrawal(admin, r.id, { action: "REJECT", reason: "QA exhausted retries" });
        assert.equal(Number((await wallet(other)).balance), 670000);
      },
    );
    await t.test("provider definitively cancelled payout releases the hold once", async () => {
      await createWithdrawalRequest(other, withdrawal());
      await resetDispatch();
      const job = (await claimPayout())!;
      const cancelled = info(job, "CANCELLED");
      cancelled.approvalState = "CANCELLED";
      await settlePayout(job, cancelled);
      await settlePayout(job, cancelled);
      assert.equal(Number((await wallet(other)).reserved), 0);
      assert.equal(Number((await wallet(other)).balance), 670000);
    });
    await t.test(
      "manual completion needs proof and repeated completion cannot debit twice",
      async () => {
        process.env.PAYOS_AUTO_PAYOUT_ENABLED = "false";
        const r = await createWithdrawalRequest(other, withdrawal());
        const proof = randomUUID();
        await query(
          "INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height) VALUES($1,$2,$3,'image/webp',100,10,10)",
          [proof, admin, "https://example.test/proof/" + proof],
        );
        const approval = {
          action: "COMPLETE",
          confirmed: true,
          evidence_reference: "manual-" + r.id,
          proof_bill_id: proof,
        };
        await completeWithdrawal(admin, r.id, approval);
        await assert.rejects(() => completeWithdrawal(admin, r.id, approval));
        assert.equal(Number((await wallet(other)).balance), 560000);
      },
    );
    await t.test(
      "production 101 absence recovers durable order; unknown 101 never creates",
      async () => {
        const input = { kind: "VIP_PURCHASE", plan_id: plan.id, idempotency_key: randomUUID() };
        const beforeCreates = creates,
          beforeBalance = await wallet(other);
        lookupErrorOnce = true;
        await assert.rejects(() => createPayosOrder(other, input));
        assert.equal(creates, beforeCreates);
        const durable = (
          await query("SELECT id,order_code FROM cinevjet.payos_orders WHERE idempotency_key=$1", [
            input.idempotency_key,
          ])
        ).rows[0];
        const recovered = await createPayosOrder(other, input);
        assert.equal(recovered.id, durable.id);
        assert.equal(recovered.order_code, Number(durable.order_code));
        assert.equal(recovered.status, "PENDING");
        assert.equal(creates, beforeCreates + 1);
        await createPayosOrder(other, input);
        assert.equal(creates, beforeCreates + 1);
        assert.deepEqual(await wallet(other), beforeBalance);
        infos.get(recovered.order_code)!.status = "CANCELLED";
        await reconcilePayosOrder(recovered.id, other, true);
      },
    );
    await t.test(
      "signed CREATE succeeds even while GET is unavailable, without financial activation",
      async () => {
        const before = await wallet(other),
          beforeCreates = creates;
        const input = { kind: "VIP_PURCHASE", plan_id: plan.id, idempotency_key: randomUUID() };
        delayLookupAfterCreate = true;
        const o = await createPayosOrder(other, input);
        delayLookupAfterCreate = false;
        assert.equal(o.status, "PENDING");
        assert.ok(o.checkout_url?.startsWith("https://pay.payos.vn/web/"));
        assert.equal(creates, beforeCreates + 1);
        assert.deepEqual(await wallet(other), before);
        assert.equal(
          (await query("SELECT status FROM cinevjet.vip_purchase_requests WHERE id=$1", [o.id]))
            .rows[0].status,
          "PENDING",
        );
        assert.equal((await reconcilePayosOrder(o.id, other)).status, "PENDING");
        await assert.rejects(() => reconcilePayosOrder(o.id, other, true));
        assert.equal(creates, beforeCreates + 1);
        failLookupCode = 0;
        assert.equal((await createPayosOrder(other, input)).id, o.id);
        assert.equal(creates, beforeCreates + 1);
        infos.get(o.order_code)!.status = "CANCELLED";
        await reconcilePayosOrder(o.id, other, true);
      },
    );
    await t.test("legacy pending VND withdrawals also require transfer evidence", async () => {
      const id = randomUUID(),
        proof = randomUUID();
      await query(
        "WITH held AS (UPDATE cinevjet.wallets SET reserved=reserved+100000 WHERE user_id=$2 AND balance-reserved>=100000 RETURNING user_id) INSERT INTO cinevjet.withdrawals(id,user_id,amount,fee,destination,idempotency_key,bank_name,bank_account_number,bank_account_name,user_note) SELECT $1,user_id,100000,3000,'QA legacy',$3,'MB','123456789','QA USER','' FROM held",
        [id, other, randomUUID()],
      );
      await assert.rejects(() =>
        completeWithdrawal(admin, id, { action: "COMPLETE", confirmed: true }),
      );
      assert.equal(Number((await wallet(other)).reserved), 100000);
      assert.equal(
        Number(
          (
            await query("SELECT count(*) n FROM cinevjet.withdrawal_jobs WHERE withdrawal_id=$1", [
              id,
            ])
          ).rows[0].n,
        ),
        0,
      );
      await query(
        "INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height) VALUES($1,$2,$3,'image/webp',100,10,10)",
        [proof, admin, "https://example.test/legacy-proof/" + proof],
      );
      await completeWithdrawal(admin, id, {
        action: "COMPLETE",
        confirmed: true,
        evidence_reference: "legacy-" + id,
        proof_bill_id: proof,
      });
      assert.equal(Number((await wallet(other)).balance), 460000);
      assert.equal(Number((await wallet(other)).reserved), 0);
      assert.equal(
        (await query("SELECT status FROM cinevjet.withdrawal_jobs WHERE withdrawal_id=$1", [id]))
          .rows[0].status,
        "SUCCEEDED",
      );
    });
  },
);
test.after(async () => {
  globalThis.fetch = originalFetch;
  await runtimePool?.end();
  await pool?.end();
  await pg?.close();
});
