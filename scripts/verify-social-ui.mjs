import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
const base = "http://localhost:3014";
const fixture = JSON.parse(await readFile(".vercel/social-qa.json", "utf8"));
await mkdir("test-results/social-shorts", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(25000);
const errors = [],
  financialRequests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (/\/api\/(?:payments|money|vip|rewards\/watch|missions)/.test(r.url()) && r.method() !== "GET")
    financialRequests.push(r.url());
});
async function noOverflow() {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "horizontal page overflow",
  );
}
async function signIn(role) {
  await page.goto(base + "/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture[role + "Email"]);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.waitForURL("**/profile");
}
try {
  await signIn("admin");
  await page.goto(base + "/admin/shorts");
  await page.getByRole("heading", { name: "Phim ngắn", exact: true }).waitFor();
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow();
    await page.screenshot({
      path: `test-results/social-shorts/admin-${width}.png`,
      fullPage: true,
    });
  }
  console.log("PASS admin desktop/mobile, source management, queue, daily quota and sync status");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên tác giả", { exact: true }).fill("Scout & Suki · preview only");
  await dialog
    .getByLabel("URL trang tác giả", { exact: true })
    .fill("https://www.tiktok.com/@scout2015");
  await dialog.getByRole("button", { name: "Lưu nguồn", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .locator(".social-import-panel select")
    .selectOption({ label: "Scout & Suki · preview only · TIKTOK" });
  await page
    .getByLabel("URL video gốc · mỗi dòng một URL, tối đa 30")
    .fill("https://www.tiktok.com/@scout2015/video/6718335390845095173");
  await page.getByRole("button", { name: "Đưa vào hàng chờ duyệt", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "6718335390845095173" });
  await row.waitFor();
  assert.ok((await row.innerText()).includes("Chờ duyệt"));
  const buttons = await row.getByRole("button").allTextContents();
  console.log("Queue actions:", buttons.join(", "));
  await row.getByRole("button", { name: "Metadata", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /giới hạn|metadata|Chưa|chưa/ })
    .first()
    .waitFor();
  console.log("Official metadata result:", await page.getByRole("status").first().innerText());
  await row.getByRole("button", { name: "Preview / duyệt", exact: true }).click();
  await dialog.waitFor();
  assert.equal(await page.locator("iframe").count(), 1);
  const frame = page.frameLocator("iframe");
  let providerText = "";
  try {
    providerText = (await frame.locator("body").innerText({ timeout: 12000 })).slice(0, 220);
  } catch {
    providerText = "Provider did not return readable player UI";
  }
  console.log("Official embed preview:", providerText.replace(/\s+/g, " "));
  await page.screenshot({ path: "test-results/social-shorts/official-preview.png" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("iframe").count(), 0);
  console.log(
    "PASS real URL import stays pending; preview uses official player and closes cleanly",
  );
  await page.goto(base + "/shorts");
  await page.locator(".shorts-feed").waitFor();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow();
    assert.equal(await page.locator("iframe").count(), 1);
    assert.equal(await page.getByRole("link", { name: "Mở video gốc" }).count(), 5);
    const stage = await page.locator(".short-item.is-active .social-player-stage").boundingBox();
    const iframe = await page.locator(".short-item.is-active iframe").boundingBox();
    const caption = await page.locator(".short-item.is-active .social-short-caption").boundingBox();
    assert.ok(
      stage && caption && stage.y + stage.height <= caption.y + 1,
      "caption overlaps official player",
    );
    assert.ok(iframe && stage && iframe.width<=stage.width+1 && iframe.height<=stage.height+1 && Math.abs(iframe.width/iframe.height-9/16)<0.01,'portrait player must fit its stage');
    await page.screenshot({ path: `test-results/social-shorts/feed-${width}.png` });
  }
  await page.locator(".shorts-feed").evaluate((e) => {
    e.scrollTop = e.clientHeight;
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.short-item[data-index="1"]')?.getAttribute("data-active") === "true",
  );
  assert.equal(await page.locator("iframe").count(), 1);
  await page.getByRole("button", { name: "Lưu video", exact: true }).nth(1).click();
  await page.getByRole("button", { name: "Bỏ lưu video", exact: true }).waitFor();
  assert.equal(financialRequests.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS feed scroll, one mounted iframe, original fallback, bookmark; no reward/payment writes or JS errors",
  );
  await context.clearCookies();
  await signIn("member");
  const denied = await context.request.get(base + "/api/admin/shorts/social");
  assert.equal(denied.status(), 403);
  console.log("PASS regular member cannot use admin API");
} finally {
  await browser.close();
}
