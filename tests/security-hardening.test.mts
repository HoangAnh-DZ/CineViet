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
import {
  completeWithdrawal,
  adminMoneyDetail,
  createWithdrawalRequest,
  userMoneyRequests,
} from "../src/server/manual-money";
import { saveWatchProgress } from "../src/server/account";
import { savedBankAccountDetails, saveBankAccount } from "../src/server/bank-accounts";
import { createRewardCode, redeemRewardCode } from "../src/server/reward-codes";
import { paymentInput } from "../src/domain/payos";
import { sealBankDetails, withdrawalBankDetails } from "../src/server/bank-secrets";
import { verifiedWatchMs, watchDaySegments } from "../src/domain/watch-rewards";
import { securityInventory } from "../scripts/security-inventory.mjs";
import { findMovie, playback } from "../src/server/catalog";
import { adminSystemSettings, updateSystemSettings } from "../src/server/system-settings";
import { updateVipPlan } from "../src/server/admin-plans";
import { configureSocialSync, runSocialSync } from "../src/server/social-shorts";
import {
  recordRewardRisk,
  rewardRiskSummary,
  scrubRewardRiskCounters,
} from "../src/server/reward-risk";
import {
  rewardCodeCreateSchema,
  rewardCodeRedeemSchema,
  registrationSchema,
} from "../src/server/validation";

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
  assert.ok(
    ["cinevjet_runtime_security_20261018", "cinevjet_runtime_review_20261018"].includes(role),
  );
  const policyFile = role.includes("_review_")
    ? "database/security/runtime-role-candidate.sql"
    : "database/security/runtime-role.sql";
  const policy = (await readFile(policyFile, "utf8")).replaceAll("cinevjet_runtime", role);
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
  await assert.rejects(
    register({
      email: `${randomUUID()}@example.invalid`,
      password: "Isolated-Password-123",
      display_name: "Test",
      role: "admin",
      is_admin: true,
      balance: 99999999,
      coins: 99999999,
      vip_level: 6,
    }),
  );
  const result = await register({
    email: `${randomUUID()}@example.invalid`,
    password: "Isolated-Password-123",
    display_name: "Test",
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
      "INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height) VALUES($1,$2,$3,'image/webp',100,10,10)",
      [proof, admin, `https://example.invalid/${proof}.webp`],
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
  assert.equal(new Set(inventory.routes.map((r: any) => r.path)).size, 52);
  assert.equal(inventory.routes.length, 81);
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
    const role = process.env.SECURITY_QA_RUNTIME_ROLE || "cinevjet_runtime_security_20261018";
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
        role.includes("_review_") ? 3 : 0,
      );
    } finally {
      state.cinevjetDatabase = clocked(raw);
      await client.query("RESET ROLE");
      client.release();
    }
  },
);
test("VIP 1–6 use exact numeric task IDs and unchanged contract rewards in snapshot and claim", async () => {
  now = Date.parse("2031-04-01T03:00:00Z");
  for (const [index, count] of [5, 8, 12, 16, 20, 25].entries()) {
    const tier = `VIP_${index + 1}`,
      id = await user();
    await q(
      "INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,status,started_at,expires_at)VALUES($1,$2,$3,'ACTIVE',$4,$5)",
      [randomUUID(), id, tier, new Date(now - 1000), new Date(now + 86400000)],
    );
    await q(
      "INSERT INTO cinevjet.daily_watch_progress(user_id,calendar_date,watched_ms)VALUES($1,'2031-04-01',750000)",
      [id],
    );
    const contract = (
      await q("SELECT mission_reward::text FROM cinevjet.vip_plans WHERE id=$1", [tier])
    ).rows[0];
    const s = await missionsSnapshot(id);
    assert.deepEqual(
      s.missions.map((m) => m.id),
      Array.from({ length: count }, (_, n) => `${tier}_TASK_${n + 1}`),
    );
    assert.deepEqual(
      s.missions.map((m) => m.target_seconds),
      Array.from({ length: count }, (_, n) => (n + 1) * 30),
    );
    assert.ok(s.missions.every((m) => m.reward === Number(contract.mission_reward)));
    await Promise.all(
      Array.from({ length: 4 }, () =>
        claimMission(id, { mission_id: `${tier}_TASK_2`, calendar_date: s.calendar_date }),
      ),
    );
    assert.equal((await wallet(id)).balance, contract.mission_reward);
    if (count >= 10) {
      await claimMission(id, { mission_id: `${tier}_TASK_10`, calendar_date: s.calendar_date });
      assert.equal((await wallet(id)).balance, String(Number(contract.mission_reward) * 2));
    } else
      await assert.rejects(
        claimMission(id, { mission_id: `${tier}_TASK_10`, calendar_date: s.calendar_date }),
        rejection(404),
      );
  }
});
test("malformed task suffixes and wildcard-like tiers are not part of the mission contract", async () => {
  for (const id of [
    "VIPX1_TASK_2",
    "VIP_1_TASK_2_JUNK",
    "VIP_1_TASK_02",
    "VIP_1_TASK_999999999999999999999",
  ])
    await q(
      "INSERT INTO cinevjet.daily_missions(id,target_seconds,reward,enabled)VALUES($1,30,1,true) ON CONFLICT(id)DO NOTHING",
      [id],
    );
  const id = await user();
  await q(
    "INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,status,started_at,expires_at)VALUES($1,$2,'VIP_1','ACTIVE',$3,$4)",
    [randomUUID(), id, new Date(now - 1000), new Date(now + 86400000)],
  );
  assert.deepEqual(
    (await missionsSnapshot(id)).missions.map((m) => m.id),
    Array.from({ length: 5 }, (_, n) => `VIP_1_TASK_${n + 1}`),
  );
});
test("legacy lexicographic claims are not rewritten or granted a second daily allowance", async () => {
  const id = await user();
  await q(
    "INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,status,started_at,expires_at)VALUES($1,$2,'VIP_1','ACTIVE',$3,$4)",
    [randomUUID(), id, new Date(now - 1000), new Date(now + 86400000)],
  );
  for (const n of [1, 10, 11, 12, 13])
    await q(
      "INSERT INTO cinevjet.daily_mission_claims(id,user_id,mission_id,calendar_date,reward,created_at)VALUES($1,$2,$3,'2031-04-01',1,now())",
      [randomUUID(), id, `VIP_1_TASK_${n}`],
    );
  await q(
    "INSERT INTO cinevjet.daily_watch_progress(user_id,calendar_date,watched_ms)VALUES($1,'2031-04-01',750000)",
    [id],
  );
  await assert.rejects(
    claimMission(id, { mission_id: "VIP_1_TASK_2", calendar_date: "2031-04-01" }),
    rejection(409),
  );
  assert.equal((await wallet(id)).balance, "0");
  assert.equal(
    (await q("SELECT count(*)::int n FROM cinevjet.daily_mission_claims WHERE user_id=$1", [id]))
      .rows[0].n,
    5,
  );
});
test("database time controls midnight, stale/future days, client timezone/clock and VIP expiry", async () => {
  now = Date.parse("2031-04-02T16:59:50Z");
  const id = await user();
  await q(
    "INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,status,started_at,expires_at)VALUES($1,$2,'VIP_1','ACTIVE',$3,$4)",
    [randomUUID(), id, new Date(now - 1000), new Date(now + 60000)],
  );
  const source = (
    await q(
      "SELECT v.id FROM cinevjet.video_sources v JOIN cinevjet.movies m ON m.id=v.movie_id WHERE v.is_active AND v.format='MP4' AND NOT m.vip_required AND m.status='PUBLISHED' AND m.type='MOVIE' AND v.episode_id IS NULL AND COALESCE(m.duration_seconds,m.duration_minutes*60)>60 LIMIT 1",
    )
  ).rows[0].id;
  let lease = await startRewardWatch(id, { source_id: source, position: 0 });
  await assert.rejects(startRewardWatch(id, { source_id: source, position: 0 }), rejection(409));
  now += 15000;
  const body = { ...lease, position: 15, playing: true };
  const replies = await Promise.all(
    Array.from({ length: 5 }, () => heartbeatRewardWatch(id, body)),
  );
  lease = replies[0];
  assert.ok(replies.every((r) => r.nonce === lease.nonce));
  const progress = (
    await q(
      "SELECT calendar_date::text,watched_ms::text FROM cinevjet.daily_watch_progress WHERE user_id=$1 ORDER BY calendar_date",
      [id],
    )
  ).rows;
  assert.deepEqual(progress, [
    { calendar_date: "2031-04-02", watched_ms: "10000" },
    { calendar_date: "2031-04-03", watched_ms: "5000" },
  ]);
  for (const day of ["2031-04-02", "2031-04-04"])
    await assert.rejects(
      claimMission(id, { mission_id: "VIP_1_TASK_1", calendar_date: day }),
      rejection(409),
    );
  await assert.rejects(
    claimMission(id, { mission_id: "VIP_1_TASK_1", calendar_date: "2031-04-03", timezone: "UTC" }),
  );
  await assert.rejects(
    heartbeatRewardWatch(id, { ...lease, position: 30, playing: true, at: 9999999999999 }),
  );
  const oldNow = Date.now;
  try {
    Date.now = () => Date.parse("2100-01-01");
    assert.equal((await missionsSnapshot(id)).calendar_date, "2031-04-03");
    await Promise.all(Array.from({ length: 6 }, () => claimDailyCheckIn(id)));
    assert.equal((await wallet(id)).balance, "200");
    now += 60000;
    assert.deepEqual((await missionsSnapshot(id)).missions, []);
  } finally {
    Date.now = oldNow;
  }
  assert.equal(
    (await q("SELECT count(*)::int n FROM cinevjet.daily_checkins WHERE user_id=$1", [id])).rows[0]
      .n,
    1,
  );
});
test("check-in retries on both sides of Vietnam midnight credit exactly one reward per server date", async () => {
  const id = await user();
  now = Date.parse("2031-04-04T16:59:59.900Z");
  await Promise.all(Array.from({ length: 5 }, () => claimDailyCheckIn(id)));
  now += 200;
  await Promise.all(Array.from({ length: 5 }, () => claimDailyCheckIn(id)));
  assert.equal((await wallet(id)).balance, "500");
  assert.equal(
    (await q("SELECT count(*)::int n FROM cinevjet.coin_ledger WHERE user_id=$1", [id])).rows[0].n,
    2,
  );
});
test("playback signals are bounded at actual media end and every credited segment uses server elapsed time", () => {
  assert.equal(
    verifiedWatchMs(
      { at: 0, position: 90, playing: true },
      { at: 15000, position: 105, playing: true },
      100,
    ),
    0,
  );
  assert.equal(
    verifiedWatchMs(
      { at: 0, position: 90, playing: true },
      { at: 15000, position: 101, playing: false },
      100,
    ),
    10000,
  );
  assert.equal(
    verifiedWatchMs(
      { at: 0, position: 100, playing: true },
      { at: 15000, position: 101, playing: true },
      100,
    ),
    0,
  );
  assert.equal(
    verifiedWatchMs(
      { at: 15000, position: 0, playing: true },
      { at: 0, position: 15, playing: true },
      100,
    ),
    0,
  );
  assert.equal(
    watchDaySegments(0, 15000, 90000).reduce((n, r) => n + r.ms, 0),
    15000,
  );
});
test("direct Coins and VND bank snapshots are encrypted, masked, bound to owner/order and immutable on retry", async () => {
  const id = await user(70000),
    admin = await user(0, true),
    other = await user();
  const input = {
    coins: 35000,
    bank_name: "QA BANK",
    account_number: "001234567890",
    account_name: "QA PRIVATE HOLDER",
    idempotency_key: randomUUID(),
  };
  const created = await createRedemption(id, input);
  const r = (await q("SELECT * FROM cinevjet.withdrawals WHERE id=$1", [created.id])).rows[0];
  assert.ok(!JSON.stringify(r).includes(input.account_number));
  assert.ok(!JSON.stringify(r).includes(input.account_name));
  assert.ok(r.destination.startsWith("bank-snapshot:v1:"));
  assert.equal(r.bank_snapshot_ciphertext, null);
  assert.equal(created.bank_account_number, "••••7890");
  assert.equal(created.bank_account_name, null);
  assert.equal((await createRedemption(id, input)).id, created.id);
  await assert.rejects(createRedemption(other, input), rejection(409));
  await assert.rejects(
    createRedemption(id, { ...input, account_number: "9999999999" }),
    rejection(409),
  );
  await assert.rejects(adminMoneyDetail(id, "WITHDRAWAL", created.id), rejection(403));
  assert.equal(
    (await adminMoneyDetail(admin, "WITHDRAWAL", created.id)).bank_account_number,
    input.account_number,
  );
  await assert.rejects(withdrawalBankDetails({ ...r, user_id: other }), rejection(503));
  await assert.rejects(withdrawalBankDetails({ ...r, id: randomUUID() }), rejection(503));
  assert.ok(!JSON.stringify(await userMoneyRequests(id)).includes(input.account_number));
  await q("UPDATE cinevjet.wallets SET balance=70000 WHERE user_id=$1", [id]);
  const cash = await createWithdrawalRequest(id, {
    amount: 35000,
    bank_name: input.bank_name,
    account_number: input.account_number,
    account_name: input.account_name,
    idempotency_key: randomUUID(),
  });
  assert.equal(
    (await adminMoneyDetail(admin, "WITHDRAWAL", cash.id)).bank_account_number,
    input.account_number,
  );
  assert.ok(
    !JSON.stringify(
      (await q("SELECT * FROM cinevjet.withdrawals WHERE id=$1", [cash.id])).rows[0],
    ).includes(input.account_number),
  );
  const legacy = {
    id: randomUUID(),
    user_id: id,
    bank_account_number: "001234567891",
    bank_account_name: "LEGACY QA",
    destination: "old bank destination",
  };
  assert.equal((await withdrawalBankDetails(legacy)).account_number, "001234567891");
});
test(
  "candidate role refuses unnecessary sensitive columns and trigger-function execution",
  { skip: !runtimePool || !process.env.SECURITY_QA_RUNTIME_ROLE?.includes("_review_") },
  async () => {
    for (const query of [
      "UPDATE cinevjet.vip_plans SET reward_tier='FREE'",
      "UPDATE cinevjet.system_settings SET id='other'",
      "UPDATE cinevjet.payos_orders SET amount=1",
      "UPDATE cinevjet.vip_subscriptions SET expires_at=now()+interval '1 year'",
      "UPDATE cinevjet.withdrawals SET destination='forged'",
      "SELECT cinevjet.capture_vip_purchase_contract()",
    ])
      await assert.rejects(runtimePool!.query(query), (e: any) => e.code === "42501");
  },
);

test("candidate role supports authorized Shorts Admin configuration and cron lease lifecycle", async () => {
  const admin = await user(0, true);
  await q(
    "UPDATE cinevjet.short_sync_control SET starts_at=now(),ends_at=now()+interval '30 days',leased_until=NULL WHERE id='default'",
  );
  await configureSocialSync(admin, { enabled: true, daily_target: 1 });
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  try {
    const result = await runSocialSync("CRON");
    assert.notEqual(result.status, "FAILED");
    assert.equal("error" in result ? result.error : null, null);
  } finally {
    globalThis.fetch = previous;
  }
});

test("expired leases cannot rotate nonce, resurrect by retry or overlap a new atomic session", async () => {
  now = Date.parse("2033-01-01T03:00:00Z");
  const id = await user();
  const source = (
    await q(`SELECT v.id FROM cinevjet.video_sources v JOIN cinevjet.movies m ON m.id=v.movie_id
    WHERE v.is_active AND v.format='MP4' AND NOT m.vip_required AND m.status='PUBLISHED' AND m.type='MOVIE'
    AND v.episode_id IS NULL AND COALESCE(m.duration_seconds,m.duration_minutes*60)>120 LIMIT 1`)
  ).rows[0].id;
  const starts = await Promise.allSettled(
    Array.from({ length: 4 }, () => startRewardWatch(id, { source_id: source, position: 0 })),
  );
  const accepted = starts.filter((r) => r.status === "fulfilled");
  assert.equal(accepted.length, 1);
  const first = (accepted[0] as PromiseFulfilledResult<{ session_id: string; nonce: string }>)
    .value;
  now += 15000;
  const body = { ...first, position: 15, playing: true };
  const second = await heartbeatRewardWatch(id, body);
  const before = (await q("SELECT * FROM cinevjet.reward_watch_sessions WHERE user_id=$1", [id]))
    .rows[0];
  now += 35000;
  for (const payload of [body, { ...second, position: 50, playing: true }])
    await assert.rejects(heartbeatRewardWatch(id, payload), rejection(409));
  assert.deepEqual(
    (await q("SELECT * FROM cinevjet.reward_watch_sessions WHERE user_id=$1", [id])).rows[0],
    before,
  );
  const fresh = await startRewardWatch(id, { source_id: source, position: 50 });
  await assert.rejects(
    heartbeatRewardWatch(id, { ...second, position: 65, playing: true }),
    rejection(409),
  );
  now += 15000;
  const next = await heartbeatRewardWatch(id, { ...fresh, position: 65, playing: true });
  // Old out-of-order nonce and same nonce with a different payload cannot write.
  await assert.rejects(
    heartbeatRewardWatch(id, { ...fresh, position: 66, playing: true }),
    rejection(409),
  );
  assert.equal(
    (
      await q("SELECT watched_ms::int AS ms FROM cinevjet.daily_watch_progress WHERE user_id=$1", [
        id,
      ])
    ).rows[0].ms,
    30000,
  );
  const last = (await q("SELECT nonce FROM cinevjet.reward_watch_sessions WHERE user_id=$1", [id]))
    .rows[0];
  assert.equal(String(last.nonce), next.nonce);
  assert.deepEqual(await wallet(id), { balance: "0", reserved: "0" });
});

test("pause/buffering, resume, long heartbeat gaps and source takeover never credit missing intervals", async () => {
  now = Date.parse("2033-01-02T03:00:00Z");
  const id = await user();
  const sources = (
    await q(`SELECT v.id FROM cinevjet.video_sources v JOIN cinevjet.movies m ON m.id=v.movie_id
    WHERE v.is_active AND v.format='MP4' AND NOT m.vip_required AND m.status='PUBLISHED' AND m.type='MOVIE'
    AND v.episode_id IS NULL AND COALESCE(m.duration_seconds,m.duration_minutes*60)>120 LIMIT 2`)
  ).rows;
  assert.equal(sources.length, 2);
  let lease = await startRewardWatch(id, { source_id: sources[0].id, position: 0 });
  now += 15000;
  lease = await heartbeatRewardWatch(id, { ...lease, position: 15, playing: false });
  now += 15000;
  lease = await heartbeatRewardWatch(id, { ...lease, position: 15, playing: false });
  now += 15000;
  lease = await heartbeatRewardWatch(id, { ...lease, position: 15, playing: true });
  now += 31000;
  lease = await heartbeatRewardWatch(id, { ...lease, position: 46, playing: true });
  now += 15000;
  lease = await heartbeatRewardWatch(id, { ...lease, position: 61, playing: false });
  const changed = await startRewardWatch(id, { source_id: sources[1].id, position: 0 });
  await assert.rejects(
    heartbeatRewardWatch(id, { ...lease, position: 76, playing: true }),
    rejection(409),
  );
  now += 15000;
  await heartbeatRewardWatch(id, { ...changed, position: 15, playing: true });
  assert.equal(
    (
      await q("SELECT watched_ms::int AS ms FROM cinevjet.daily_watch_progress WHERE user_id=$1", [
        id,
      ])
    ).rows[0].ms,
    45000,
  );
});

test("risk counters are bounded, pseudonymous, admin-only, expire and scrub without financial penalties", async () => {
  const id = await user(70000),
    admin = await user(0, true);
  await Promise.all(
    Array.from({ length: 10 }, () => recordRewardRisk(id, ["invalid_nonce", "progress_anomaly"])),
  );
  const suspicious = await rewardRiskSummary(admin, id);
  assert.equal(suspicious.level, "SUSPICIOUS");
  assert.equal(suspicious.counts.invalid_nonce, 10);
  await Promise.all(Array.from({ length: 20 }, () => recordRewardRisk(id, ["invalid_nonce"])));
  assert.equal((await rewardRiskSummary(admin, id)).level, "HIGH_RISK");
  await assert.rejects(rewardRiskSummary(id, id), rejection(403));
  const prefix = `risk:v1:${digest(`reward-risk:v1:${id}`)}:`;
  const rows = (
    await q("SELECT key,attempts FROM cinevjet.auth_limits WHERE key LIKE $1", [prefix + "%"])
  ).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !r.key.includes(id) && r.attempts <= 65535));
  await q(
    "UPDATE cinevjet.auth_limits SET window_start=now()-interval '25 hours' WHERE key LIKE $1",
    [prefix + "%"],
  );
  const expired = await rewardRiskSummary(admin, id);
  assert.equal(expired.level, "NORMAL");
  assert.ok(Object.values(expired.counts).every((n) => n === 0));
  await scrubRewardRiskCounters();
  assert.equal(
    (
      await q("SELECT sum(attempts)::int n FROM cinevjet.auth_limits WHERE key LIKE $1", [
        prefix + "%",
      ])
    ).rows[0].n,
    0,
  );
  assert.deepEqual(await wallet(id), { balance: "70000", reserved: "0" });
  assert.equal(
    (await q("SELECT status FROM cinevjet.users WHERE id=$1", [id])).rows[0].status,
    "ACTIVE",
  );
});

test("strict reward/auth inputs and database-time reward-code expiry reject spoofing without wallet changes", async () => {
  now = Date.parse("2033-01-03T03:00:00Z");
  const id = await user(),
    admin = await user(0, true);
  for (const field of [
    "reward",
    "balance",
    "role",
    "user_id",
    "vip_expires_at",
    "completed_at",
    "status",
    "watched_seconds",
  ])
    assert.equal(
      rewardCodeRedeemSchema.safeParse({ code: "CVJ-ABCDEF", [field]: 99999999 }).success,
      false,
    );
  assert.equal(
    rewardCodeCreateSchema.safeParse({ reward_coins: 100, role: "admin" }).success,
    false,
  );
  assert.equal(
    registrationSchema.safeParse({
      email: `${randomUUID()}@example.invalid`,
      password: "Test-password-123",
      display_name: "Test",
      role: "admin",
    }).success,
    false,
  );
  const expired = await createRewardCode(admin, {
    reward_coins: 100,
    expires_at: new Date(now - 1000).toISOString(),
  });
  const valid = await createRewardCode(admin, {
    reward_coins: 100,
    max_redemptions: 10,
    expires_at: new Date(now + 60000).toISOString(),
  });
  const oldNow = Date.now;
  try {
    Date.now = () => 0;
    await assert.rejects(redeemRewardCode(id, { code: expired.code }), rejection(400));
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () => redeemRewardCode(id, { code: valid.code })),
    );
    assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  } finally {
    Date.now = oldNow;
  }
  assert.deepEqual(await wallet(id), { balance: "100", reserved: "0" });
  assert.equal(
    (await q("SELECT count(*)::int n FROM cinevjet.coin_ledger WHERE user_id=$1", [id])).rows[0].n,
    1,
  );
});

test("telemetry failure cannot roll back an earned mission or turn its retry into a second credit", async () => {
  now = Date.parse("2033-01-04T03:00:00Z");
  const id = await user();
  await q(
    "INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,status,started_at,expires_at)VALUES($1,$2,'VIP_1','ACTIVE',$3,$4)",
    [randomUUID(), id, new Date(now - 1000), new Date(now + 86400000)],
  );
  await q(
    "INSERT INTO cinevjet.daily_watch_progress(user_id,calendar_date,watched_ms)VALUES($1,'2033-01-04',30000)",
    [id],
  );
  const expected = (await missionsSnapshot(id)).missions[0].reward;
  state.cinevjetDatabase = {
    ...clocked(raw),
    execute: async () => {
      throw new Error("QA telemetry unavailable");
    },
  } as NodePgDatabase;
  try {
    await claimMission(id, { mission_id: "VIP_1_TASK_1", calendar_date: "2033-01-04" });
    await claimMission(id, { mission_id: "VIP_1_TASK_1", calendar_date: "2033-01-04" });
  } finally {
    state.cinevjetDatabase = clocked(raw);
  }
  assert.equal((await wallet(id)).balance, String(expected));
  assert.equal(
    (await q("SELECT count(*)::int n FROM cinevjet.coin_ledger WHERE user_id=$1", [id])).rows[0].n,
    1,
  );
});
test.after(async () => {
  if (runtimePool) await runtimePool.end();
  if (pool) await pool.end();
  else await lite!.close();
});
