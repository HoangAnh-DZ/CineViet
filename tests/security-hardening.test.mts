import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as liteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { ApiError, readBody, failure } from "../src/server/http";
import {
  throttleAuth,
  register,
  login,
  resolveSession,
  invalidateSession,
  createRegistrationChallenge,
  verifyRegistrationChallenge,
  digest,
} from "../src/server/auth-core";
import { clientAddress } from "../src/server/request-limit";
import { moneyConfig } from "../src/server/system-settings";
import { assertAdmin } from "../src/server/admin-core";
import { rewardsSnapshot, claimDailyCheckIn } from "../src/server/rewards";
import {
  missionsSnapshot,
  startRewardWatch,
  heartbeatRewardWatch,
  claimMission,
} from "../src/server/missions";
import { createRedemption } from "../src/server/redemption";
import { completeWithdrawal } from "../src/server/manual-money";
import { saveWatchProgress } from "../src/server/account";
import { savedBankAccountDetails, saveBankAccount } from "../src/server/bank-accounts";
import { createRewardCode, redeemRewardCode } from "../src/server/reward-codes";
import { paymentInput } from "../src/domain/payos";
import { sealBankDetails } from "../src/server/bank-secrets";
import { securityInventory } from "../scripts/security-inventory.mjs";
import { findMovie, playback } from "../src/server/catalog";
import { adminSystemSettings, updateSystemSettings } from "../src/server/system-settings";
import { updateVipPlan } from "../src/server/admin-plans";

process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.BANK_ACCOUNT_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
for (const key of Object.keys(process.env)) if (key.startsWith("PAYOS_")) delete process.env[key];
let pool: Pool | undefined, lite: PGlite | undefined, runtimePool: Pool | undefined;
if (process.env.SECURITY_TEST_DATABASE_URL) {
  const url = new URL(process.env.SECURITY_TEST_DATABASE_URL);
  assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
  assert.equal(url.pathname, "/security_audit_20261018");
  pool = new Pool({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 12,
    statement_timeout: 15000,
  });
} else lite = new PGlite();
async function q(text: string, values: unknown[] = []): Promise<{ rows: Record<string, any>[] }> {
  if (pool) return pool.query(text, values);
  if (!values.length && text.includes(";")) {
    const rows = await lite!.exec(text);
    return rows.at(-1) || { rows: [] };
  }
  return lite!.query(text, values);
}
if (
  !(await q("SELECT 1 FROM information_schema.schemata WHERE schema_name='cinevjet'")).rows.length
) {
  for (const f of (await readdir("database/migrations")).filter((f) => f.endsWith(".sql")).sort())
    await q(await readFile(`database/migrations/${f}`, "utf8"));
  await q(await readFile("database/seed.sql", "utf8"));
}
await q(
  `CREATE OR REPLACE FUNCTION cinevjet.reward_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT COALESCE(NULLIF(current_setting('cinevjet.security_test_now',true),'' )::timestamptz,clock_timestamp()) $$`,
);
await q(
  "UPDATE cinevjet.vip_plans SET reward_tier='FREE',checkin_rewards=ARRAY[200,300,500,700,1000,1300,2000],reward_enabled=true WHERE id='FREE'",
);
await q(
  "UPDATE cinevjet.system_settings SET deposit_enabled=true,withdrawal_enabled=true,bank_name='QA BANK',account_number='123456789',account_name='ISOLATED TEST' WHERE id='default'",
);
if (pool && process.env.SECURITY_QA_RUNTIME_ROLE) {
  const role = process.env.SECURITY_QA_RUNTIME_ROLE;
  assert.equal(role, "cinevjet_runtime_security_20261018");
  const policy = (await readFile("database/security/runtime-role.sql", "utf8")).replaceAll(
    "cinevjet_runtime",
    role,
  );
  if (!(await q("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rows.length) await q(policy);
  else await q(policy.slice(policy.indexOf("GRANT USAGE ON SCHEMA")).replace("COMMIT;", ""));
  const actor = (await q("SELECT current_user AS name")).rows[0].name;
  await q(`GRANT ${role} TO "${String(actor).replaceAll('"', '""')}"`);
  runtimePool = new Pool({
    connectionString: process.env.SECURITY_TEST_DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    max: 12,
    options: `-c role=${role}`,
    statement_timeout: 15000,
  });
  assert.equal((await runtimePool.query("SELECT current_user AS name")).rows[0].name, role);
}
const raw = pool
  ? pgDrizzle(runtimePool || pool)
  : (liteDrizzle(lite!) as unknown as NodePgDatabase);
let now = Date.parse("2030-10-18T03:00:00Z");
function clocked(db: NodePgDatabase) {
  return {
    execute: db.execute.bind(db),
    transaction: (fn: any, options: any) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('cinevjet.security_test_now',${new Date(now).toISOString()},true)`,
        );
        return fn(tx);
      }, options),
  } as NodePgDatabase;
}
const state = globalThis as typeof globalThis & { cinevjetDatabase: NodePgDatabase };
state.cinevjetDatabase = clocked(raw);
async function user(coins = 0, admin = false) {
  const id = randomUUID();
  await q(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,'unused','Security test')",
    [id, `${id}@example.invalid`],
  );
  await q("INSERT INTO cinevjet.coin_wallets(user_id,balance) VALUES($1,$2)", [id, coins]);
  await q("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
  if (coins)
    await q(
      "INSERT INTO cinevjet.coin_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES($1,$2,$3,'TEST','TEST',$4)",
      [randomUUID(), id, coins, randomUUID()],
    );
  if (admin) await q("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [id]);
  return id;
}
const wallet = async (id: string) =>
  (await q("SELECT balance::text,reserved::text FROM cinevjet.coin_wallets WHERE user_id=$1", [id]))
    .rows[0];
const rejection = (status: number) => (e: unknown) => e instanceof ApiError && e.status === status;

test("bounded JSON rejects oversized streams before full buffering, including fake Content-Length and multibyte data", async () => {
  let reads = 0,
    cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      reads++;
      c.enqueue(new Uint8Array(5000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const r = new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "1" },
    body,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(readBody(r), rejection(413));
  assert.ok(cancelled && reads <= 3);
  await assert.rejects(
    readBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("€".repeat(10)),
      }),
      20,
    ),
    rejection(413),
  );
  await assert.rejects(
    readBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/jsonp" },
        body: "{}",
      }),
    ),
    rejection(415),
  );
  await assert.rejects(
    readBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new Uint8Array([0xff]),
      }),
    ),
    rejection(400),
  );
  assert.deepEqual(
    await readBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: '{"ok":true}',
      }),
    ),
    { ok: true },
  );
});
test("distributed limit is atomic under concurrency, bounded, expires by database time and returns Retry-After", async () => {
  const id = randomUUID();
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => throttleAuth(id, 4, 1)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 4);
  const errors = results.filter((r) => r.status === "rejected");
  assert.equal(errors.length, 16);
  for (const e of errors) {
    const response = failure(e.reason);
    assert.equal(response.status, 429);
    assert.ok(
      Number(response.headers.get("Retry-After")) >= 1 &&
        Number(response.headers.get("Retry-After")) <= 60,
    );
  }
  const { digest } = await import("../src/server/auth-core");
  assert.equal(
    (await q("SELECT attempts FROM cinevjet.auth_limits WHERE key=$1", [digest(`auth:${id}`)]))
      .rows[0].attempts,
    5,
  );
  await q("UPDATE cinevjet.auth_limits SET window_start=now()-interval '2 minutes' WHERE key=$1", [
    digest(`auth:${id}`),
  ]);
  await throttleAuth(id, 4, 1);
});
test("only a Vercel platform address can select an IP bucket; arbitrary forwarded headers cannot", () => {
  const previous = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    const r = new Request("https://cine-vjet.cyou", {
      headers: { "x-forwarded-for": "1.2.3.4", "x-vercel-forwarded-for": "5.6.7.8" },
    });
    assert.equal(clientAddress(r), "local");
    process.env.VERCEL = "1";
    assert.equal(clientAddress(r), "5.6.7.8");
    assert.equal(
      clientAddress(
        new Request("https://cine-vjet.cyou", { headers: { "x-forwarded-for": "1.2.3.4" } }),
      ),
      "unknown",
    );
    assert.equal(
      clientAddress(
        new Request("https://cine-vjet.cyou", {
          headers: { "x-vercel-forwarded-for": "not-an-ip, 1.2.3.4" },
        }),
      ),
      "unknown",
    );
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});
test("registration responses contain only raster CAPTCHA, never its answer or a client-rendering seed", async () => {
  const challenge = await createRegistrationChallenge();
  assert.deepEqual(Object.keys(challenge).sort(), ["expires_at", "id", "image"]);
  const image = Buffer.from(challenge.image.split(",")[1], "base64");
  const info = await sharp(image).metadata();
  assert.equal(info.format, "png");
  assert.equal(info.width, 480);
  assert.equal(info.height, 144);
  assert.ok((await sharp(image).stats()).channels.some((c) => c.stdev > 10));
  assert.ok(!image.includes(Buffer.from("<svg")));
});
test("transaction configuration fails closed on missing settings or query failure; maintenance is respected", async () => {
  state.cinevjetDatabase = {
    execute: async () => {
      throw new Error("test-only database fault");
    },
  } as unknown as NodePgDatabase;
  await assert.rejects(moneyConfig(), rejection(503));
  state.cinevjetDatabase = { execute: async () => ({ rows: [] }) } as unknown as NodePgDatabase;
  await assert.rejects(moneyConfig(), rejection(503));
  state.cinevjetDatabase = clocked(raw);
  await q("UPDATE cinevjet.system_settings SET withdrawal_enabled=false WHERE id='default'");
  assert.equal((await moneyConfig()).withdrawal_enabled, false);
  await assert.rejects(
    createRedemption(await user(70000), {
      coins: 35000,
      bank_name: "TEST",
      account_number: "12345678",
      account_name: "TEST USER",
      idempotency_key: randomUUID(),
    }),
    rejection(503),
  );
  await q("UPDATE cinevjet.system_settings SET withdrawal_enabled=true WHERE id='default'");
});
test("fake admin flags do not grant a role; revocation and suspended sessions take effect immediately", async () => {
  const challenge = await createRegistrationChallenge();
  // Only the isolated fixture owner knows the answer; the app role consumes it normally.
  await q("UPDATE cinevjet.registration_challenges SET code_hash=$2 WHERE id=$1", [
    challenge.id,
    digest(`${challenge.id}:ABCD`),
  ]);
  await verifyRegistrationChallenge({ id: challenge.id, code: "ABCD" });
  await assert.rejects(
    verifyRegistrationChallenge({ id: challenge.id, code: "ABCD" }),
    rejection(400),
  );
  const result = await register({
    email: `${randomUUID()}@example.invalid`,
    password: "Isolated-Password-123",
    display_name: "Test",
    role: "admin",
    is_admin: true,
    balance: 99999999,
    coins: 99999999,
    vip_level: 6,
  });
  assert.deepEqual(await wallet(result.user.id), { balance: "0", reserved: "0" });
  await assert.rejects(assertAdmin(result.user.id), rejection(403));
  assert.ok(await resolveSession(result.session.token));
  await invalidateSession(result.session.token);
  assert.equal(await resolveSession(result.session.token), null);
  const signed = await login({ email: result.user.email, password: "Isolated-Password-123" });
  await q("UPDATE cinevjet.users SET status='SUSPENDED' WHERE id=$1", [result.user.id]);
  assert.equal(await resolveSession(signed.session.token), null);
  const admin = await user(0, true);
  await assertAdmin(admin);
  await q("DELETE FROM cinevjet.admin_users WHERE user_id=$1", [admin]);
  await assert.rejects(assertAdmin(admin), rejection(403));
});
test("history and bank ownership use the authenticated actor, SQL injection is data, payment fields are allowlisted", async () => {
  const a = await user(),
    b = await user();
  const movie = (
    await q(
      "SELECT id FROM cinevjet.movies WHERE type='MOVIE' AND status='PUBLISHED' AND NOT vip_required AND NOT is_demo LIMIT 1",
    )
  ).rows[0].id;
  assert.ok(await findMovie(movie));
  assert.ok((await playback(movie)).sources.length > 0);
  await saveWatchProgress(a, {
    movie_id: movie,
    user_id: b,
    position_seconds: 10,
    duration_seconds: 100,
  });
  assert.equal(
    (await q("SELECT count(*)::int n FROM cinevjet.watch_history WHERE user_id=$1", [b])).rows[0].n,
    0,
  );
  await assert.rejects(
    saveWatchProgress(a, { movie_id: "' OR 1=1 --", position_seconds: 10, duration_seconds: 100 }),
    rejection(404),
  );
  const bank = randomUUID();
  await q(
    "INSERT INTO cinevjet.user_bank_accounts(id,user_id,bank_code,bank_name,bank_label,details_ciphertext,account_last4,fingerprint)VALUES($1,$2,'970423','TEST','TEST',$3,'5678',$4)",
    [
      bank,
      b,
      await sealBankDetails(
        { account_number: "12345678", account_holder_name: "TEST" },
        `saved-bank:${b}:${bank}`,
      ),
      randomUUID(),
    ],
  );
  await assert.rejects(savedBankAccountDetails(raw, a, bank), rejection(404));
  assert.equal(
    paymentInput.safeParse({
      kind: "VIP_PURCHASE",
      plan_id: "VIP_1",
      amount: 1,
      payment_status: "PAID",
      idempotency_key: randomUUID(),
    }).success,
    false,
  );
});
test("mission spoofing, replay, calendar tampering, instant jumps and expired VIP cannot mint coins", async () => {
  now = Date.parse("2030-10-18T03:00:00Z");
  const id = await user();
  await q(
    "INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,status,started_at,expires_at)VALUES($1,$2,'VIP_1','ACTIVE',$3,$4)",
    [randomUUID(), id, new Date(now - 1000), new Date(now + 86400000)],
  );
  const first = (await missionsSnapshot(id)).missions[0];
  const day = "2030-10-18";
  for (const input of [
    { mission_id: first.id, calendar_date: day, reward: 999999 },
    { mission_id: first.id, calendar_date: day, status: "COMPLETED" },
    { mission_id: first.id, calendar_date: day, watched_seconds: 99999 },
    { mission_id: first.id, calendar_date: day, timezone: "UTC" },
  ])
    await assert.rejects(claimMission(id, input));
  await assert.rejects(
    claimMission(id, { mission_id: first.id, calendar_date: "2030-10-19" }),
    rejection(409),
  );
  await assert.rejects(
    claimMission(id, { mission_id: "OTHER_USER_MISSION", calendar_date: day }),
    rejection(404),
  );
  await assert.rejects(
    claimMission(id, { mission_id: first.id, calendar_date: day }),
    rejection(409),
  );
  const source = (
    await q(
      "SELECT v.id FROM cinevjet.video_sources v JOIN cinevjet.movies m ON m.id=v.movie_id WHERE m.type='MOVIE' AND m.status='PUBLISHED' AND NOT m.vip_required AND v.format='MP4' AND v.is_active LIMIT 1",
    )
  ).rows[0].id;
  let lease = await startRewardWatch(id, { source_id: source, position: 0 });
  await assert.rejects(startRewardWatch(id, { source_id: source, position: 0 }), rejection(409));
  await assert.rejects(
    heartbeatRewardWatch(await user(), { ...lease, position: 15, playing: true }),
    rejection(409),
  );
  now += 15000;
  lease = await heartbeatRewardWatch(id, { ...lease, position: 300, playing: true });
  assert.equal((await missionsSnapshot(id)).missions[0].watched_seconds, 0);
  now += 15000;
  lease = await heartbeatRewardWatch(id, { ...lease, position: 315, playing: true });
  now += 15000;
  const beat = { ...lease, position: 330, playing: true };
  lease = await heartbeatRewardWatch(id, beat);
  const total = (
    await q("SELECT watched_ms::int FROM cinevjet.daily_watch_progress WHERE user_id=$1", [id])
  ).rows[0].watched_ms;
  await heartbeatRewardWatch(id, beat);
  assert.equal(
    (await q("SELECT watched_ms::int FROM cinevjet.daily_watch_progress WHERE user_id=$1", [id]))
      .rows[0].watched_ms,
    total,
  );
  await assert.rejects(heartbeatRewardWatch(id, { ...beat, position: 331 }), rejection(409));
  await Promise.all(
    Array.from({ length: 8 }, () => claimMission(id, { mission_id: first.id, calendar_date: day })),
  );
  assert.equal((await wallet(id)).balance, String(first.reward));
  assert.equal(
    (await q("SELECT count(*)::int n FROM cinevjet.daily_mission_claims WHERE user_id=$1", [id]))
      .rows[0].n,
    1,
  );
  const valid = (await missionsSnapshot(id)).missions;
  assert.equal(valid.length, 5);
  await assert.rejects(
    claimMission(id, { mission_id: "VIP_1_TASK_25", calendar_date: day }),
    rejection(404),
  );
  now += 2 * 86400000;
  assert.deepEqual((await missionsSnapshot(id)).missions, []);
  await assert.rejects(
    claimMission(id, { mission_id: first.id, calendar_date: "2030-10-20" }),
    rejection(404),
  );
});
test("parallel redemptions cannot overspend; duplicate refund releases a hold only once", async () => {
  const id = await user(70000),
    admin = await user(0, true);
  const base = {
    coins: 35000,
    bank_name: "TEST BANK",
    account_number: "1234567890",
    account_name: "TEST USER",
  };
  await assert.rejects(createRedemption(id, { ...base, fee: 0, idempotency_key: randomUUID() }));
  const outcomes = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      createRedemption(id, { ...base, idempotency_key: randomUUID() }),
    ),
  );
  const accepted = outcomes.filter((r) => r.status === "fulfilled");
  assert.equal(accepted.length, 2);
  assert.deepEqual(await wallet(id), { balance: "70000", reserved: "70000" });
  const r = accepted[0].value;
  assert.equal(r.fee, 1400);
  const settled = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      completeWithdrawal(admin, r.id, { action: "REJECT", reason: "Test refund" }),
    ),
  );
  assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1);
  assert.deepEqual(await wallet(id), { balance: "70000", reserved: "35000" });
  await assert.rejects(
    completeWithdrawal(id, r.id, { action: "COMPLETE", confirmed: true }),
    rejection(403),
  );
});
test("cross-flow check-in/redemption and a mid-transaction failure preserve ledger invariants and safe retries", async () => {
  const id = await user(35000);
  now = Date.parse("2030-11-01T03:00:00Z");
  await Promise.all([
    claimDailyCheckIn(id),
    createRedemption(id, {
      coins: 35000,
      bank_name: "TEST BANK",
      account_number: "1234567890",
      account_name: "TEST USER",
      idempotency_key: randomUUID(),
    }),
  ]);
  assert.deepEqual(await wallet(id), { balance: "35200", reserved: "35000" });
  const fresh = await user();
  state.cinevjetDatabase = {
    ...clocked(raw),
    transaction: (fn: any, options: any) =>
      raw.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('cinevjet.security_test_now',${new Date(now).toISOString()},true)`,
        );
        await fn(tx);
        throw new Error("Test-only interrupted response");
      }, options),
  } as NodePgDatabase;
  await assert.rejects(claimDailyCheckIn(fresh), /Test-only/);
  state.cinevjetDatabase = clocked(raw);
  assert.deepEqual(await wallet(fresh), { balance: "0", reserved: "0" });
  assert.equal(
    (await q("SELECT count(*)::int n FROM cinevjet.coin_ledger WHERE user_id=$1", [fresh])).rows[0]
      .n,
    0,
  );
  await Promise.all([claimDailyCheckIn(fresh), claimDailyCheckIn(fresh)]);
  assert.equal((await wallet(fresh)).balance, "200");
  assert.equal(
    (await q("SELECT count(*)::int n FROM cinevjet.coin_ledger WHERE user_id=$1", [fresh])).rows[0]
      .n,
    1,
  );
  for (const statement of [
    "UPDATE cinevjet.coin_wallets SET balance=-1 WHERE user_id=$1",
    "UPDATE cinevjet.coin_wallets SET reserved=balance+1 WHERE user_id=$1",
    "UPDATE cinevjet.coin_wallets SET balance=9007199254740992 WHERE user_id=$1",
  ])
    await assert.rejects(q(statement, [fresh]));
});

test("runtime role supports Admin code issue, credit, encrypted bank save and completed redemption debit with append-only ledgers", async () => {
  const id = await user(70000),
    admin = await user(0, true);
  const config = await adminSystemSettings(admin);
  const fields = [
    "deposit_enabled",
    "withdrawal_enabled",
    "bank_name",
    "account_number",
    "account_name",
    "min_deposit",
    "min_withdrawal",
    "max_amount",
    "withdrawal_fee",
    "withdrawal_fee_bps",
  ];
  await updateSystemSettings(
    admin,
    Object.fromEntries(fields.map((key) => [key, config[key as keyof typeof config]])),
  );
  const plan = (
    await q(
      "SELECT name,price::float8,duration_days,active,purchase_enabled,mission_count,mission_reward::float8,additional_amount::float8 FROM cinevjet.vip_plans WHERE id='VIP_1'",
    )
  ).rows[0];
  assert.equal((await updateVipPlan(admin, "VIP_1", plan)).price, plan.price);
  const code = await createRewardCode(admin, { reward_coins: 100, max_redemptions: 2 });
  assert.equal((await redeemRewardCode(id, { code: code.code })).balance, 70100);
  await assert.rejects(redeemRewardCode(id, { code: code.code }), rejection(409));
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), "https://api.vietqr.io/v2/banks");
    return Response.json({
      code: "00",
      data: [
        {
          bin: "970423",
          code: "TPB",
          name: "QA Bank",
          shortName: "QA",
          logo: "https://example.invalid/logo.png",
          transferSupported: 1,
          lookupSupported: 1,
        },
      ],
    });
  }) as typeof fetch;
  try {
    const bank = await saveBankAccount(id, {
      bank_code: "970423",
      account_number: "1234567890",
      account_holder_name: "QA USER",
    });
    const stored = (
      await q("SELECT details_ciphertext FROM cinevjet.user_bank_accounts WHERE id=$1", [bank.id])
    ).rows[0];
    assert.ok(!stored.details_ciphertext.includes("1234567890"));
    const order = await createRedemption(id, {
      coins: 35000,
      bank_account_id: bank.id,
      idempotency_key: randomUUID(),
    });
    assert.deepEqual(await wallet(id), { balance: "70100", reserved: "35000" });
    const proof = randomUUID();
    await q(
      "INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height) VALUES($1,$2,'https://example.invalid/qa-evidence.webp','image/webp',100,10,10)",
      [proof, admin],
    );
    const evidence = {
      action: "COMPLETE",
      confirmed: true,
      evidence_reference: randomUUID(),
      proof_bill_id: proof,
    };
    await completeWithdrawal(admin, order.id, evidence);
    assert.deepEqual(await wallet(id), { balance: "35100", reserved: "0" });
    await assert.rejects(completeWithdrawal(admin, order.id, evidence), rejection(409));
    const ledger = (
      await q(
        "SELECT amount::text FROM cinevjet.coin_ledger WHERE user_id=$1 AND reference_type='REDEMPTION'",
        [id],
      )
    ).rows;
    assert.deepEqual(ledger, [{ amount: "-35000" }]);
  } finally {
    globalThis.fetch = previous;
  }
});
test("all API methods and database write sites are inventoried; direct sensitive methods retain server guards", async () => {
  const inventory = securityInventory();
  assert.equal(new Set(inventory.routes.map((r: any) => r.path)).size, 49);
  assert.equal(inventory.routes.length, 75);
  assert.deepEqual(inventory.serverActions, []);
  for (const route of inventory.routes) {
    if (route.path.startsWith("/api/demo/")) continue;
    if (route.path.startsWith("/api/admin/"))
      assert.ok(
        route.guards.includes("requireAdmin") || route.guards.includes("handleUpload"),
        route.file,
      );
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(route.method) &&
      !route.path.includes("/internal/") &&
      !route.path.endsWith("/payos/webhook")
    )
      assert.ok(route.guards.includes("checkOrigin"), route.file);
  }
  assert.ok(inventory.writes.some((w: any) => w.file === "src/server/payos-payments.ts"));
  assert.ok(inventory.writes.some((w: any) => w.file === "src/server/missions.ts"));
});
test(
  "least privilege policy supports real application writes but denies role grants, DDL and ledger tampering",
  { skip: !pool && "Requires isolated real PostgreSQL" },
  async () => {
    const role = "cinevjet_runtime_security_20261018";
    if (!(await q("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rows.length)
      await q(
        (await readFile("database/security/runtime-role.sql", "utf8")).replaceAll(
          "cinevjet_runtime",
          role,
        ),
      );
    const actor = (await q("SELECT current_user AS name")).rows[0].name;
    // Membership is only for exercising NOLOGIN rights on the nonproduction QA branch.
    await q(`GRANT ${role} TO "${String(actor).replaceAll('"', '""')}"`);
    const client = await pool!.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      state.cinevjetDatabase = clocked(pgDrizzle(client));
      const account = await register({
        email: `${randomUUID()}@example.invalid`,
        password: "Isolated-Password-123",
        display_name: "Least privilege test",
      });
      assert.ok(await resolveSession(account.session.token));
      await claimDailyCheckIn(account.user.id);
      assert.equal((await rewardsSnapshot(account.user.id)).wallet.balance, 200);
      for (const query of [
        "TRUNCATE cinevjet.coin_wallets",
        "INSERT INTO cinevjet.admin_users(user_id)VALUES('forbidden')",
        "DELETE FROM cinevjet.coin_ledger",
        "UPDATE cinevjet.coin_ledger SET amount=0",
        "DELETE FROM cinevjet.wallet_ledger",
        "UPDATE cinevjet.wallet_ledger SET amount=0",
        "DELETE FROM cinevjet.money_audit",
        "UPDATE cinevjet.users SET password_hash='forbidden'",
        "CREATE TABLE cinevjet.forbidden(id int)",
      ])
        await assert.rejects(client.query(query), (e: any) => e.code === "42501");
      const roleInfo = (
        await client.query(
          "SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0];
      assert.ok(Object.values(roleInfo).every((v) => v === false));
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM pg_tables WHERE schemaname='cinevjet' AND tableowner=current_user",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await client.query(
            "SELECT has_schema_privilege(current_user,'cinevjet','CREATE') AS allowed",
          )
        ).rows[0].allowed,
        false,
      );
      assert.equal(
        (
          await client.query(
            "SELECT has_sequence_privilege(current_user,'cinevjet.payos_order_code','USAGE') AS allowed",
          )
        ).rows[0].allowed,
        true,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='cinevjet' AND (p.prosecdef OR NOT has_function_privilege(current_user,p.oid,'EXECUTE'))",
          )
        ).rows[0].n,
        0,
      );
    } finally {
      state.cinevjetDatabase = clocked(raw);
      await client.query("RESET ROLE");
      client.release();
    }
  },
);
test.after(async () => {
  if (runtimePool) await runtimePool.end();
  if (pool) await pool.end();
  else await lite!.close();
});
