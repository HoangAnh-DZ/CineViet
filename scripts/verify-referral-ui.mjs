// Local UI/HTTP verification against the pinned isolated QA database only.
import assert from "node:assert/strict";
import { readFile, writeFile, open } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { chromium } from "@playwright/test";
const finance = process.argv[2] === "finance";
const config = parseEnv(
  await readFile(finance ? ".vercel/financial_qa.env" : ".vercel/referral_qa.env", "utf8"),
);
const url = new URL(config.REFERRAL_TEST_DATABASE_URL);
assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
if (finance) assert.match(url.pathname, /^\/financial_reporting_20261018(?:_[a-f0-9]{8})?$/);
else assert.equal(url.pathname, "/referral_reporting_20261018");
assert.equal(
  config.REFERRAL_QA_ROLE,
  finance ? "cinevjet_runtime_finance_20261018" : "cinevjet_runtime_referrals_20261018",
);
const pool = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 1,
});
const secret = randomBytes(48).toString("base64url"),
  origin = "http://localhost:3110";
url.searchParams.set("options", "-c role=" + config.REFERRAL_QA_ROLE);
const env = { ...process.env };
for (const key of Object.keys(parseEnv(await readFile(".env.local", "utf8")))) env[key] = "";
Object.assign(env, {
  DATABASE_URL: url.toString(),
  AUTH_SECRET: secret,
  NEXT_PUBLIC_APP_URL: origin,
  NEXT_PUBLIC_DEMO_MODE: "false",
  VERCEL: "",
  BANK_ACCOUNT_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  NODE_ENV: "development",
});
async function session(admin) {
  const id = randomUUID(),
    token = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,'unused','UI QA')",
    [id, id + "@example.invalid"],
  );
  await pool.query("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
  await pool.query("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
  if (admin) await pool.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [id]);
  await pool.query(
    "INSERT INTO cinevjet.sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [randomUUID(), id, createHmac("sha256", secret).update(token).digest("hex")],
  );
  return token;
}
const admin = await session(true),
  regular = await session(false);
const log = await open(".vercel/referral-web.log", "w");
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", "3110"],
  { env, stdio: ["ignore", log.fd, log.fd], windowsHide: true },
);
let browser,
  checks = 0;
async function api(path, { token = admin, method = "GET", body, requestOrigin = origin } = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Cookie: token ? "cinevjet_session=" + token : "",
      Origin: requestOrigin,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Unexpected non-JSON response for " + path + " (" + response.status + ")");
  }
  return { response, data };
}
try {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(origin + "/api/auth/session");
      if (r.status < 500) break;
    } catch {}
    if (i === 89) throw new Error("Local QA server did not become ready");
    await new Promise((r) => setTimeout(r, 1000));
  }
  for (const path of ["/api/admin/referrals", "/api/admin/reporting"]) {
    assert.equal((await api(path, { token: "" })).response.status, 401);
    checks++;
    assert.equal((await api(path, { token: regular })).response.status, 403);
    checks++;
    assert.equal((await api(path)).response.status, 200);
    checks++;
  }
  const initial = (await api("/api/admin/referrals")).data;
  const body = {
    expected_version: initial.policy.version,
    rates_bps: [1000, 200, 100],
    reason: "Verified synthetic QA UI configuration",
    confirmation: "CONFIRM_FUTURE_ORDERS",
  };
  assert.equal(
    (
      await api("/api/admin/referrals", {
        method: "PATCH",
        body,
        requestOrigin: "https://attacker.invalid",
      })
    ).response.status,
    403,
  );
  checks++;
  assert.equal(
    (await api("/api/admin/referrals", { method: "PATCH", body: { ...body, role: "ADMIN" } }))
      .response.status,
    400,
  );
  checks++;
  assert.equal(
    (
      await api("/api/admin/referrals", {
        method: "PATCH",
        body: { ...body, rates_bps: [10000, 200, 100] },
      })
    ).response.status,
    400,
  );
  checks++;
  assert.equal((await api("/api/admin/referrals", { method: "PATCH", body })).response.status, 200);
  checks++;
  assert.deepEqual((await api("/api/admin/referrals")).data.policy.rates_bps, [1000, 200, 100]);
  checks++;
  assert.deepEqual(
    (await api("/api/referrals", { token: regular })).data.policy.percentages,
    [10, 2, 1],
  );
  checks++;
  assert.equal(
    (
      await api("/api/admin/reporting", {
        method: "POST",
        requestOrigin: "https://attacker.invalid",
        body: {},
      })
    ).response.status,
    403,
  );
  checks++;
  assert.equal(
    (await api("/api/admin/reporting", { method: "POST", body: {} })).response.status,
    400,
  );
  checks++;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([
    { name: "cinevjet_session", value: admin, url: origin, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ["/admin/referrals", "/admin/finance", "/admin?mode=BUSINESS"]) {
      const response = await page.goto(origin + path);
      assert.equal(response.status(), 200);
      await page.locator(".admin-layout").waitFor();
      await page.getByRole("heading", { level: 1 }).waitFor();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "Horizontal overflow: " + path + " at " + width,
      );
      checks++;
      if (path === "/admin/referrals") {
        const save = page.getByRole("button", { name: "Lưu thay đổi", exact: true });
        assert.equal(await save.isDisabled(), true);
        checks++;
        await page.getByRole("spinbutton", { name: "Hoa hồng F1 (%)", exact: true }).fill("99");
        assert.ok(await page.getByRole("alert").count());
        assert.equal(await save.isDisabled(), true);
        checks++;
        await page.getByRole("spinbutton", { name: "Hoa hồng F1 (%)", exact: true }).fill("10");
        await page.screenshot({ path: ".vercel/referrals-" + width + ".png", fullPage: true });
      }
    }
  }
  if (finance) {
    const targets = (
      await pool.query(
        "SELECT id FROM cinevjet.deposits WHERE status='COMPLETED' ORDER BY created_at DESC LIMIT 1",
      )
    ).rows;
    const id = targets[0].id,
      short = id.slice(0, 8);
    const snapshot = async () =>
      (
        await pool.query(
          "SELECT (SELECT jsonb_agg(x ORDER BY user_id) FROM(SELECT user_id,balance,reserved FROM cinevjet.wallets) x) wallets,(SELECT jsonb_agg(x ORDER BY user_id) FROM(SELECT user_id,balance,reserved FROM cinevjet.coin_wallets) x) coins,(SELECT count(*)::text FROM cinevjet.wallet_ledger) cash_ledger,(SELECT count(*)::text FROM cinevjet.coin_ledger) coin_ledger",
        )
      ).rows[0];
    const before = await snapshot();
    await page.goto(origin + "/admin/finance");
    await page.getByRole("button", { name: "Tải giao dịch", exact: true }).click();
    await page
      .getByText("Giao dịch (100 lệnh mới nhất)", { exact: true })
      .locator("..")
      .locator("select")
      .selectOption("DEPOSIT/" + id);
    await page.locator(".report-candidate-details").waitFor();
    assert.ok((await page.locator(".report-candidate-details").innerText()).includes("••••"));
    checks++;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    checks++;
    async function classify(decision) {
      await page
        .getByText("Quyết định phân loại", { exact: true })
        .locator("..")
        .locator("select")
        .selectOption(decision);
      await page
        .getByText("Bằng chứng / lý do", { exact: true })
        .locator("..")
        .locator("input")
        .fill("Confirmed isolated QA browser test, reporting only");
      await page.locator("form.referral-form-body input[type=checkbox]").check();
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/api/admin/reporting") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", {
          name: decision === "TEST" ? "Xác nhận TEST" : "Xác nhận đưa vào báo cáo",
          exact: true,
        })
        .click();
      assert.equal((await response).status(), 200);
      await page.waitForLoadState("networkidle");
      checks++;
    }
    await classify("TEST");
    await page.locator("tbody tr").filter({ hasText: short }).waitFor({ state: "detached" });
    checks++;
    await page.getByRole("button", { name: "Toàn bộ", exact: true }).click();
    await page.locator("tbody tr").filter({ hasText: short }).waitFor();
    checks++;
    await page.getByRole("button", { name: "Kinh doanh", exact: true }).click();
    await page.locator("tbody tr").filter({ hasText: short }).waitFor({ state: "detached" });
    await classify("REAL");
    await page.locator("tbody tr").filter({ hasText: short }).waitFor();
    checks++;
    assert.deepEqual(await snapshot(), before);
    checks++;
    await page.waitForLoadState("networkidle");
    const revisions = [];
    page.on("response", (r) => {
      if (r.url().endsWith("/api/admin/reporting/revision")) revisions.push(r.status());
    });
    await page.clock.install({ time: new Date() });
    const newId = randomUUID();
    await pool.query(
      "INSERT INTO cinevjet.deposits(id,user_id,amount,provider,status,idempotency_key,completed_at) SELECT $1,user_id,50000,'MANUAL_BANK','COMPLETED',$1,now() FROM cinevjet.deposits WHERE id=$2",
      [newId, id],
    );
    const fresh = page.locator("tbody tr").filter({ hasText: newId.slice(0, 8) });
    assert.equal(await fresh.count(), 0);
    const changed = page.waitForResponse(
      (r) => r.url().endsWith("/api/admin/reporting/revision") && r.status() === 200,
    );
    await page.clock.fastForward(31000);
    await changed;
    await fresh.waitFor();
    checks++;
    const unchanged = page.waitForResponse(
      (r) => r.url().endsWith("/api/admin/reporting/revision") && r.status() === 304,
    );
    await page.clock.fastForward(31000);
    await unchanged;
    checks++;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const count = revisions.length;
    await page.clock.fastForward(90000);
    assert.equal(revisions.length, count);
    checks++;
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.resume();
  }
  await page.goto(origin + "/admin/referrals");
  await page
    .getByText("Lý do thay đổi", { exact: true })
    .locator("..")
    .locator("input")
    .fill("Verified browser save on isolated QA only");
  await page.locator("form.referral-config input[type=checkbox]").check();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/admin/referrals") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  assert.equal((await saved).status(), 200);
  await page.getByRole("status").waitFor();
  checks++;
  await page.getByRole("button", { name: "Bật giao diện tối", exact: true }).click();
  assert.ok(await page.locator(".admin-theme-dark").count());
  checks++;
  await page.screenshot({ path: ".vercel/referrals-dark.png", fullPage: true });
  await page.waitForLoadState("networkidle");
  await context.clearCookies();
  await context.addCookies([
    { name: "cinevjet_session", value: regular, url: origin, httpOnly: true, sameSite: "Lax" },
  ]);
  assert.equal((await page.goto(origin + "/referrals")).status(), 200);
  await page.getByText("Tỷ lệ hiện hành", { exact: true }).waitFor();
  checks++;
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    `PASS: ${checks} local QA HTTP/browser checks; desktop/mobile, form validation, save, theme, user policy, authentication and Origin guards.`,
  );
} finally {
  await browser?.close();
  server.kill();
  await pool.end();
  await log.close();
}
