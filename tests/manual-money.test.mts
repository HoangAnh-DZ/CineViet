import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import {
  createDepositRequest,
  createWithdrawalRequest,
  approveDepositRequest,
  completeWithdrawal,
  userMoneyRequests,
  adminMoneyDetail,
} from "../src/server/manual-money";
import { dashboardOverview } from "../src/server/dashboard";
import { memberActivity } from "../src/features/admin/presentation-data";
import { prepareBillImage } from "../src/server/bill-storage";
import { moneyConfig } from "../src/server/money-config";
import { pgConfig } from "../scripts/pg-config.mjs";
if (!(process.env.MONEY_QA_HOST && process.env.DATABASE_URL)) {
  test("Legacy dedicated Neon QA suite", {skip: "Dedicated QA credentials/branch unavailable; current contracts, coins, withdrawals and playback claims are covered by vip-bank.test.mts"}, () => {});
} else {
const hostname = process.env.MONEY_QA_HOST;
assert.equal(
  hostname,
  "ep-patient-surf-b3s99cl5-pooler.c-4.ap-southeast-1.aws.neon.tech",
  "Run only on the dedicated Neon QA branch",
);
const url = new URL(process.env.DATABASE_URL!);
assert.notEqual(url.hostname, hostname);
url.hostname = hostname!;
process.env.DATABASE_URL = url.toString();
const pool = new Pool({ ...pgConfig(), max: 10 });
(
  globalThis as typeof globalThis & { cinevjetDatabase: ReturnType<typeof drizzle> }
).cinevjetDatabase = drizzle(pool);
const protectedTables = [
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
  const result: Record<string, unknown> = {};
  for (const table of protectedTables)
    result[table] = (
      await pool.query(
        `SELECT count(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS fingerprint FROM cinevjet.${table} t`,
      )
    ).rows[0];
  return result;
}
const baseline = await fingerprints();
const direct = new URL(url);
direct.hostname = direct.hostname.replace("-pooler", "");
const migration = spawnSync(process.execPath, ["scripts/migrate.mjs"], {
  env: { ...process.env, DATABASE_URL: direct.toString() },
  encoding: "utf8",
});
assert.equal(migration.status, 0, migration.stderr);
assert.deepEqual(await fingerprints(), baseline);
await writeFile(
  "test-results/manual-money-migration.json",
  JSON.stringify(
    {
      status: "PASS",
      branch: "br-quiet-silence-b30z8m9u",
      unchangedTables: protectedTables.length,
      migration: migration.stdout.trim(),
      tables: baseline,
    },
    null,
    2,
  ),
);
const actors: string[] = [];
async function user(cash = 0, admin = false) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)",
    [id, `${id}@money-qa.example.test`, "unused", "Money QA"],
  );
  await pool.query("INSERT INTO cinevjet.wallets(user_id,balance) VALUES($1,$2)", [id, cash]);
  await pool.query("INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES($1,200)", [id]);
  if (admin) await pool.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [id]);
  actors.push(id);
  return id;
}
const admin = await user(0, true),
  admin2 = await user(0, true),
  regular = await user();
async function bill(id: string) {
  const key = randomUUID();
  await pool.query(
    "INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height) VALUES($1,$2,$3,'image/webp',120,10,10)",
    [key, id, `https://1uun41e8ziuloclw.public.blob.vercel-storage.com/qa-fixture-${key}.webp`],
  );
  return key;
}
async function deposit(id: string, amount = 100000) {
  return { amount, bill_id: await bill(id), note: "QA bill", idempotency_key: randomUUID() };
}
const withdrawal = (amount = 100000) => ({
  amount,
  bank_name: "TPBank",
  account_number: "1234567890",
  account_name: "MONEY QA",
  note: "QA withdrawal",
  idempotency_key: randomUUID(),
});
const approved = { action: "APPROVE", confirmed: true, note: "Internal bank check" };
const complete = { action: "COMPLETE", confirmed: true, note: "Internal transfer check" };
const rejected = { action: "REJECT", note: "Private investigation", reason: "Thông tin chưa khớp" };
async function wallet(id: string) {
  return (
    await pool.query("SELECT balance::int,reserved::int FROM cinevjet.wallets WHERE user_id=$1", [
      id,
    ])
  ).rows[0];
}
async function ledger(id: string) {
  return (
    await pool.query("SELECT amount::int,type FROM cinevjet.wallet_ledger WHERE reference_id=$1", [
      id,
    ])
  ).rows;
}
const status = (n: number) => (e: unknown) =>
  !!e && typeof e === "object" && "status" in e && e.status === n;
let pass = 0;
test("Manual money: real Neon transactions, locks, migration and decoded images", async (t) => {
  const check = async (name: string, fn: () => Promise<void>) => {
    await t.test(name, async () => {
      await fn();
      pass++;
    });
  };
  await check("Deposit 1: pending stores bank/bill without credit or ledger", async () => {
    const u = await user(),
      r = await createDepositRequest(u, await deposit(u));
    assert.equal(r.status, "PENDING");
    assert.equal(r.bank_account_number, "0000000000");
    assert.equal(r.bank_account_name, "EXAMPLE ACCOUNT");
    assert.deepEqual(await wallet(u), { balance: 0, reserved: 0 });
    assert.deepEqual(await ledger(r.id), []);
  });
  await check("Deposit 2: missing bill rejected", async () => {
    await assert.rejects(
      createDepositRequest(regular, { amount: 50000, idempotency_key: randomUUID() }),
    );
  });
  await check("Deposit 3: noninteger/min/max money rejected", async () => {
    for (const amount of [49999, 100000001, 50000.1, -1, NaN])
      await assert.rejects(createDepositRequest(regular, { ...(await deposit(regular)), amount }));
  });
  await check("Deposit 4: client cannot inject completed status", async () => {
    await assert.rejects(
      createDepositRequest(regular, { ...(await deposit(regular)), status: "COMPLETED" }),
    );
  });
  await check("Deposit 5: another user bill rejected", async () => {
    const other = await user();
    await assert.rejects(createDepositRequest(other, await deposit(regular)), status(400));
  });
  await check("Deposit 6: request retry returns same pending ID", async () => {
    const u = await user(),
      d = await deposit(u),
      a = await createDepositRequest(u, d),
      b = await createDepositRequest(u, d);
    assert.equal(a.id, b.id);
    assert.deepEqual(await wallet(u), { balance: 0, reserved: 0 });
  });
  await check("Deposit 7: same bill with new key rejected", async () => {
    const u = await user(),
      d = await deposit(u);
    await createDepositRequest(u, d);
    await assert.rejects(
      createDepositRequest(u, { ...d, idempotency_key: randomUUID() }),
      status(409),
    );
  });
  await check("Deposit 8: approve requires confirmation and credits once", async () => {
    const u = await user(),
      r = await createDepositRequest(u, await deposit(u));
    await assert.rejects(
      approveDepositRequest(admin, r.id, { ...approved, confirmed: false }),
      status(400),
    );
    await approveDepositRequest(admin, r.id, approved);
    await assert.rejects(approveDepositRequest(admin, r.id, approved), status(409));
    assert.deepEqual(await wallet(u), { balance: 100000, reserved: 0 });
    assert.deepEqual(await ledger(r.id), [{ amount: 100000, type: "DEPOSIT" }]);
  });
  await check("Deposit 9: concurrent admins settle once", async () => {
    const u = await user(),
      r = await createDepositRequest(u, await deposit(u));
    const a = await Promise.allSettled([
      approveDepositRequest(admin, r.id, approved),
      approveDepositRequest(admin2, r.id, approved),
    ]);
    assert.equal(a.filter((r) => r.status === "fulfilled").length, 1);
    assert.deepEqual(await wallet(u), { balance: 100000, reserved: 0 });
    assert.equal((await ledger(r.id)).length, 1);
  });
  await check("Deposit 10: reject no credit and safe public history", async () => {
    const u = await user(),
      r = await createDepositRequest(u, await deposit(u));
    await approveDepositRequest(admin, r.id, rejected);
    assert.deepEqual(await wallet(u), { balance: 0, reserved: 0 });
    assert.deepEqual(await ledger(r.id), []);
    const history = await userMoneyRequests(u);
    assert.equal(history[0].review_note, rejected.reason);
    assert.ok(!JSON.stringify(history).includes(rejected.note));
  });
  await check("Withdrawal 1: creation holds gross amount immediately", async () => {
    const u = await user(200000),
      r = await createWithdrawalRequest(u, withdrawal());
    assert.equal(r.status, "PENDING");
    assert.equal(r.fee, 3000);
    assert.deepEqual(await wallet(u), { balance: 200000, reserved: 100000 });
    assert.deepEqual(await ledger(r.id), []);
  });
  await check("Withdrawal 2: minimum and fee use exact VND integers", async () => {
    const u = await user(200000);
    await assert.rejects(createWithdrawalRequest(u, withdrawal(49999)));
    const r = await createWithdrawalRequest(u, withdrawal(50000));
    assert.equal(r.amount - r.fee, 47000);
  });
  await check("Withdrawal 3: insufficient available rejected", async () => {
    const u = await user(50000);
    await assert.rejects(createWithdrawalRequest(u, withdrawal()), status(400));
    assert.deepEqual(await wallet(u), { balance: 50000, reserved: 0 });
  });
  await check("Withdrawal 4: bank details and unsafe money rejected", async () => {
    const u = await user(200000);
    for (const input of [
      { ...withdrawal(), account_number: "ABC" },
      { ...withdrawal(), bank_name: "" },
      { ...withdrawal(), account_name: "" },
      { ...withdrawal(), amount: 100000.1 },
    ])
      await assert.rejects(createWithdrawalRequest(u, input));
  });
  await check("Withdrawal 5: status, txHash and payout fields rejected", async () => {
    for (const extra of [{ status: "COMPLETED" }, { txHash: "abc" }, { payout: "api" }])
      await assert.rejects(createWithdrawalRequest(regular, { ...withdrawal(), ...extra }));
  });
  await check("Withdrawal 6: same-key retry reserves once", async () => {
    const u = await user(200000),
      d = withdrawal(),
      a = await createWithdrawalRequest(u, d),
      b = await createWithdrawalRequest(u, d);
    assert.equal(a.id, b.id);
    assert.deepEqual(await wallet(u), { balance: 200000, reserved: 100000 });
  });
  await check("Withdrawal 7: same key altered payload rejected", async () => {
    const u = await user(200000),
      d = withdrawal();
    await createWithdrawalRequest(u, d);
    await assert.rejects(createWithdrawalRequest(u, { ...d, amount: 50000 }), status(409));
  });
  await check("Withdrawal 8: confirmed completion deducts once and releases hold", async () => {
    const u = await user(200000),
      r = await createWithdrawalRequest(u, withdrawal());
    await assert.rejects(
      completeWithdrawal(admin, r.id, { ...complete, confirmed: false }),
      status(400),
    );
    await completeWithdrawal(admin, r.id, complete);
    await assert.rejects(completeWithdrawal(admin, r.id, complete), status(409));
    assert.deepEqual(await wallet(u), { balance: 100000, reserved: 0 });
    assert.deepEqual(await ledger(r.id), [{ amount: -100000, type: "WITHDRAWAL" }]);
  });
  await check("Withdrawal 9: rejection restores full availability", async () => {
    const u = await user(200000),
      r = await createWithdrawalRequest(u, withdrawal());
    await completeWithdrawal(admin, r.id, rejected);
    assert.deepEqual(await wallet(u), { balance: 200000, reserved: 0 });
    assert.deepEqual(await ledger(r.id), []);
    await assert.rejects(completeWithdrawal(admin, r.id, complete), status(409));
  });
  await check("Withdrawal 10: simultaneous complete/reject resolves exactly once", async () => {
    const u = await user(200000),
      r = await createWithdrawalRequest(u, withdrawal());
    const a = await Promise.allSettled([
      completeWithdrawal(admin, r.id, complete),
      completeWithdrawal(admin2, r.id, rejected),
    ]);
    assert.equal(a.filter((r) => r.status === "fulfilled").length, 1);
    const w = await wallet(u);
    assert.equal(w.reserved, 0);
    assert.ok(w.balance === 100000 || w.balance === 200000);
    assert.equal((await ledger(r.id)).length, w.balance === 100000 ? 1 : 0);
  });
  await check("Withdrawal 11: simultaneous requests never overspend", async () => {
    const u = await user(150000);
    const r = await Promise.allSettled([
      createWithdrawalRequest(u, withdrawal()),
      createWithdrawalRequest(u, withdrawal()),
    ]);
    assert.equal(r.filter((v) => v.status === "fulfilled").length, 1);
    assert.deepEqual(await wallet(u), { balance: 150000, reserved: 100000 });
  });
  await check("Withdrawal 12: reward coins cannot fund cash withdrawal", async () => {
    await assert.rejects(createWithdrawalRequest(regular, withdrawal(50000)), status(400));
    assert.deepEqual(await wallet(regular), { balance: 0, reserved: 0 });
  });
  await check("Access: normal user cannot review or read admin detail", async () => {
    const r = await createDepositRequest(regular, await deposit(regular));
    await assert.rejects(approveDepositRequest(regular, r.id, approved), status(403));
    await assert.rejects(adminMoneyDetail(regular, "DEPOSIT", r.id), status(403));
  });
  await check("Audit: all four actions include actor/email/time and request", async () => {
    const actions = (
      await pool.query(
        "SELECT action,admin_id,admin_email,created_at,request_id FROM cinevjet.money_audit",
      )
    ).rows;
    assert.deepEqual([...new Set(actions.map((r) => r.action))].sort(), [
      "DEPOSIT_APPROVED",
      "DEPOSIT_REJECTED",
      "WITHDRAWAL_COMPLETED",
      "WITHDRAWAL_REJECTED",
    ]);
    assert.ok(actions.every((r) => r.admin_id && r.admin_email && r.created_at && r.request_id));
    assert.equal(new Set(actions.map((r) => r.request_id)).size, actions.length);
  });
  await check("Summary: completed cash only, four periods and member detail", async () => {
    const d = await dashboardOverview(admin);
    assert.equal(d.moneyPeriods.length, 4);
    const db = (
      await pool.query(
        "SELECT (SELECT sum(amount) FROM cinevjet.deposits WHERE status='COMPLETED')::int income,(SELECT sum(amount-fee) FROM cinevjet.withdrawals WHERE status='COMPLETED')::int outgoing",
      )
    ).rows[0];
    assert.equal(d.metrics.income, db.income);
    assert.equal(d.metrics.outgoing, db.outgoing);
    assert.equal(d.moneyPeriods.find((p) => p.period === "TODAY")?.income, db.income);
    const m = await memberActivity(admin, regular);
    assert.equal(m.money.coins, 200);
    assert.equal(m.money.balance, 0);
    assert.ok(m.money.pending_deposits > 0);
  });
  await check("Atomic rollback: overflow leaves pending and no ledger/audit", async () => {
    const u = await user();
    await pool.query("UPDATE cinevjet.wallets SET balance=$1 WHERE user_id=$2", [
      String(Number.MAX_SAFE_INTEGER),
      u,
    ]);
    const r = await createDepositRequest(u, await deposit(u));
    await assert.rejects(approveDepositRequest(admin, r.id, approved), status(409));
    assert.deepEqual(await ledger(r.id), []);
    assert.equal((await userMoneyRequests(u))[0].status, "PENDING");
  });
  await check("Image: genuine JPG/PNG/WebP decode and normalize", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const bytes = await sharp({
        create: { width: 32, height: 20, channels: 3, background: "#222" },
      })
        [format]()
        .toBuffer();
      const prepared = await prepareBillImage(
        new File([bytes], `bill.${format}`, {
          type: format === "jpeg" ? "image/jpeg" : `image/${format}`,
        }),
      );
      assert.equal((await sharp(prepared.data).metadata()).format, "webp");
    }
  });
  await check("Image: extension, MIME, bytes and size mismatches rejected", async () => {
    for (const f of [
      new File(["<script>bad</script>"], "bill.png", { type: "image/png" }),
      new File(["x"], "bill.svg", { type: "image/svg+xml" }),
      new File([new Uint8Array(3145729)], "bill.jpg", { type: "image/jpeg" }),
      new File(["x"], "bill.exe", { type: "image/png" }),
      new File(["x"], "bill.png", { type: "application/pdf" }),
    ])
      await assert.rejects(prepareBillImage(f), status(400));
  });
  await check("Deposit: concurrent identical submissions use one request", async () => {
    const u = await user(),
      d = await deposit(u),
      r = await Promise.all([createDepositRequest(u, d), createDepositRequest(u, d)]);
    assert.equal(r[0].id, r[1].id);
  });
  await check("Withdrawal: concurrent same key reserves once", async () => {
    const u = await user(200000),
      d = withdrawal(),
      r = await Promise.all([createWithdrawalRequest(u, d), createWithdrawalRequest(u, d)]);
    assert.equal(r[0].id, r[1].id);
    assert.deepEqual(await wallet(u), { balance: 200000, reserved: 100000 });
  });
  await writeFile(
    "test-results/manual-money-server.json",
    JSON.stringify(
      {
        status: "PASS",
        tests: pass,
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
