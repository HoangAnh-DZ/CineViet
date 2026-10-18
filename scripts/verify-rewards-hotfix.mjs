// Isolated QA: real Next HTTP routes and runtime role; no Production claims/payments.
import assert from "node:assert/strict";
import { readFile, open } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { chromium, expect } from "@playwright/test";
const config = parseEnv(await readFile(".vercel/financial_qa.env", "utf8"));
const url = new URL(config.REFERRAL_TEST_DATABASE_URL);
assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
assert.match(url.pathname, /^\/financial_reporting_20261018_[a-f0-9]{8}$/);
assert.equal(config.REFERRAL_QA_ROLE, "cinevjet_runtime_finance_20261018");
const owner = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 1,
});
const origin = "http://localhost:3116",
  secret = randomBytes(48).toString("base64url");
async function fixture() {
  const id = randomUUID(),
    token = randomBytes(32).toString("base64url");
  await owner.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,'unusable-qa-hash','Rewards QA')",
    [id, id + "@example.invalid"],
  );
  await owner.query("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
  await owner.query("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
  await owner.query(
    "INSERT INTO cinevjet.sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [randomUUID(), id, createHmac("sha256", secret).update(token).digest("hex")],
  );
  return { id, token };
}
const user = await fixture();
url.searchParams.set("options", "-c role=" + config.REFERRAL_QA_ROLE);
const runtime = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 1,
});
assert.equal((await runtime.query("SELECT current_user r")).rows[0].r, config.REFERRAL_QA_ROLE);
await runtime.end();
const env = { ...process.env };
for (const key of Object.keys(parseEnv(await readFile(".env.local", "utf8")))) env[key] = "";
Object.assign(env, {
  DATABASE_URL: url.toString(),
  AUTH_SECRET: secret,
  NEXT_PUBLIC_APP_URL: origin,
  NEXT_PUBLIC_DEMO_MODE: "false",
  NODE_ENV: "development",
  VERCEL: "",
});
const log = await open(".vercel/rewards-hotfix-qa-server.log", "w");
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", "3116"],
  { env, stdio: ["ignore", log.fd, log.fd], windowsHide: true },
);
let browser,
  checks = 0;
async function api(
  path,
  {
    method = "GET",
    body,
    token = user.token,
    requestOrigin = origin,
    contentType = "application/json",
  } = {},
) {
  return fetch(origin + path, {
    method,
    headers: {
      Cookie: "cinevjet_session=" + token,
      Origin: requestOrigin,
      "Content-Type": contentType,
    },
    body,
    signal: AbortSignal.timeout(30000),
    redirect: "manual",
  });
}
async function json(r, status = 200) {
  assert.equal(r.status, status);
  assert.match(r.headers.get("content-type"), /application\/json/);
  assert.match(r.headers.get("cache-control"), /no-store/);
  checks++;
  return r.json();
}
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin + "/api/auth/session")).status === 200) break;
    } catch {}
    assert.notEqual(i, 59, "QA server did not start");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const initial = await json(await api("/api/rewards"));
  assert.equal(initial.wallet.balance, 0);
  assert.equal(initial.timezone, "Asia/Ho_Chi_Minh");
  assert.equal(initial.days.length, 7);
  if (process.argv.includes("--reproduce")) {
    const result = await json(await api("/api/rewards", { method: "POST" }), 400);
    assert.equal(result.error, "JSON không hợp lệ.");
    assert.equal((await json(await api("/api/rewards"))).wallet.balance, 0);
    console.log(
      JSON.stringify({
        reproduced: true,
        GET: 200,
        emptyPOST: 400,
        error: result.error,
        coinsUnchanged: true,
        exactRuntimeRole: config.REFERRAL_QA_ROLE,
      }),
    );
  } else {
    if (!process.argv.includes("--ui-only")) {
      const state = await json(await api("/api/rewards", { method: "POST", body: "{}" }));
      assert.equal(state.wallet.balance, initial.days[0].reward);
      const repeated = await json(await api("/api/rewards", { method: "POST" }));
      assert.equal(repeated.wallet.balance, state.wallet.balance);
      const concurrent = await Promise.all(
        Array.from({ length: 5 }, () =>
          api("/api/rewards", { method: "POST", body: "{}" }).then((r) => json(r)),
        ),
      );
      assert.ok(concurrent.every((s) => s.wallet.balance === state.wallet.balance));
      const counts = (
        await owner.query(
          "SELECT (SELECT count(*) FROM cinevjet.daily_checkins WHERE user_id=$1)::int claims,(SELECT count(*) FROM cinevjet.coin_ledger WHERE user_id=$1)::int ledger",
          [user.id],
        )
      ).rows[0];
      assert.deepEqual(counts, { claims: 1, ledger: 1 });
      checks++;
      for (const body of [
        "{",
        "null",
        "[]",
        JSON.stringify({
          calendar_date: "2040-01-01",
          reward: 999999,
          balance: 999999,
          watched_seconds: 999999,
        }),
      ])
        await json(await api("/api/rewards", { method: "POST", body }), 400);
      await json(
        await api("/api/rewards", { method: "POST", body: "{}", contentType: "text/plain" }),
        415,
      );
      await json(
        await api("/api/rewards", {
          method: "POST",
          body: "{}",
          requestOrigin: "https://untrusted.example.invalid",
        }),
        403,
      );
      await json(await api("/api/rewards", { token: "expired" }), 401);
      await json(await api("/api/rewards", { method: "POST", body: "{}", token: "expired" }), 401);
      const missions = await json(await api("/api/rewards/missions"));
      assert.deepEqual(missions.missions, []);
      await json(await api("/api/rewards/redemptions"));
      const vip = await fixture();
      await owner.query(
        "INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,started_at,expires_at,status,plan_snapshot) VALUES($1,$2,'VIP_1',now()-interval '1 hour',now()+interval '1 day','ACTIVE',$3::jsonb)",
        [
          randomUUID(),
          vip.id,
          JSON.stringify({
            name: "QA VIP",
            reward_tier: "VIP_1",
            mission_count: 5,
            mission_reward: 1000,
          }),
        ],
      );
      const vipMissions = await json(await api("/api/rewards/missions", { token: vip.token }));
      assert.equal(vipMissions.missions.length, 5);
      assert.deepEqual(
        vipMissions.missions.map((m) => m.target_seconds),
        [30, 60, 90, 120, 150],
      );
      await json(
        await api("/api/rewards/missions", {
          token: vip.token,
          method: "POST",
          body: JSON.stringify({
            mission_id: vipMissions.missions[0].id,
            calendar_date: vipMissions.calendar_date,
            watched_seconds: 99999,
          }),
        }),
        400,
      );
      await json(
        await api("/api/rewards/missions", {
          token: vip.token,
          method: "POST",
          body: JSON.stringify({
            mission_id: vipMissions.missions[0].id,
            calendar_date: vipMissions.calendar_date,
          }),
        }),
        409,
      );
      await owner.query(
        "INSERT INTO cinevjet.daily_watch_progress(user_id,calendar_date,watched_ms) VALUES($1,$2::date,30000)",
        [vip.id, vipMissions.calendar_date],
      );
      for (let i = 0; i < 2; i++) {
        const claimed = await json(
          await api("/api/rewards/missions", {
            token: vip.token,
            method: "POST",
            body: JSON.stringify({
              mission_id: vipMissions.missions[0].id,
              calendar_date: vipMissions.calendar_date,
            }),
          }),
        );
        assert.equal(claimed.missions[0].status, "CLAIMED");
      }
      assert.equal(
        (await json(await api("/api/rewards", { token: vip.token }))).wallet.balance,
        1000,
      );
    }
    const ui = await fixture();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    });
    await context.addCookies([
      { name: "cinevjet_session", value: ui.token, url: origin, httpOnly: true, sameSite: "Lax" },
    ]);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/rewards");
    await expect(
      page.getByRole("heading", { name: "Điểm danh mỗi ngày", exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    let posted = 0,
      lost = false,
      failReadback = true;
    await page.route("**/api/rewards", async (route) => {
      if (route.request().method() === "POST") {
        posted++;
        assert.equal(route.request().postData(), "{}");
        const committed = await route.fetch();
        assert.equal(committed.status(), 200);
        assert.equal((await committed.json()).claimed_today, true);
        lost = true;
        await route.abort("failed");
      } else if (lost && failReadback) {
        failReadback = false;
        await route.fulfill({
          status: 503,
          contentType: "text/html",
          body: "<html>RAW PRIVATE FAILURE</html>",
        });
      } else await route.continue();
    });
    await page.getByRole("button", { name: /Nhận \+.* xu/ }).click();
    await expect(page.locator(".rewards-content [role=alert]")).toContainText(
      "Kiểm tra trạng thái",
    );
    await expect(page.locator(".rewards-content [role=alert]")).not.toContainText("RAW PRIVATE");
    await page.getByRole("button", { name: "Thử lại", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Đã điểm danh hôm nay", exact: true }),
    ).toBeDisabled();
    assert.equal(posted, 1);
    assert.equal(
      (await json(await api("/api/rewards", { token: ui.token }))).wallet.balance,
      initial.days[0].reward,
    );
    assert.equal(
      (
        await owner.query("SELECT count(*)::int n FROM cinevjet.coin_ledger WHERE user_id=$1", [
          ui.id,
        ])
      ).rows[0].n,
      1,
    );
    checks += 3;
    await page.route("**/api/rewards/missions", (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/html",
        body: "<html>RAW PRIVATE FAILURE</html>",
      }),
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Thử lại nhiệm vụ", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Điểm danh mỗi ngày", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Đã điểm danh hôm nay", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("RAW PRIVATE");
    await page.unroute("**/api/rewards/missions");
    await page.getByRole("button", { name: "Thử lại nhiệm vụ", exact: true }).click();
    await expect(page.getByRole("button", { name: "Thử lại nhiệm vụ", exact: true })).toHaveCount(
      0,
    );
    checks++;
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    checks++;
    const playbackBefore = (
      await owner.query(
        "SELECT md5(string_agg(to_jsonb(s)::text,'|' ORDER BY id)) hash FROM cinevjet.video_sources s WHERE movie_id='spring'",
      )
    ).rows[0].hash;
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      await page.goto(origin + "/movie/spring");
      await expect(page.getByRole("heading", { name: "Spring", exact: true })).toBeVisible();
      await expect(page.locator(".movie-credit")).toHaveCount(0);
      await expect(page.getByText(/Credits & bản quyền/)).toHaveCount(0);
      await page.getByRole("link", { name: "Thông tin bản quyền", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Thông tin bản quyền", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".copyright-page")).toContainText("Blender Foundation");
      const license = page.getByRole("link", { name: "CC BY 4.0", exact: true }).first();
      await expect(license).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      checks += 3;
      const watch = await api("/watch/spring", { token: ui.token });
      assert.equal(watch.status, 200);
      assert.ok(!(await watch.text()).includes("Credits &amp; bản quyền"));
      checks++;
    }
    assert.equal(
      (
        await owner.query(
          "SELECT md5(string_agg(to_jsonb(s)::text,'|' ORDER BY id)) hash FROM cinevjet.video_sources s WHERE movie_id='spring'",
        )
      ).rows[0].hash,
      playbackBefore,
    );
    checks++;
    await owner.query(
      "UPDATE cinevjet.sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
      [ui.id],
    );
    await page.goto(origin + "/rewards");
    await expect(page).toHaveURL(/\/login/);
    checks++;
    assert.deepEqual(errors, []);
    checks++;
    console.log(
      JSON.stringify({
        result: "PASS",
        checks,
        exactRuntimeRole: config.REFERRAL_QA_ROLE,
        noProductionDataUsed: true,
      }),
    );
  }
} finally {
  if (browser) await browser.close();
  server.kill();
  await log.close();
  await owner.end();
}
