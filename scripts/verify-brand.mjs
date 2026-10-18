import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const base = process.env.BRAND_VERIFY_URL || "http://localhost:3016";
await mkdir("test-results/brand", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});
const context = await browser.newContext();
const page = await context.newPage();
const errors = [],
  broken = [],
  writes = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && /\/brand\/|favicon|icon\.svg|apple-icon/.test(r.url()))
    broken.push(r.url());
});
await context.route("**/api/**", (route) => {
  if (!["GET", "HEAD"].includes(route.request().method())) {
    writes.push(route.request().url());
    return route.abort();
  }
  return route.continue();
});
async function dimensions(p) {
  assert.ok(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "horizontal overflow",
  );
  for (const img of await p.locator("img.brand-logo:visible").all()) {
    await img.waitFor();
    assert.ok(await img.evaluate((e) => e.complete && e.naturalWidth > 0), "logo did not load");
    const box = await img.boundingBox();
    assert.ok(box && Math.abs(box.width / box.height - 740 / 215) < 0.02, "logo is distorted");
  }
}
try {
  for (const width of [320, 375, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/explore", "/login"]) {
      const response = await page.goto(base + path);
      assert.equal(response.status(), 200);
      await page.locator("img.brand-logo:visible").first().waitFor();
      await dimensions(page);
      assert.equal(await page.locator("img.brand-logo:visible").count(), 1);
      assert.equal(await page.locator(".brand-mark,.admin-brand-mark").count(), 0);
      if (path === "/explore") {
        const header = await page.locator(".app-header:visible").boundingBox();
        assert.ok(header.height <= (width >= 1000 ? 72 : 64));
        const logo = await page.locator(".brand:visible").boundingBox(),
          controls = await page.locator(".header-links:visible").boundingBox();
        assert.ok(logo.x + logo.width <= controls.x + 1, "logo overlaps actions");
      }
      if ([320, 390, 1440].includes(width))
        await page.screenshot({
          path: `test-results/brand/${base.includes("localhost") ? "local" : "production"}-${path.slice(1)}-${width}.png`,
        });
    }
    console.log(`PASS ${width}px: header/auth logo, aspect ratio, no duplicate/overflow/overlap`);
  }
  await page.goto(base + "/login");
  await page.getByRole("link", { name: "CineVjet · Khám phá" }).click();
  await page.waitForURL("**/explore");
  const icon = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute("href");
  assert.ok(icon?.includes("icon.svg"));
  for (const path of [
    icon,
    "/favicon.ico",
    "/apple-icon.png",
    "/brand/cinevjet-logo-dark.svg",
    "/brand/cinevjet-logo-light.svg",
    "/brand/cinevjet-icon.svg",
  ])
    assert.equal((await context.request.get(new URL(path, base).href)).status(), 200);
  const noJS = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 900 },
  });
  const register = await noJS.newPage();
  await register.goto(base + "/register");
  await dimensions(register);
  assert.equal(await register.locator(".brand-logo").count(), 1);
  await noJS.close();
  if (base.includes("localhost")) {
    const adminContext=await browser.newContext({javaScriptEnabled:false,viewport:{width:1440,height:900}});
    const admin=await adminContext.newPage();
    for (const tone of ["light", "dark"]) {
      await admin.setContent(await readFile(`.vercel/brand-admin-${tone}.html`, "utf8"));
      await dimensions(admin);
      assert.ok(
        (await admin.locator(".admin-brand img").getAttribute("src")).includes(`logo-${tone}.svg`),
      );
      await admin.screenshot({ path: `test-results/brand/admin-${tone}.png` });
    }
    await adminContext.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(broken, []);
  assert.deepEqual(writes, []);
  console.log(
    "PASS click-to-home, register SSR, favicon/Apple icon, assets and runtime; zero database/API writes",
  );
} finally {
  await browser.close();
}
