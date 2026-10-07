import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const base = process.env.BASE_URL || "http://localhost:3000";
const widths = [360, 375, 390, 412, 430],
  checks = [],
  errors = [];
await mkdir("test-results/production-mobile", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } }),
  page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
async function api(path, method = "GET", body) {
  const response = await context.request.fetch(base + path, {
    method,
    headers: { Origin: base, "Content-Type": "application/json" },
    ...(body ? { data: body } : {}),
  });
  return { status: response.status(), data: await response.json() };
}
async function check(name, fn) {
  await fn();
  checks.push({ name, pass: true });
  console.log("PASS " + name);
}
const email = "cinevjet-test-" + randomUUID() + "@example.com",
  password = "CineVjet-test-Strong123";
try {
  await check("anonymous protected routes", async () => {
    for (const route of ["/profile", "rewards", "wallet", "favorites", "history"]) {
      const r = await context.request.get(base + "/" + route.replace(/^\//, ""), {
        maxRedirects: 0,
      });
      assert.ok([200, 307].includes(r.status()));
      await page.goto(base + "/" + route.replace(/^\//, ""));
      await page.waitForURL(base + "/login");
    }
  });
  await check("anonymous writes rejected", async () => {
    assert.equal(
      (await api("/api/favorites", "PUT", { movie_id: "midnight-rain", active: true })).status,
      401,
    );
  });
  await check("register creates real session", async () => {
    const r = await api("/api/auth/register", "POST", {
      email,
      password,
      display_name: "CineVjet Test",
      remember: true,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.email, email);
  });
  await check("HttpOnly SameSite session, Secure on production", async () => {
    const c = (await context.cookies()).find((c) => c.name.includes("cinevjet_session"));
    assert.ok(c);
    assert.equal(c.httpOnly, true);
    assert.equal(c.sameSite, "Lax");
    if (base.startsWith("https:")) assert.equal(c.secure, true);
  });
  await check("session survives browser reload", async () => {
    await page.goto(base + "/profile");
    await page.reload();
    await page.getByRole("heading", { name: "CineVjet Test", exact: true }).waitFor();
    assert.equal((await api("/api/auth/session")).data.user.email, email);
  });
  await check("favorite persisted and listed", async () => {
    await page.goto(base + "/movie/midnight-rain");
    await page.getByRole("button", { name: "Thêm yêu thích", exact: true }).first().click();
    await page.getByRole("button", { name: "Bỏ yêu thích", exact: true }).first().waitFor();
    await page.goto(base + "/favorites");
    await page.getByRole("heading", { name: "Mật Mã Đêm Mưa", exact: true }).waitFor();
  });
  await check("player persists progress and history", async () => {
    await page.goto(base + "/watch/midnight-rain");
    await page.locator("#main-content video:visible").waitFor();
    await page.waitForFunction(() => {
      const v = document.querySelector("#main-content video");
      return v && v.readyState >= 1 && v.duration > 1;
    });
    await page.getByRole("button", { name: "Phát video", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("#main-content video").paused);
    await page.locator("#main-content video:visible").evaluate((v) => {
      v.currentTime = Math.min(10, v.duration / 3);
      v.pause();
    });
    await page.waitForFunction(async () => {
      const r = await fetch("/api/account");
      const a = await r.json();
      return a.progress?.some((p) => p.movie_id === "midnight-rain" && p.position_seconds >= 5);
    });
    await page.goto(base + "/history");
    await page.getByRole("heading", { name: "Mật Mã Đêm Mưa", exact: true }).waitFor();
  });
  await check("continue watching and player resume", async () => {
    await page.goto(base + "/");
    await page.locator("#main-content .continue-card:visible").first().waitFor();
    await page.goto(base + "/watch/midnight-rain");
    await page.waitForFunction(
      () => document.querySelector("#main-content video")?.currentTime >= 5,
    );
  });
  await check("server search and filters", async () => {
    const r = await api("/api/catalog?q=Desert");
    assert.equal(r.data.items[0].id, "desert-heir");
    assert.equal((await api("/api/catalog?type=SERIES")).data.total, 4);
    await page.goto(base + "/search");
    await page.getByPlaceholder("Tìm kiếm phim, diễn viên...").fill("Desert");
    await page.getByRole("heading", { name: "Người Thừa Kế Sa Mạc", exact: true }).waitFor();
  });
  await check("wallet is zero and cash actions disabled", async () => {
    await page.goto(base + "/wallet");
    await page.getByRole("button", { name: "Nạp tiền", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Nạp tiền", exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await page.getByRole("button", { name: "Rút tiền", exact: true }).isDisabled(),
      true,
    );
    assert.equal((await api("/api/account")).data.balance.cash, 0);
  });
  await check("demo payments disabled", async () => {
    assert.equal((await api("/api/demo/payments", "POST", { amount: 100000 })).status, 410);
  });
  await check("wrong login and invalid progress rejected", async () => {
    assert.equal(
      (await api("/api/auth/login", "POST", { email, password: "wrong-password" })).status,
      401,
    );
    assert.equal(
      (
        await api("/api/progress", "PUT", {
          movie_id: "midnight-rain",
          position_seconds: -1,
          duration_seconds: 60,
        })
      ).status,
      400,
    );
  });
  const routes = [
    "/",
    "/explore",
    "/search",
    "/login",
    "/register",
    "/movie/desert-heir",
    "/watch/desert-heir/desert-heir-ep-1",
    "/profile",
    "/favorites",
    "/history",
    "/rewards",
    "/wallet",
    "/wallet/history",
    "/wallet/deposit",
    "/wallet/withdraw",
    "/vip",
  ];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of routes) {
      await check(width + " " + route, async () => {
        const r = await page.goto(base + route);
        assert.equal(r.status(), 200);
        await page.locator("#main-content h1:visible").first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
          false,
        );
        assert.ok(!(await page.locator("body").innerText()).includes("Không thể tải nội dung"));
        assert.match(
          await page.locator("body").evaluate((e) => getComputedStyle(e).fontFamily),
          /nunito/i,
        );
      });
    }
    await page.goto(base + "/");
    await page.screenshot({
      path: "test-results/production-mobile/home-" + width + ".png",
      fullPage: true,
    });
  }
  await check("logout revokes server session", async () => {
    assert.equal((await api("/api/auth/logout", "POST")).status, 200);
    assert.equal((await api("/api/auth/session")).data.user, null);
    const r = await context.request.get(base + "/profile", { maxRedirects: 0 });
    assert.ok([200, 307].includes(r.status()));
    await page.goto(base + "/profile");
    await page.waitForURL(base + "/login");
  });
  await check("login restores account and library", async () => {
    assert.equal(
      (await api("/api/auth/login", "POST", { email, password, remember: true })).status,
      200,
    );
    const a = (await api("/api/account")).data;
    assert.ok(a.favoriteMovies.some((m) => m.id === "midnight-rain"));
    assert.ok(a.progress.some((p) => p.movie_id === "midnight-rain"));
  });
  await check("missing movie shows 404", async () => {
    await page.goto(base + "/movie/not-a-movie");
    await page.getByRole("heading", { name: "Không tìm thấy trang" }).waitFor();
  });
  assert.deepEqual(errors, []);
  console.log("PASS " + checks.length + "/" + checks.length + " checks");
} catch (e) {
  checks.push({ name: "failure", pass: false, error: String(e) });
  console.error(e);
  console.log("Failure page:", await page.locator("body").innerText());
  await page.screenshot({ path: "test-results/production-mobile/failure.png", fullPage: true });
  process.exitCode = 1;
} finally {
  await writeFile(
    "test-results/production-browser-report.json",
    JSON.stringify({ base, checks, errors, widths, testAccount: email }, null, 2),
  );
  await browser.close();
}
