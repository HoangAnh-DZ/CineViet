// Browser regression for the real login API and registration form contract.
// All users, credentials and registration challenge responses are synthetic QA fixtures.
import assert from "node:assert/strict";
import { readFile, open } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { chromium } from "@playwright/test";
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
await owner.query(
  "INSERT INTO cinevjet.vip_plans(id,name,price,duration_days,benefits_json,reward_tier,checkin_rewards) VALUES('FREE','Free',0,0,'[]','FREE',ARRAY[200,300,500,700,1000,1300,2000]) ON CONFLICT(id) DO UPDATE SET reward_tier='FREE',checkin_rewards=excluded.checkin_rewards",
);
const id = randomUUID(),
  email = id + "@example.invalid",
  password = randomBytes(24).toString("base64url");
await owner.query(
  "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,$3,'Auth form QA')",
  [id, email, await hash(password, 12)],
);
await owner.query("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
await owner.query("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
url.searchParams.set("options", "-c role=" + config.REFERRAL_QA_ROLE);
const env = { ...process.env };
for (const key of Object.keys(parseEnv(await readFile(".env.local", "utf8")))) env[key] = "";
Object.assign(env, {
  DATABASE_URL: url.toString(),
  AUTH_SECRET: randomBytes(48).toString("base64url"),
  BANK_ACCOUNT_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  NEXT_PUBLIC_APP_URL: "http://localhost:3112",
  NEXT_PUBLIC_DEMO_MODE: "false",
  VERCEL: "",
  NODE_ENV: "development",
});
const origin = "http://localhost:3112",
  log = await open(".vercel/auth-forms-qa-server.log", "w");
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", "3112"],
  { env, stdio: ["ignore", log.fd, log.fd], windowsHide: true },
);
let browser,
  checks = 0;
try {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(origin + "/api/auth/session")).status < 500) break;
    } catch {}
    assert.notEqual(i, 89, "QA server startup");
    await new Promise((r) => setTimeout(r, 1000));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/login");
  assert.equal(await page.locator("form").getAttribute("method"), "post");
  checks++;
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Wrong-QA-password!");
  let submitted = page.waitForResponse(
    (r) => r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const rejected = await submitted;
  assert.equal(rejected.status(), 401);
  checks++;
  assert.deepEqual(Object.keys(rejected.request().postDataJSON()).sort(), [
    "email",
    "password",
    "remember",
  ]);
  checks++;
  await page
    .locator(".form-error")
    .filter({ hasText: /Email|mật khẩu/ })
    .waitFor();
  checks++;
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  submitted = page.waitForResponse(
    (r) => r.url().endsWith("/api/auth/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  assert.equal((await submitted).status(), 200);
  checks++;
  await page.waitForURL(origin + "/profile", { timeout: 60000 });
  await page.getByRole("heading", { name: "Của tôi", exact: true }).waitFor();
  checks++;
  // These mocks test only form gating/payloads; no new account or CAPTCHA is solved.
  await page.route("**/api/auth/register-check", (r) => r.fulfill({ json: { ready: true } }));
  await page.route("**/api/auth/register-code", (r) =>
    r.fulfill({
      json: {
        id: randomUUID(),
        image:
          "data:image/svg+xml;base64," +
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="5" y="25">QA fixture</text></svg>',
          ).toString("base64"),
        expires_at: new Date(Date.now() + 300000).toISOString(),
      },
    }),
  );
  let registrationPayload;
  await page.route("**/api/auth/register", (r) => {
    registrationPayload = r.request().postDataJSON();
    return r.fulfill({ status: 400, json: { error: "QA fixture: mã xác minh không đúng." } });
  });
  await page.goto(origin + "/register");
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("Synthetic QA");
  await page.getByLabel("Email", { exact: true }).fill(randomUUID() + "@example.invalid");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(password + "mismatch");
  await page.getByLabel("Mã xác minh 4 ký tự", { exact: true }).fill("QA12");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await page.getByText("Mật khẩu nhập lại không khớp", { exact: true }).waitFor();
  assert.equal(registrationPayload, undefined);
  checks++;
  await page.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  await page.getByText("QA fixture: mã xác minh không đúng.", { exact: true }).waitFor();
  checks++;
  assert.ok(registrationPayload?.verification_challenge);
  assert.equal(registrationPayload.verification_code, "QA12");
  assert.equal("confirm_password" in registrationPayload, false);
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  console.log(
    JSON.stringify({
      result: "PASS",
      checks,
      runtimeRole: config.REFERRAL_QA_ROLE,
      realLoginAPI: true,
      registrationPayloadAndErrors: true,
      noProductionAccountsUsed: true,
    }),
  );
} finally {
  await browser?.close();
  server.kill();
  await owner.end();
  await log.close();
}
