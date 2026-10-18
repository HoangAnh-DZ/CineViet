import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
const base = "http://localhost:3017";
const f = JSON.parse(await readFile(".vercel/audit-qa.json", "utf8"));
await mkdir("test-results/vip-bank", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const errors = [],
  payosCreates = [];
async function signIn(role) {
  const c = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await c.route(base + "/api/**", async (r) => {
    if (r.request().url().endsWith("/api/payments/payos") && r.request().method() === "POST")
      payosCreates.push(r.request().url());
    if (["GET", "HEAD"].includes(r.request().method())) return r.continue();
    const response = await r.fetch({
      headers: { ...r.request().headers(), origin: "https://cinevjet-hoanganh-dz.vercel.app" },
    });
    await r.fulfill({ response });
  });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "/login");
  await p.getByLabel("Email", { exact: true }).fill(f[role + "Email"]);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(f.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL("**/profile");
  return { c, p };
}
try {
  const { c, p } = await signIn("member");
  const balanceBefore = (await (await c.request.get(base + "/api/account")).json()).balance;
  await p.goto(base + "/vip");
  const expected = [
    [150000, 5, 75, 2600],
    [300000, 8, 120, 3375],
    [500000, 12, 180, 3889],
    [1000000, 16, 240, 5917],
    [2000000, 20, 300, 9667],
    [5000000, 25, 375, 19333],
  ];
  assert.equal(await p.locator(".vip-plan").count(), 6);
  for (let i = 0; i < 6; i++) {
    const card = p.locator(".vip-plan").nth(i),
      text = await card.innerText();
    assert.ok(text.includes(`VIP ${i + 1}`));
    assert.ok(text.includes(expected[i][3].toLocaleString("vi-VN") + " xu"));
    assert.ok(!/Tổng gồm vốn|Tăng thêm|payOS|cam kết thu nhập/.test(text));
  }
  for (const width of [320, 375, 390, 430, 768, 1440]) {
    await p.setViewportSize({ width, height: 740 });
    await p.getByRole("button", { name: "Chọn gói VIP 6", exact: true }).click();
    const d = p.getByRole("dialog");
    await d.getByRole("button", { name: "Tiếp tục", exact: true }).waitFor();
    assert.ok((await d.innerText()).includes("19.333 xu"));
    assert.ok(!/payOS|Tổng gồm vốn|Tăng thêm/.test(await d.innerText()));
    const bounds = await d.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.height <= 740 - 20);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await d.getByRole("button", { name: "Đóng", exact: true }).click();
  }
  await p.setViewportSize({ width: 320, height: 640 });
  await p.getByRole("button", { name: "Chọn gói VIP 1", exact: true }).click();
  let d = p.getByRole("dialog");
  await d.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await d.getByRole("heading", { name: "Thông tin chuyển khoản", exact: true }).waitFor();
  await d.getByText("Chờ xác nhận thanh toán", { exact: true }).waitFor();
  const requests = await (await c.request.get(base + "/api/vip/purchases")).json();
  const request = requests.find((r) => r.provider === "MANUAL_BANK");
  assert.ok(request?.payment_reference);
  assert.equal(requests.filter((r) => r.provider === "MANUAL_BANK").length, 1);
  for (const [button, value] of [
    ["Sao chép số tài khoản", "123456789"],
    ["Sao chép nội dung chuyển khoản", request.payment_reference],
  ]) {
    await d.getByRole("button", { name: button, exact: true }).click();
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), value);
  }
  await p.screenshot({ path: "test-results/vip-bank/mobile-transfer.png" });
  assert.deepEqual(
    (await (await c.request.get(base + "/api/account")).json()).balance,
    balanceBefore,
  );
  await d.getByRole("button", { name: "Đóng", exact: true }).click();
  await p.getByRole("button", { name: "Chọn gói VIP 1", exact: true }).click();
  d = p.getByRole("dialog");
  await d.getByText(request.payment_reference, { exact: true }).waitFor();
  assert.equal(
    (await (await c.request.get(base + "/api/vip/purchases")).json()).length,
    requests.length,
  );
  const admin = await signIn("admin");
  await admin.p.goto(base + "/admin/finance?view=deposits");
  const row = admin.p.locator("tbody tr").filter({ hasText: "VIP 1" });
  await row.getByRole("button", { name: "Xem / Duyệt", exact: true }).click();
  const review = admin.p.getByRole("dialog");
  await review.getByText(request.payment_reference, { exact: true }).waitFor();
  await review.getByLabel("Tôi xác nhận đã kiểm tra tiền thực nhận", { exact: true }).check();
  await review
    .getByLabel("Mã giao dịch ngân hàng đã đối soát", { exact: true })
    .fill("LOCAL-BROWSER-VERIFIED-1");
  await review.getByRole("button", { name: "Xác nhận duyệt VIP", exact: true }).click();
  await review.waitFor({ state: "hidden" });
  await d.getByRole("button", { name: "Cập nhật trạng thái", exact: true }).click();
  await d.getByText("Đã xác nhận thanh toán", { exact: true }).waitFor();
  const account = await (await c.request.get(base + "/api/account")).json();
  assert.deepEqual(account.balance, balanceBefore);
  assert.ok(account.entitlements.includes("VIP_MOVIES"));
  const missions = await (await c.request.get(base + "/api/rewards/missions")).json();
  assert.equal(missions.missions.length, 5);
  assert.equal(missions.missions[0].reward, 2600);
  assert.deepEqual(payosCreates, []);
  assert.deepEqual(errors, []);
  console.log(
    "VIP BANK BROWSER PASS: six official cards, 320/375/390/430/768/1440, real clipboard, deduplicated resume, bank evidence/Admin approval, activation once and balances preserved; local QA only.",
  );
} finally {
  await browser.close();
}
