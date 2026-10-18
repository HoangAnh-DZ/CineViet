import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as liteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  createPayosOrder,
  cancelVipPayment,
  reconcilePayosOrder,
  receivePayosWebhook,
} from "../src/server/payos-payments";
import { purchasedVipPlanIds } from "../src/server/vip-eligibility";
import {
  createVipPurchase,
  approveVipPurchase,
  userVipPurchases,
} from "../src/server/vip-purchases";
import { cancelVipOrder, vipOrderState } from "../src/server/vip-orders";
import { signData } from "../src/server/payos-client";
process.env.AUTH_SECRET = "local-lifecycle-secret-at-least-thirtytwo";
process.env.PAYOS_CLIENT_ID = "QA";
process.env.PAYOS_API_KEY = "QA";
process.env.PAYOS_CHECKSUM_KEY = "QA";
process.env.NEXT_PUBLIC_APP_URL = "https://cinevjet-hoanganh-dz.vercel.app";
let lite: PGlite | undefined, pool: Pool | undefined;
const postgres = !!process.env.BANK_ACCOUNT_TEST_URL;
if (postgres) {
  const url = new URL(process.env.BANK_ACCOUNT_TEST_URL!);
  assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
  assert.equal(url.pathname, "/saved_banks_qa_20261017");
  for (const k of ["sslmode", "channel_binding"]) url.searchParams.delete(k);
  pool = new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 10,
    allowExitOnIdle: true,
  });
  (globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase =
    pgDrizzle(pool);
} else {
  lite = new PGlite();
  for (const f of (await readdir("database/migrations")).filter((f) => f.endsWith(".sql")).sort())
    await lite.exec(await readFile("database/migrations/" + f, "utf8"));
  await lite.exec(await readFile("database/seed.sql", "utf8"));
  (globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase }).cinevjetDatabase =
    liteDrizzle(lite) as unknown as NodePgDatabase;
}
async function q(s: string, v: unknown[] = []): Promise<{ rows: Record<string, any>[] }> {
  return pool ? pool.query(s, v) : lite!.query(s, v);
}
async function user() {
  const id = randomUUID();
  await q(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name)VALUES($1,$2,'unused','Lifecycle QA')",
    [id, id + "@example.invalid"],
  );
  await q("INSERT INTO cinevjet.wallets(user_id)VALUES($1)", [id]);
  await q("INSERT INTO cinevjet.coin_wallets(user_id,balance)VALUES($1,100)", [id]);
  return id;
}
const infos = new Map<number, any>();
let creates = 0,
  cancels = 0,
  cancelFailure = false,
  cancelLost = false,
  cancelPaidRace = false,
  creatingLost = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  assert.ok(url.startsWith("https://api-merchant.payos.vn/v2/payment-requests"));
  if (url.endsWith("/cancel")) {
    cancels++;
    const code = Number(url.split("/").at(-2)),
      info = infos.get(code);
    assert.ok(info);
    assert.equal(
      JSON.parse(String(init?.body)).cancellationReason,
      "User requested VIP cancellation",
    );
    if (cancelFailure) throw Error("local network failure");
    if (cancelPaidRace) {
      cancelPaidRace = false;
      Object.assign(info, { status: "PAID", amountPaid: info.amount, amountRemaining: 0 });
    } else if (info.status === "PENDING") info.status = "CANCELLED";
    if (cancelLost) {
      cancelLost = false;
      throw Error("local response lost");
    }
    return Response.json({ code: "00", data: info, signature: signData(info) });
  }
  if (init?.method === "POST") {
    creates++;
    const data = JSON.parse(String(init.body));
    const info = {
      id: "QA-" + data.orderCode,
      paymentLinkId: "QA-" + data.orderCode,
      orderCode: data.orderCode,
      amount: data.amount,
      amountPaid: 0,
      amountRemaining: data.amount,
      status: "PENDING",
      accountNumber: "QAONLY",
      accountName: "LOCAL QA",
      bin: "000000",
      currency: "VND",
      checkoutUrl: "https://pay.payos.vn/web/QA-" + data.orderCode,
      qrCode: "QA",
    };
    infos.set(data.orderCode, info);
    if (creatingLost) {
      creatingLost = false;
      throw Error("create response lost");
    }
    return Response.json({ code: "00", data: info, signature: signData(info) });
  }
  const info = infos.get(Number(url.split("/").at(-1)));
  return info
    ? Response.json({ code: "00", data: info, signature: signData(info) })
    : Response.json({ code: "101", desc: "Mã thanh toán không tồn tại" });
};
const body = (plan = "VIP_1", key = randomUUID()) => ({
  kind: "VIP_PURCHASE",
  plan_id: plan,
  idempotency_key: key,
});
async function paid(order: any) {
  const info = infos.get(order.order_code);
  Object.assign(info, { status: "PAID", amountPaid: info.amount, amountRemaining: 0 });
  return reconcilePayosOrder(order.id, undefined, true);
}
const actor = await user();
await q("INSERT INTO cinevjet.admin_users(user_id)VALUES($1)", [actor]);
try {
  await test("each paid VIP plan is lifetime-only, including after expiry; other plans remain available", async () => {
    const u = await user();
    for (const plan of ["VIP_1", "VIP_2", "VIP_3", "VIP_4", "VIP_5", "VIP_6"]) {
      const order = await createPayosOrder(u, body(plan));
      assert.equal(Math.round((Date.parse(order.expires_at) - Date.now()) / 60000), 30);
      await paid(order);
      await assert.rejects(() => createPayosOrder(u, body(plan)), /chỉ được mua/);
      await q("UPDATE cinevjet.vip_subscriptions SET status='EXPIRED' WHERE user_id=$1", [u]);
      await assert.rejects(() => createPayosOrder(u, body(plan)), /chỉ được mua/);
    }
    assert.equal((await purchasedVipPlanIds(u)).length, 6);
    assert.equal(
      (await q("SELECT count(*)::int n FROM cinevjet.vip_subscriptions WHERE user_id=$1", [u]))
        .rows[0].n,
      6,
    );
    assert.equal(
      Number(
        (await q("SELECT balance FROM cinevjet.coin_wallets WHERE user_id=$1", [u])).rows[0]
          .balance,
      ),
      100,
    );
  });
  await test("reload/new key resumes same unpaid order and original deadline; cancelled attempt can be replaced", async () => {
    const u = await user(),
      input = body();
    const a = await createPayosOrder(u, input),
      b = await createPayosOrder(u, body());
    assert.equal(a.id, b.id);
    assert.equal(a.order_code, b.order_code);
    assert.equal(a.expires_at, b.expires_at);
    const n = cancels;
    const cancelled = await cancelVipOrder(u, a.id);
    assert.equal("status" in cancelled ? cancelled.status : "", "CANCELLED");
    await cancelVipPayment(a.id, u);
    assert.equal(cancels, n + 1);
    assert.equal((await createPayosOrder(u, input)).status, "CANCELLED");
    assert.equal((await purchasedVipPlanIds(u)).length, 0);
    const c = await createPayosOrder(u, body());
    assert.notEqual(c.id, a.id);
  });
  await test("30-minute expiry confirms cancellation, retains history and never activates VIP", async () => {
    const u = await user(),
      order = await createPayosOrder(u, body());
    await q("UPDATE cinevjet.payos_orders SET expires_at=now()-interval '1 second' WHERE id=$1", [
      order.id,
    ]);
    assert.equal((await reconcilePayosOrder(order.id, u)).status, "EXPIRED");
    const state = await vipOrderState(u);
    assert.equal(state.requests.find((r) => r.id === order.id)?.payos_status, "EXPIRED");
    assert.equal(state.requests.find((r) => r.id === order.id)?.status, "REJECTED");
    assert.deepEqual(state.purchased, []);
    assert.equal(
      (await q("SELECT count(*)::int n FROM cinevjet.vip_subscriptions WHERE user_id=$1", [u]))
        .rows[0].n,
      0,
    );
    const again = await createPayosOrder(u, body());
    assert.notEqual(again.id, order.id);
  });
  await test("expiry and manual cancel settle payments already received instead of cancelling paid orders", async () => {
    const u = await user(),
      order = await createPayosOrder(u, body());
    const info = infos.get(order.order_code);
    Object.assign(info, { status: "PAID", amountPaid: order.amount, amountRemaining: 0 });
    await q("UPDATE cinevjet.payos_orders SET expires_at=now()-interval '1 second' WHERE id=$1", [
      order.id,
    ]);
    assert.equal((await cancelVipPayment(order.id, u, true)).status, "PAID");
    assert.equal((await cancelVipPayment(order.id, u)).status, "PAID");
    assert.deepEqual(await purchasedVipPlanIds(u), ["VIP_1"]);
    const v = await user(),
      race = await createPayosOrder(v, body());
    cancelPaidRace = true;
    assert.equal((await cancelVipPayment(race.id, v)).status, "PAID");
    assert.deepEqual(await purchasedVipPlanIds(v), ["VIP_1"]);
  });
  await test("partial payments and uncertain cancellation fail safely; accepted/lost cancellation recovers same order", async () => {
    const u = await user(),
      o = await createPayosOrder(u, body());
    const info = infos.get(o.order_code);
    Object.assign(info, {
      status: "UNDERPAID",
      amountPaid: 1000,
      amountRemaining: o.amount - 1000,
    });
    await assert.rejects(() => cancelVipPayment(o.id, u), /một phần/);
    info.status = "PENDING";
    info.amountPaid = 0;
    info.amountRemaining = o.amount;
    cancelFailure = true;
    await assert.rejects(() => cancelVipPayment(o.id, u));
    cancelFailure = false;
    assert.equal(
      (await q("SELECT status FROM cinevjet.payos_orders WHERE id=$1", [o.id])).rows[0].status,
      "PENDING",
    );
    cancelLost = true;
    assert.equal((await cancelVipPayment(o.id, u)).status, "CANCELLED");
  });
  await test("IDOR blocks history detail/cancel; expiry never creates a missing provider link", async () => {
    const u = await user(),
      v = await user(),
      o = await createPayosOrder(u, body());
    await assert.rejects(() => cancelVipPayment(o.id, v));
    await assert.rejects(() => cancelVipOrder(v, o.id));
    assert.equal((await userVipPurchases(v)).length, 0);
    infos.delete(o.order_code);
    await q(
      "UPDATE cinevjet.payos_orders SET payment_link_id=NULL,status='CREATING',expires_at=now()-interval '1 second' WHERE id=$1",
      [o.id],
    );
    const n = creates;
    assert.equal((await reconcilePayosOrder(o.id, u)).status, "EXPIRED");
    assert.equal(creates, n);
  });
  await test("late signed PAID webhook after cancellation settles once; stale PENDING never reopens cancellation", async () => {
    const u = await user(),
      o = await createPayosOrder(u, body());
    await cancelVipPayment(o.id, u);
    const info = infos.get(o.order_code);
    info.status = "PENDING";
    assert.equal((await reconcilePayosOrder(o.id, u, true)).status, "CANCELLED");
    Object.assign(info, { status: "PAID", amountPaid: o.amount, amountRemaining: 0 });
    const data = {
      orderCode: o.order_code,
      amount: o.amount,
      currency: "VND",
      paymentLinkId: info.id,
      code: "00",
      reference: "QA-" + randomUUID(),
      description: "CVJ",
      accountNumber: "QAONLY",
    };
    const webhook = { code: "00", success: true, data, signature: signData(data) };
    await receivePayosWebhook(webhook);
    await receivePayosWebhook(webhook);
    assert.equal(
      (await q("SELECT count(*)::int n FROM cinevjet.vip_subscriptions WHERE user_id=$1", [u]))
        .rows[0].n,
      1,
    );
    await assert.rejects(() => createPayosOrder(u, body()));
  });
  await test("a late payment on an older cancelled order cannot activate the same plan twice", async () => {
    const u = await user(),
      old = await createPayosOrder(u, body());
    await cancelVipPayment(old.id, u);
    const next = await createPayosOrder(u, body());
    await paid(old);
    await assert.rejects(() => paid(next), /đối soát/);
    assert.equal(
      (await q("SELECT count(*)::int n FROM cinevjet.vip_subscriptions WHERE user_id=$1", [u]))
        .rows[0].n,
      1,
    );
    assert.equal(
      (await q("SELECT status FROM cinevjet.vip_purchase_requests WHERE id=$1", [next.id])).rows[0]
        .status,
      "PENDING",
    );
    assert.equal(infos.get(next.order_code).status, "PAID");
  });
  await test("manual fallback is once-only too; cancellation does not cancel an active VIP", async () => {
    process.env.PAYOS_API_KEY = "";
    const u = await user(),
      d = { plan_id: "VIP_1", idempotency_key: randomUUID() };
    const r = await createVipPurchase(u, d);
    await cancelVipOrder(u, r.id);
    const retry = await createVipPurchase(u, { ...d, idempotency_key: randomUUID() });
    await approveVipPurchase(actor, retry.id, {
      action: "APPROVE",
      confirmed: true,
      evidence_reference: "QA-" + randomUUID(),
    });
    await assert.rejects(() => createVipPurchase(u, { ...d, idempotency_key: randomUUID() }));
    await assert.rejects(() => cancelVipOrder(u, retry.id));
    assert.deepEqual(await purchasedVipPlanIds(u), ["VIP_1"]);
    process.env.PAYOS_API_KEY = "QA";
  });
  await test(
    "real PostgreSQL concurrency: parallel creates reuse one order; duplicate late paid plans never activate twice",
    { skip: !postgres },
    async () => {
      const u = await user(),
        orders = await Promise.all(Array.from({ length: 6 }, () => createPayosOrder(u, body())));
      assert.equal(new Set(orders.map((o) => o.id)).size, 1);
      await paid(orders[0]);
      const retry = await Promise.allSettled(
        Array.from({ length: 5 }, () => createPayosOrder(u, body())),
      );
      assert.equal(retry.filter((r) => r.status === "fulfilled").length, 0);
      assert.equal(
        (
          await q("SELECT count(*)::int n FROM cinevjet.vip_purchase_requests WHERE user_id=$1", [
            u,
          ])
        ).rows[0].n,
        1,
      );
    },
  );
} finally {
  globalThis.fetch = originalFetch;
  if (pool) await pool.end();
  if (lite) await lite.close();
}
