import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const chrome = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true });
mkdirSync("test-results/screens", { recursive: true });
const widths = [360, 375, 390, 412, 430];
const routes = [
  "/",
  "/explore",
  "/search",
  "/movie/desert-heir",
  "/watch/desert-heir",
  "/watch/desert-heir/desert-heir-ep-6",
  "/rewards",
  "/wallet",
  "/wallet/deposit",
  "/wallet/withdraw",
  "/wallet/history",
  "/vip",
  "/favorites",
  "/history",
  "/profile",
  "/login",
  "/register",
];
const results = { mobile: [], interactions: [], errors: [], screenshots: [] };
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const flowsOnly = process.argv.includes("--flows");
if (flowsOnly && existsSync("test-results/mobile-report.json")) {
  const previous = JSON.parse(readFileSync("test-results/mobile-report.json", "utf8"));
  results.mobile = previous.mobile;
  results.screenshots = previous.screenshots;
  if (only) results.interactions = previous.interactions.filter((item) => item.name !== only);
}
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const navigate = page.goto.bind(page);
page.goto = (url, options = {}) => navigate(url, { waitUntil: "networkidle", ...options });
const reload = page.reload.bind(page);
page.reload = (options = {}) => reload({ waitUntil: "networkidle", ...options });
let expected404 = false;
page.on("pageerror", (error) => results.errors.push(error.message));
page.on("console", (msg) => {
  if (msg.type() === "error" && !expected404) results.errors.push(msg.text());
});
page.on("response", (response) => {
  if (response.status() >= 400 && !expected404)
    console.log(`HTTP ${response.status()}: ${response.url()}`);
});
try {
  for (const width of flowsOnly ? [] : widths) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      const response = await page.goto(base + route, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200, `${route} status`);
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        html: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        imageErrors: [...document.querySelectorAll("img")]
          .filter((img) => img.complete && img.naturalWidth === 0)
          .map((img) => img.src),
        visibleNav: !!document.querySelector(".bottom-nav"),
        navCount: document.querySelectorAll(".bottom-nav > a").length,
      }));
      assert(
        dimensions.html <= width + 1 && dimensions.body <= width + 1,
        `${route} overflow at ${width}: ${JSON.stringify(dimensions)}`,
      );
      assert.equal(dimensions.imageErrors.length, 0, `${route} broken images`);
      const needsNav = !["/login", "/register", "/wallet/deposit", "/wallet/withdraw"].includes(
        route,
      );
      assert.equal(dimensions.visibleNav, needsNav, `${route} nav visibility`);
      if (needsNav) assert.equal(dimensions.navCount, 5, "five tabs");
      results.mobile.push({ route, width, status: "PASS" });
      if (width === 390) {
        const file = `test-results/screens/${route === "/" ? "home" : route.slice(1).replaceAll("/", "-")}.png`;
        await page.screenshot({ path: file, fullPage: true });
        results.screenshots.push(file);
      }
    }
    console.log(`MOBILE ${width}: PASS (${routes.length} routes)`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  async function run(name, fn) {
    if (only && name !== only) return;
    await fn();
    results.interactions.push({ name, status: "PASS" });
    console.log(`${name}: PASS`);
  }
  await run("bottom navigation", async () => {
    await page.goto(base);
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
    await nav.getByRole("link", { name: "Khám phá" }).click();
    await page.waitForURL("**/explore");
    assert.equal(await nav.locator('[aria-current="page"]').innerText(), "Khám phá");
  });
  await run("search and genre filtering", async () => {
    await page.getByRole("searchbox").fill("Sa Mạc");
    await page.waitForTimeout(150);
    assert.equal(await page.locator(".movie-card").count(), 1);
    await page.getByRole("searchbox").fill("");
    await page.getByRole("button", { name: "Phim bộ", exact: true }).click();
    assert.equal(await page.locator(".movie-card").count(), 4);
  });
  await run("favorite add / reload / remove", async () => {
    await page.goto(base + "/movie/desert-heir");
    await page.getByRole("button", { name: "Thêm yêu thích", exact: true }).first().click();
    await page.goto(base + "/favorites");
    assert.equal(await page.locator(".movie-card").count(), 1);
    await page.reload();
    assert.equal(await page.locator(".movie-card").count(), 1);
    await page.goto(base + "/movie/desert-heir");
    await page.getByRole("button", { name: "Bỏ yêu thích", exact: true }).first().click();
    await page.goto(base + "/favorites");
    assert.equal(await page.locator(".movie-card").count(), 0);
  });
  await run("HTML5 playback / seek / volume / subtitles / episode", async () => {
    await page.goto(base + "/watch/desert-heir/desert-heir-ep-6");
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
    await page.getByRole("button", { name: "Phát video", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.1);
    await page.getByRole("button", { name: "Tạm dừng", exact: true }).click();
    await page.locator('input[aria-label="Thời gian video"]').fill("12");
    await page.getByRole("button", { name: "Tắt âm thanh", exact: true }).click();
    assert.equal(await page.locator("video").evaluate((el) => el.muted), true);
    await page.getByLabel("Âm lượng", { exact: true }).fill("0.4");
    assert.equal(await page.locator("video").evaluate((el) => el.volume), 0.4);
    await page.getByLabel("Phụ đề", { exact: true }).selectOption("vi");
    assert.equal(await page.locator("video").evaluate((el) => el.textTracks[0].mode), "showing");
    await page.getByRole("button", { name: "Toàn màn hình", exact: true }).click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await page.getByRole("button", { name: "Thoát toàn màn hình", exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("video")?.currentTime >= 11.9);
    await page.getByRole("link", { name: "Tập sau", exact: true }).click();
    await page.waitForURL("**/desert-heir-ep-7");
    await page.goto(base + "/history");
    assert((await page.locator(".continue-card").count()) >= 3);
  });
  await run("check-in UI / concurrent idempotency", async () => {
    await page.goto(base + "/rewards");
    const before = await context.request.get(base + "/api/demo/rewards").then((r) => r.json());
    const available = before.days.find((d) => d.status === "AVAILABLE");
    if (available) {
      await page.getByRole("button", { name: "Điểm danh hôm nay", exact: true }).click();
      await page.getByRole("button", { name: "Đã điểm danh hôm nay", exact: true }).waitFor();
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          context.request
            .post(base + "/api/demo/rewards", {
              data: { kind: "CHECK_IN", idempotency_key: crypto.randomUUID(), reward: 999999 },
            })
            .then((r) => r.json()),
        ),
      );
      for (const data of responses) {
        assert.equal(data.wallet.balance, before.wallet.balance + available.reward);
        assert.equal(data.ledger.length, before.ledger.length + 1);
      }
    }
  });
  await run("deposit confirmation / server receipt / history", async () => {
    await page.goto(base + "/wallet/deposit");
    await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
    await page.getByRole("button", { name: "Xác nhận yêu cầu demo", exact: true }).click();
    await page.getByRole("dialog").getByText("Đang chờ xử lý").waitFor();
    await page.getByRole("link", { name: "Xem lịch sử giao dịch", exact: true }).click();
    await page.locator(".transaction").filter({ hasText: "Đang chờ" }).first().waitFor();
    assert((await page.locator(".mini-balance").innerText()).includes("1.250.000"));
  });
  await run("server payment validation / same-key replay / payload conflict", async () => {
    const key = crypto.randomUUID();
    const payload = {
      kind: "DEPOSIT",
      amount: "100000",
      method_id: "momo-demo",
      idempotency_key: key,
    };
    const first = await context.request.post(base + "/api/demo/payments", { data: payload });
    assert.equal(first.status(), 200);
    const a = await first.json();
    const b = await context.request
      .post(base + "/api/demo/payments", { data: payload })
      .then((r) => r.json());
    assert.equal(a.id, b.id);
    const conflict = await context.request.post(base + "/api/demo/payments", {
      data: { ...payload, amount: "200000" },
    });
    assert.equal(conflict.status(), 409);
    for (const amount of ["12.5", "-200000", "9999999999999999999999"]) {
      const r = await context.request.post(base + "/api/demo/payments", {
        data: { ...payload, amount, idempotency_key: crypto.randomUUID() },
      });
      assert.equal(r.status(), 400);
    }
  });
  await run("withdrawal validation / fee / confirmation", async () => {
    await page.goto(base + "/wallet/withdraw");
    await page.getByLabel("Số tiền rút", { exact: true }).fill("1300000");
    await page.getByLabel("Số tài khoản nhận tiền", { exact: true }).fill("0123456789");
    await page.getByRole("button", { name: "Xác nhận rút", exact: true }).click();
    assert.equal(await page.locator(".form-error").count(), 1);
    await page.getByLabel("Số tiền rút", { exact: true }).fill("200000");
    assert((await page.locator(".quote").innerText()).includes("197.000"));
    await page.getByRole("button", { name: "Xác nhận rút", exact: true }).click();
    await page.getByRole("button", { name: "Xác nhận yêu cầu demo", exact: true }).click();
    await page.getByRole("dialog").getByText("Đang chờ xử lý").waitFor();
  });
  await run("VIP payment remains pending / entitlement gate", async () => {
    await page.goto(base + "/vip");
    await page.getByRole("button", { name: "Nâng cấp ngay", exact: true }).first().click();
    await page.getByRole("button", { name: "Tạo yêu cầu thanh toán demo", exact: true }).click();
    await page.getByText("Đang chờ thanh toán", { exact: true }).waitFor();
    await page.goto(base + "/watch/red-frontier");
    assert.equal(await page.locator("video").count(), 0);
    await page.getByRole("heading", { name: "Phim dành cho thành viên VIP" }).waitFor();
  });
  await run("login / register / profile settings", async () => {
    await page.goto(base + "/login");
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel("Mật khẩu", { exact: true }).fill("demo123");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL("**/profile");
    assert((await page.locator(".profile-info").innerText()).includes("demo@example.com"));
    await page.getByRole("button", { name: "Cài đặt", exact: true }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    await page.goto(base + "/register");
    await page.getByLabel("Tên hiển thị", { exact: true }).fill("Người xem mới");
    await page.getByLabel("Email", { exact: true }).fill("new@example.com");
    await page.getByLabel("Mật khẩu", { exact: true }).fill("demo123");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
    await page.waitForURL("**/profile");
    assert((await page.locator(".profile-info").innerText()).includes("Người xem mới"));
  });
  await run("invalid movie / episode routes", async () => {
    expected404 = true;
    for (const route of ["/movie/missing", "/watch/desert-heir/wrong-episode"]) {
      const r = await page.goto(base + route);
      // App Router sends 200 for a streamed notFound boundary; 404 for non-streamed responses.
      assert([200, 404].includes(r.status()));
      await page.getByRole("heading", { name: "Không tìm thấy trang", exact: true }).waitFor();
    }
    expected404 = false;
  });
  assert.equal(results.errors.length, 0, `Browser errors: ${JSON.stringify(results.errors)}`);
  console.log(
    `PASS: ${results.mobile.length} mobile route checks, ${results.interactions.length} interaction flows, no browser errors.`,
  );
} catch (error) {
  results.failure = error.message;
  console.error(error);
  process.exitCode = 1;
  await page.screenshot({ path: "test-results/failure.png", fullPage: true }).catch(() => {});
} finally {
  writeFileSync("test-results/mobile-report.json", JSON.stringify(results, null, 2));
  await browser.close();
}
