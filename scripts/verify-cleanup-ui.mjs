// Isolated QA only. Never uses Production accounts, mail, or payment providers.
import assert from "node:assert/strict";
import { readFile, writeFile, open } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import { Pool } from "pg";
import { chromium } from "@playwright/test";
import { importCatalog } from "./import-licensed-catalog.mjs";
const config = parseEnv(await readFile(".vercel/financial_qa.env", "utf8")),
  url = new URL(config.REFERRAL_TEST_DATABASE_URL);
assert.equal(url.hostname, "ep-late-credit-b3qu4dqn.c-4.ap-southeast-1.aws.neon.tech");
assert.match(url.pathname, /^\/financial_reporting_20261018_[a-f0-9]{8}$/);
assert.equal(config.REFERRAL_QA_ROLE, "cinevjet_runtime_finance_20261018");
const owner = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: true },
  max: 1,
});
await importCatalog(
  owner,
  JSON.parse(await readFile("database/licensed-catalog.json", "utf8")).filter(
    (m) => m.id === "spring",
  ),
);
await owner.query(
  "INSERT INTO cinevjet.vip_plans(id,name,price,duration_days,benefits_json,reward_tier,checkin_rewards) VALUES('FREE','Free',0,0,'[]','FREE',ARRAY[200,300,500,700,1000,1300,2000]) ON CONFLICT(id) DO UPDATE SET reward_tier='FREE',checkin_rewards=excluded.checkin_rewards",
);
const secret = randomBytes(48).toString("base64url"),
  password = randomBytes(24).toString("base64url"),
  origin = "http://localhost:3114";
async function fixture(admin = false) {
  const id = randomUUID(),
    token = randomBytes(32).toString("base64url");
  await owner.query(
    "INSERT INTO cinevjet.users(id,email,password_hash,display_name) VALUES($1,$2,$3,'Cleanup QA')",
    [id, id + "@example.invalid", await hash(password, 12)],
  );
  await owner.query("INSERT INTO cinevjet.wallets(user_id) VALUES($1)", [id]);
  await owner.query("INSERT INTO cinevjet.coin_wallets(user_id) VALUES($1)", [id]);
  if (admin) await owner.query("INSERT INTO cinevjet.admin_users(user_id) VALUES($1)", [id]);
  await owner.query(
    "INSERT INTO cinevjet.sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [randomUUID(), id, createHmac("sha256", secret).update(token).digest("hex")],
  );
  return { id, token };
}
const admin = await fixture(true),
  regular = await fixture();
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
  RESEND_API_KEY: "",
  ACCOUNT_EMAIL_FROM: "",
  NODE_ENV: "development",
});
const log = await open(".vercel/cleanup-ui-server.log", "w"),
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", "3114"],
    { env, stdio: ["ignore", log.fd, log.fd], windowsHide: true },
  );
let browser,
  checks = 0;
async function api(
  path,
  { token = admin.token, method = "GET", body, requestOrigin = origin, redirect = "follow" } = {},
) {
  const r = await fetch(origin + path, {
    method,
    redirect,
    headers: {
      Cookie: "cinevjet_session=" + token,
      Origin: requestOrigin,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}
try {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(origin + "/api/auth/session")).status < 500) break;
    } catch {}
    assert.notEqual(i, 89);
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(
    (await api("/api/admin/referrals", { token: regular.token, method: "PATCH", body: {} })).status,
    403,
  );
  checks++;
  for (const path of ["/api/account/security/password", "/api/account/security/email"]) {
    assert.equal(
      (
        await api(path, {
          method: "POST",
          body: {},
          requestOrigin: "https://untrusted.example.invalid",
        })
      ).status,
      403,
    );
    checks++;
    assert.equal((await api(path, { method: "POST", body: { user_id: admin.id } })).status, 400);
    checks++;
  }
  assert.equal((await api("/api/account/security/email")).status, 200);
  assert.equal((await (await api("/api/account/security/email")).json()).available, false);
  checks++;
  const moved = await api("/admin/finance?mode=ALL&view=deposits&from=2026-10-01", {
    redirect: "manual",
  });
  assert.ok([200, 307].includes(moved.status));
  if (moved.status === 307) {
    assert.equal(new URL(moved.headers.get("location"), origin).pathname, "/admin");
  } else assert.match(await moved.text(), /NEXT_REDIRECT|http-equiv="refresh"/);
  checks++;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addCookies([
    { name: "cinevjet_session", value: admin.token, url: origin, httpOnly: true, sameSite: "Lax" },
  ]);
  await page.goto(origin + "/admin/finance?mode=ALL&view=deposits&from=2026-10-01");
  await page.waitForURL((u) => u.pathname === "/admin");
  assert.equal(new URL(page.url()).searchParams.get("mode"), "ALL");
  assert.equal(new URL(page.url()).searchParams.get("view"), "deposits");
  checks++;
  await page.goto(origin + "/admin/referrals");
  await page.getByRole("heading", { name: "Cấu hình hoa hồng", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Kinh tế", exact: true }).count(), 0);
  checks++;
  for (const rates of [
    ["20", "2", "1"],
    ["120.25", "2.5", "1.25"],
  ]) {
    for (let i = 0; i < 3; i++)
      await page.getByLabel(`Hoa hồng F${i + 1} (%)`, { exact: true }).fill(rates[i]);
    await page
      .getByLabel("Lý do thay đổi", { exact: true })
      .fill("QA verified unrestricted configuration");
    assert.equal(
      await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).isEnabled(),
      true,
    );
    checks++;
    await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    if (Number(rates[0]) > 100) {
      await dialog.getByText(/vượt 100%/).waitFor();
      checks++;
    }
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/admin/referrals") && r.request().method() === "PATCH",
    );
    await dialog.getByRole("button", { name: "Xác nhận", exact: true }).click();
    assert.equal((await response).status(), 200);
    checks++;
    await page.getByText("Đã lưu tỷ lệ hoa hồng.", { exact: true }).waitFor();
    const policy = await (await api("/api/admin/referrals")).json();
    assert.deepEqual(
      policy.policy.rates_bps,
      rates.map((v) => Math.round(Number(v) * 100)),
    );
    checks++;
  }
  await page.goto(origin + "/admin");
  await page.getByRole("heading", { name: "Tổng quan", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Biến động dòng tiền", exact: true }).count(),
    1,
  );
  assert.equal(
    await page.getByRole("heading", { name: "Lịch sử giao dịch", exact: true }).count(),
    1,
  );
  checks++;
  const totals = await page.locator(".dashboard-metric > strong").allTextContents();
  await page.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Tự cập nhật" }).waitFor();
  assert.deepEqual(await page.locator(".dashboard-metric > strong").allTextContents(), totals);
  checks++;
  await page.goto(origin + "/admin?view=deposits");
  await page.getByRole("heading", { name: "Nạp tiền", exact: true }).waitFor();
  assert.equal(await page.getByText("Chênh lệch thu − chi", { exact: true }).count(), 0);
  checks++;
  await page.goto(origin + "/admin?view=withdrawals");
  await page.getByRole("heading", { name: "Rút tiền", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Lịch sử giao dịch", exact: true }).count(),
    0,
  );
  checks++;
  await page.goto(origin + "/admin/settings");
  await page.getByRole("heading", { name: "Hạn mức và phí", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Thông tin nạp tiền", exact: true }).count(),
    0,
  );
  assert.equal(await page.getByLabel("Số tài khoản", { exact: true }).count(), 0);
  checks++;
  await page.getByLabel("Nạp tối thiểu (đ)", { exact: true }).fill("10001");
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/admin/settings") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Lưu cấu hình", exact: true }).click();
  const settingsResponse = await saved;
  assert.equal(settingsResponse.status(), 200);
  assert.ok(
    !Object.keys(settingsResponse.request().postDataJSON()).some(
      (k) => k.includes("bank") || k.includes("account"),
    ),
  );
  checks++;
  await page.goto(origin + "/profile");
  await page.getByRole("heading", { name: "Của tôi", exact: true }).waitFor();
  for (const name of ["Ngôn ngữ", "Thông báo", "Phản hồi"])
    assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0);
  checks++;
  assert.equal(
    await page.getByRole("link", { name: "Hỗ trợ", exact: true }).getAttribute("href"),
    "https://t.me/JameCine",
  );
  assert.equal(
    await page.getByRole("link", { name: "Hỗ trợ", exact: true }).getAttribute("rel"),
    "noopener noreferrer",
  );
  checks++;
  await page.getByRole("button", { name: "Thông tin cá nhân", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByText("Đổi email chưa khả dụng.", { exact: false }).waitFor();
  checks++;
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("Updated Browser QA");
  const renamed = page.waitForResponse(
    (r) => r.url().endsWith("/api/account") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Lưu tên", exact: true }).click();
  assert.equal((await renamed).status(), 200);
  await page.getByText("Đã lưu tên hiển thị.", { exact: true }).waitFor();
  checks++;
  await page.getByLabel("Mật khẩu hiện tại", { exact: true }).fill(password);
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill("Browser-new-QA-password!");
  await page.getByLabel("Nhập lại mật khẩu mới", { exact: true }).fill("Browser-new-QA-password!");
  const changed = page.waitForResponse((r) => r.url().endsWith("/api/account/security/password"));
  await page.getByRole("button", { name: "Đổi mật khẩu", exact: true }).click();
  assert.equal((await changed).status(), 200);
  await page.getByText("Đã đổi mật khẩu và đăng xuất các phiên khác.", { exact: true }).waitFor();
  checks++;
  await page.goto(origin + "/referrals");
  await page.getByRole("heading", { name: "Tỷ lệ hiện hành", exact: true }).waitFor();
  assert.deepEqual(await page.locator(".referral-rates strong").allTextContents(), [
    "120.25%",
    "2.5%",
    "1.25%",
  ]);
  assert.equal(await page.getByText(/đã ghi có/).count(), 1);
  checks++;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      "/admin/referrals",
      "/profile?panel=account",
      "/referrals",
      "/movie/spring",
    ]) {
      await page.goto(origin + path);
      await page.waitForLoadState("networkidle");
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        path + " overflow",
      );
      checks++;
    }
  }
  const credits = page.locator("details.movie-credit");
  await credits.locator("summary").click();
  await credits.getByRole("link").first().waitFor();
  assert.ok((await credits.innerText()).includes("CC"));
  checks++;
  assert.deepEqual(errors, []);
  checks++;
  await writeFile(
    ".vercel/cleanup-ui-results.json",
    JSON.stringify(
      {
        result: "PASS",
        checks,
        exactRuntimeRole: config.REFERRAL_QA_ROLE,
        noProductionDataUsed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      checks,
      exactRuntimeRole: config.REFERRAL_QA_ROLE,
      noProductionDataUsed: true,
    }),
  );
} finally {
  await browser?.close();
  server.kill();
  await owner.end();
  await log.close();
}
