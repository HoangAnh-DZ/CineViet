import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { securityInventory } from "./security-inventory.mjs";

// This runner cannot target a production database or a remote website.
const url = new URL(process.env.SECURITY_TEST_DATABASE_URL);
assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
assert.equal(url.pathname, "/security_audit_20261018");
const pool = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 2,
});
const role = "cinevjet_runtime_security_20261018";
const policy = fs
  .readFileSync("database/security/runtime-role.sql", "utf8")
  .replaceAll("cinevjet_runtime", role);
await pool.query(policy.slice(policy.indexOf("GRANT USAGE ON SCHEMA")).replace("COMMIT;", ""));
url.searchParams.set("options", `-c role=${role}`);
const base = "http://127.0.0.1:3018",
  secret = randomBytes(48).toString("base64url");
const password = randomBytes(24).toString("base64url"),
  passwordHash = await hash(password, 12);
const a = randomUUID(),
  b = randomUUID(),
  email = `${a}@example.invalid`;
for (const id of [a, b]) {
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name)VALUES($1,$2,$3,'HTTP security test')",
    [id, `${id}@example.invalid`, passwordHash],
  );
  await pool.query("INSERT INTO cinevjet.coin_wallets(user_id,balance)VALUES($1,100000)", [id]);
  await pool.query("INSERT INTO cinevjet.wallets(user_id)VALUES($1)", [id]);
  await pool.query(
    "INSERT INTO cinevjet.coin_ledger(id,user_id,amount,type,reference_type,reference_id)VALUES($1,$2,100000,'TEST','TEST',$3)",
    [randomUUID(), id, randomUUID()],
  );
}
const log = fs.openSync(".vercel/security-http-server.log", "w");
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3018"],
  {
    windowsHide: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL: "0",
      VERCEL_ENV: "development",
      DATABASE_URL: url.toString(),
      AUTH_SECRET: secret,
      NEXT_PUBLIC_APP_URL: base,
      PAYOS_CLIENT_ID: "",
      PAYOS_API_KEY: "",
      PAYOS_CHECKSUM_KEY: "",
      PAYOS_PAYOUT_CLIENT_ID: "",
      PAYOS_PAYOUT_API_KEY: "",
      PAYOS_PAYOUT_CHECKSUM_KEY: "",
      PAYOS_AUTO_PAYOUT_ENABLED: "false",
      PAYOS_PAYOUT_ACCESS_VERIFIED: "false",
      BLOB_READ_WRITE_TOKEN: "",
      CRON_SECRET: randomUUID(),
    },
  },
);
let checks = 0;
async function request(path, method = "GET", body, cookie = "", origin = base) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method !== "GET" ? { Origin: origin, "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return response;
}
try {
  let ready = false;
  for (let n = 0; n < 50; n++) {
    try {
      const r = await request("/api/auth/session");
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, "isolated server must start");
  const page = await request("/login");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.ok(page.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
  checks += 3;
  const signed = await request("/api/auth/login", "POST", { email, password, remember: false });
  assert.equal(signed.status, 200);
  const cookies = signed.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith("__Host-cinevjet_session="));
  assert.ok(session);
  assert.ok(
    /HttpOnly/i.test(session) &&
      /Secure/i.test(session) &&
      /SameSite=Lax/i.test(session) &&
      !/(?:^|;)\s*Domain=/i.test(session),
  );
  const cookie = session.split(";")[0];
  checks += 2;
  const inventory = securityInventory();
  for (const route of inventory.routes.filter((r) => r.path.startsWith("/api/admin/"))) {
    const path = route.path.replace("[kind]", "WITHDRAWAL").replaceAll("[id]", randomUUID());
    const body = ["POST", "PUT", "PATCH"].includes(route.method) ? {} : undefined;
    for (const actor of ["", cookie]) {
      const r = await request(path, route.method, body, actor);
      if (path === "/api/admin/shorts/uploads") assert.ok([400, 401, 403, 503].includes(r.status));
      else assert.equal(r.status, actor ? 403 : 401, `${route.method} ${path}`);
      await r.arrayBuffer();
      checks++;
    }
  }
  for (const path of [
    "/api/rewards",
    "/api/rewards/missions",
    "/api/rewards/redemptions",
    "/api/library",
    "/api/money/requests",
    "/api/vip/purchases",
    "/api/payments/payos?plan_id=VIP_1",
  ]) {
    const r = await request(path);
    assert.equal(r.status, 401, path);
    checks++;
    await r.arrayBuffer();
  }
  // Only the fixture owner may grant/revoke Admin. The runtime role merely checks it.
  await pool.query("INSERT INTO cinevjet.admin_users(user_id)VALUES($1)", [a]);
  for (const path of [
    "/api/admin/settings",
    "/api/admin/users",
    "/api/admin/reward-codes",
    "/api/admin/vip-plans",
    "/api/admin/shorts",
    "/api/admin/dashboard",
  ]) {
    const route = inventory.routes.find((r) => r.path === path && r.method === "GET");
    if (!route) continue;
    const r = await request(path, "GET", undefined, cookie);
    assert.equal(r.status, 200, path);
    await r.arrayBuffer();
    checks++;
  }
  await pool.query("DELETE FROM cinevjet.admin_users WHERE user_id=$1", [a]);
  assert.equal((await request("/api/admin/users", "GET", undefined, cookie)).status, 403);
  checks++;
  const film = (
    await pool.query(
      "SELECT id,slug FROM cinevjet.movies WHERE type='MOVIE' AND status='PUBLISHED' AND NOT vip_required AND NOT is_demo LIMIT 1",
    )
  ).rows[0];
  for (const path of ["/movie/" + film.slug, "/watch/" + film.slug]) {
    const r = await request(path, "GET", undefined, cookie);
    assert.equal(r.status, 200, path);
    await r.arrayBuffer();
    checks++;
  }
  assert.equal(
    (
      await request(
        "/api/progress",
        "PUT",
        { movie_id: film.id, position_seconds: 15, duration_seconds: 120 },
        cookie,
      )
    ).status,
    200,
  );
  checks++;
  assert.equal(
    (
      await pool.query(
        "SELECT position_seconds FROM cinevjet.watch_history WHERE user_id=$1 AND movie_id=$2",
        [a, film.id],
      )
    ).rows[0].position_seconds,
    15,
  );
  checks++;
  const csrf = await request(
    "/api/account",
    "PATCH",
    { display_name: "Forbidden" },
    cookie,
    "https://evil.invalid",
  );
  assert.equal(csrf.status, 403);
  checks++;
  const patched = await request(
    "/api/account",
    "PATCH",
    {
      display_name: "Safe test name",
      role: "admin",
      is_admin: true,
      coins: 99999999,
      balance: 99999999,
      user_id: b,
    },
    cookie,
  );
  assert.equal(patched.status, 200);
  const actual = (await pool.query("SELECT display_name FROM cinevjet.users WHERE id=$1", [b]))
    .rows[0];
  assert.equal(actual.display_name, "HTTP security test");
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM cinevjet.admin_users WHERE user_id=$1", [a]))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await pool.query("SELECT balance::text FROM cinevjet.coin_wallets WHERE user_id=$1", [a]))
      .rows[0].balance,
    "100000",
  );
  checks += 3;
  for (const body of [
    { mission_id: "VIP_1_TASK_1", calendar_date: "2050-01-01", reward: 999999 },
    {
      mission_id: "VIP_1_TASK_1",
      calendar_date: "2050-01-01",
      watched_seconds: 999999,
      status: "COMPLETED",
      timezone: "UTC",
    },
  ]) {
    const r = await request("/api/rewards/missions", "POST", body, cookie);
    assert.equal(r.status, 400);
    checks++;
  }
  const badDate = await request(
    "/api/rewards/missions",
    "POST",
    { mission_id: "VIP_1_TASK_1", calendar_date: "2050-01-01" },
    cookie,
  );
  assert.equal(badDate.status, 409);
  checks++;
  const beat = await request(
    "/api/rewards/watch",
    "PUT",
    { session_id: randomUUID(), nonce: randomUUID(), position: 10000, playing: true },
    cookie,
  );
  assert.equal(beat.status, 409);
  checks++;
  const tamper = await request(
    "/api/rewards/redemptions",
    "POST",
    {
      coins: 35000,
      fee: 0,
      bank_name: "TEST",
      account_name: "TEST",
      account_number: "12345678",
      idempotency_key: randomUUID(),
    },
    cookie,
  );
  assert.equal(tamper.status, 400);
  checks++;
  const oversized = await request(
    "/api/account",
    "PATCH",
    { display_name: "a".repeat(20000) },
    cookie,
  );
  assert.equal(oversized.status, 413);
  checks++;
  const method = await request("/api/account", "DELETE", {}, cookie);
  assert.equal(method.status, 405);
  checks++;
  const account = await request("/api/account?user_id=" + b, "GET", undefined, cookie);
  const data = await account.json();
  assert.equal(data.user.id, a);
  assert.ok(account.headers.get("cache-control").includes("no-store"));
  assert.ok(!JSON.stringify(data).includes("password_hash"));
  checks += 3;
  for (const path of ["/api/internal/shorts-sync", "/api/internal/finance-worker"]) {
    assert.equal((await request(path)).status, 401);
    checks++;
  }
  for (const path of ["/api/demo/payments", "/api/demo/rewards"]) {
    assert.equal((await request(path, "POST", {})).status, 410);
    checks++;
  }
  const assets = [...html.matchAll(/src="(\/_next\/static\/[^"?]+\.js)"/g)]
    .map((m) => m[1])
    .slice(0, 4);
  assert.ok(assets.length);
  for (const path of assets) {
    assert.equal((await request(path + ".map")).status, 404);
    checks++;
  }
  const key = createHmac("sha256", secret).update("auth:ip:local").digest("hex");
  await pool.query(
    "INSERT INTO cinevjet.auth_limits(key,attempts,window_start)VALUES($1,61,now()) ON CONFLICT(key)DO UPDATE SET attempts=61,window_start=now()",
    [key],
  );
  const count = (await pool.query("SELECT count(*)::int n FROM cinevjet.auth_limits")).rows[0].n;
  for (let i = 0; i < 3; i++) {
    const r = await request("/api/auth/login", "POST", {
      email: `blocked-${randomUUID()}@example.invalid`,
      password,
    });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("retry-after")) > 0);
    checks++;
  }
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM cinevjet.auth_limits")).rows[0].n,
    count,
  );
  checks++;
  console.log(
    JSON.stringify({
      http: "PASS",
      checks,
      isolatedDatabase: true,
      runtimeRoleLimited: true,
      productionWrites: 0,
    }),
  );
} finally {
  child.kill();
  fs.closeSync(log);
  await pool.end();
}
