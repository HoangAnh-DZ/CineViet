import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Pool } from "pg";
import { pgConfig } from "./pg-config.mjs";
process.loadEnvFile(".env.local");
const url = new URL(process.env.DATABASE_URL);
url.hostname = "ep-patient-surf-b3s99cl5-pooler.c-4.ap-southeast-1.aws.neon.tech";
process.env.DATABASE_URL = url.toString();
const pool = new Pool(pgConfig()),
  base = "http://localhost:3010",
  credentials = JSON.parse(await readFile("test-results/rewards-preview-credentials.json", "utf8"));
const browser = await chromium.launch({ headless: true }),
  user = await browser.newContext({ viewport: { width: 390, height: 844 } }),
  admin = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  guest = await browser.newContext();
const page = await user.newPage(),
  studio = await admin.newPage(),
  results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
studio.on("pageerror", (e) => errors.push(e.message));
const check = async (name, fn) => {
  await fn();
  results.push({ name, status: "PASS" });
  console.log("PASS " + name);
};
async function login(c, email) {
  const r = await c.request.post(base + "/api/auth/login", {
    headers: { Origin: base },
    data: { email, password: credentials.password, remember: false },
  });
  expect(r.status()).toBe(200);
}
async function state() {
  const r = await user.request.get(base + "/api/rewards/redemptions");
  expect(r.status()).toBe(200);
  return r.json();
}
async function redeem(coins = 50000) {
  await page.goto(base + "/rewards/redeem");
  await page.getByLabel("Số xu muốn đổi").fill(String(coins));
  await page.getByLabel("Tên chủ tài khoản", { exact: true }).fill("REWARDS QA ONLY");
  await page.getByLabel("Số tài khoản ngân hàng").fill("1234567890");
  await page.getByLabel("Tên ngân hàng", { exact: true }).fill("TPBank");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/rewards/redemptions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Xác nhận đổi thưởng", exact: true }).click();
  const r = await response;
  expect(r.status()).toBe(201);
  await expect(page.getByText("Đã gửi yêu cầu đổi thưởng", { exact: true })).toBeVisible();
  return r.json();
}
async function settle(kind, id, mode = "COMPLETE") {
  await studio.goto(`${base}/admin/finance?kind=${kind}&id=${id}`);
  const dialog = studio.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(credentials.userEmail, { exact: false })).toBeVisible();
  if (mode === "REJECT" || mode === "FAIL") {
    await dialog
      .getByRole("button", { name: mode === "FAIL" ? "Thất bại" : "Từ chối", exact: true })
      .click();
    await dialog.getByLabel("Lý do gửi người dùng", { exact: false }).fill("QA kiểm tra hoàn xu");
  } else {
    await expect(
      dialog.getByRole("button", {
        name: kind === "VIP_PURCHASE" ? "Xác nhận duyệt VIP" : "Xác nhận đã chuyển tiền",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog.getByRole("checkbox").check();
  }
  await dialog.getByLabel("Ghi chú nội bộ", { exact: false }).fill("PRIVATE QA BANK CHECK");
  const response = studio.waitForResponse(
    (r) => r.url().endsWith(`/api/admin/money/${kind}/${id}`) && r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", {
      name:
        mode === "FAIL"
          ? "Xác nhận thất bại"
          : mode === "REJECT"
            ? "Xác nhận từ chối"
            : kind === "VIP_PURCHASE"
              ? "Xác nhận duyệt VIP"
              : "Xác nhận đã chuyển tiền",
      exact: true,
    })
    .click();
  expect((await response).status()).toBe(200);
  await expect(dialog).toBeHidden();
}
const image = await sharp(
  Buffer.from(
    '<svg width="400" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="240" fill="white"/><text x="20" y="90" fill="black" font-size="22">QA / NO REAL BANK TRANSFER</text></svg>',
  ),
)
  .png()
  .toBuffer();
try {
  await login(user, credentials.userEmail);
  await login(admin, credentials.adminEmail);
  await check("Guest APIs cannot read bank info or submit requests", async () => {
    for (const route of ["/api/rewards/redemptions", "/api/vip/purchases"]) {
      expect((await guest.request.get(base + route)).status()).toBe(401);
      expect(
        (await guest.request.post(base + route, { headers: { Origin: base }, data: {} })).status(),
      ).toBe(401);
    }
  });
  await check("Rewards has exactly two actions, removed descriptions and five tabs", async () => {
    await page.goto(base + "/rewards");
    await expect(page.locator(".reward-actions a")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Nâng cấp VIP", exact: true })).toHaveAttribute(
      "href",
      "/vip",
    );
    await expect(page.getByRole("link", { name: "Đổi thưởng", exact: true })).toHaveAttribute(
      "href",
      "/rewards/redeem",
    );
    expect(
      await page
        .getByText("Mỗi ngày một mốc thưởng. Tích lũy xu theo chu kỳ của bạn.", { exact: true })
        .count(),
    ).toBe(0);
    expect(
      await page
        .getByText("1 xu = 1 VND · Nạp/rút dùng ví VND, không tự đổi xu thưởng.", { exact: true })
        .count(),
    ).toBe(0);
    await expect(page.locator(".bottom-nav a")).toHaveCount(5);
  });
  await check(
    "Rewards VIP CTA opens existing purchase scene and bank checkout directly",
    async () => {
      await page.getByRole("link", { name: "Nâng cấp VIP", exact: true }).click();
      await expect(page).toHaveURL(base + "/vip");
      await page.getByRole("button", { name: "Mua gói VIP", exact: true }).first().click();
      const d = page.getByRole("dialog");
      await expect(d.getByRole("heading", { name: "Chuyển khoản mua gói" })).toBeVisible();
      await expect(d.getByRole("button", { name: "Gửi yêu cầu mua VIP" })).toBeEnabled();
      await expect(d.getByText("Không cần nạp vào ví VND.", { exact: false })).toBeVisible();
    },
  );
  await check(
    "VIP checkout rejects missing bill and wrong files, previews valid image locally",
    async () => {
      const d = page.getByRole("dialog");
      await d.getByRole("button", { name: "Gửi yêu cầu mua VIP" }).click();
      await expect(d.getByRole("alert")).toContainText("Vui lòng tải bill");
      await d
        .locator("#vip-bill")
        .setInputFiles({
          name: "bad.svg",
          mimeType: "image/svg+xml",
          buffer: Buffer.from("<svg/>"),
        });
      await expect(d.getByRole("alert")).toContainText("tối đa 3 MB");
      await d
        .locator("#vip-bill")
        .setInputFiles({ name: "qa.png", mimeType: "image/png", buffer: image });
      await expect(d.getByAltText("Bill mua VIP")).toBeVisible();
      await d.getByRole("button", { name: "Đóng", exact: true }).click();
    },
  );
  await check("Redemption CTA opens real coin form with configured rate, min and fee", async () => {
    await page.goto(base + "/rewards");
    await page.getByRole("link", { name: "Đổi thưởng", exact: true }).click();
    await expect(page).toHaveURL(base + "/rewards/redeem");
    await expect(page.getByLabel("Số xu muốn đổi")).toBeVisible();
    await expect(page.getByText("1 xu = 1 đ", { exact: false })).toBeVisible();
    await expect(page.getByText("3.000 đ", { exact: true })).toBeVisible();
    const before = await state();
    expect(before.snapshot.available).toBe(300000);
  });
  await check(
    "Invalid negative UI entry is not silently converted to a positive amount",
    async () => {
      await page.getByLabel("Số xu muốn đổi").fill("-50000");
      await page.getByLabel("Tên chủ tài khoản", { exact: true }).fill("QA ONLY");
      await page.getByLabel("Số tài khoản ngân hàng").fill("1234567890");
      await page.getByLabel("Tên ngân hàng", { exact: true }).fill("TPBank");
      await page.getByRole("button", { name: "Xác nhận đổi thưởng" }).click();
      await expect(page.locator('.form-error[role="alert"]')).toContainText("số nguyên dương");
      expect((await state()).snapshot.reserved).toBe(0);
    },
  );
  await check("HTTP rejects forged ownership/rate, bad data and wrong Origin", async () => {
    const d = {
      coins: 50000,
      bank_name: "TPBank",
      account_number: "1234567890",
      account_name: "QA ONLY",
      idempotency_key: randomUUID(),
    };
    for (const extra of [{ coins: 0 }, { coin_value_vnd: 100 }, { user_id: credentials.adminId }])
      expect(
        (
          await user.request.post(base + "/api/rewards/redemptions", {
            headers: { Origin: base },
            data: { ...d, ...extra },
          })
        ).status(),
      ).toBe(400);
    expect(
      (
        await user.request.post(base + "/api/rewards/redemptions", {
          headers: { Origin: "https://invalid.example" },
          data: d,
        })
      ).status(),
    ).toBe(403);
  });
  let first;
  await check("UI submission creates pending hold and displays payout quote/history", async () => {
    first = await redeem();
    const s = await state();
    expect(s.snapshot.available).toBe(250000);
    expect(s.snapshot.reserved).toBe(50000);
    expect(first.amount - first.fee).toBe(47000);
    await expect(
      page.locator("#request-history").getByText("Đang chờ duyệt", { exact: true }),
    ).toBeVisible();
  });
  await check("User cannot open or settle Admin money detail", async () => {
    expect(
      (await user.request.get(`${base}/api/admin/money/WITHDRAWAL/${first.id}`)).status(),
    ).toBe(403);
    expect(
      (
        await user.request.post(`${base}/api/admin/money/WITHDRAWAL/${first.id}`, {
          headers: { Origin: base },
          data: { action: "COMPLETE", confirmed: true },
        })
      ).status(),
    ).toBe(403);
  });
  await check("Admin rejects redemption; history refresh restores availability once", async () => {
    await settle("WITHDRAWAL", first.id, "REJECT");
    await page.getByRole("button", { name: "Cập nhật trạng thái" }).click();
    await expect(
      page.locator("#request-history").getByText("Bị từ chối", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".cash-balance strong")).toHaveText("300.000 xu");
    expect((await state()).snapshot.reserved).toBe(0);
  });
  await check(
    "Admin failed-transfer action refunds held coins and displays failed status",
    async () => {
      const r = await redeem();
      await settle("WITHDRAWAL", r.id, "FAIL");
      await page.getByRole("button", { name: "Cập nhật trạng thái" }).click();
      await expect(
        page.locator("#request-history").getByText("Thất bại", { exact: true }),
      ).toBeVisible();
      expect((await state()).snapshot.available).toBe(300000);
    },
  );
  await check("Completed redemption updates coin history and never debits VND wallet", async () => {
    const r = await redeem();
    await settle("WITHDRAWAL", r.id);
    await page.getByRole("button", { name: "Cập nhật trạng thái" }).click();
    await expect(
      page.locator("#request-history").getByText("Đã chuyển tiền", { exact: true }),
    ).toBeVisible();
    await page.goto(base + "/rewards?view=history");
    await expect(
      page.locator(".transaction").getByRole("heading", { name: "Đổi thưởng", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".transaction .negative")).toHaveText("-50.000 xu");
    expect((await state()).snapshot.available).toBe(250000);
    const cash = (
      await pool.query("SELECT balance::int,reserved::int FROM cinevjet.wallets WHERE user_id=$1", [
        credentials.userId,
      ])
    ).rows[0];
    expect(cash).toEqual({ balance: 0, reserved: 0 });
  });
  let order;
  await check(
    "VIP API creates owned bill order from real plan without using VND balance",
    async () => {
      const source = (
        await pool.query(
          "SELECT b.* FROM cinevjet.deposit_bills b JOIN cinevjet.users u ON u.id=b.user_id WHERE u.email LIKE '%@money-ui.example.test' AND b.url LIKE '%/deposit-bills/%' ORDER BY b.created_at DESC LIMIT 1",
        )
      ).rows[0];
      if (!source)
        throw new Error(
          "Existing isolated QA bill media required; do not write to production Blob.",
        );
      const bill = randomUUID();
      await pool.query(
        "INSERT INTO cinevjet.deposit_bills(id,user_id,url,content_type,size_bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          bill,
          credentials.userId,
          source.url + "?qa=" + bill,
          source.content_type,
          source.size_bytes,
          source.width,
          source.height,
        ],
      );
      const plan = (
        await pool.query(
          "SELECT id,price FROM cinevjet.vip_plans WHERE active AND reward_enabled AND price>0 ORDER BY price LIMIT 1",
        )
      ).rows[0];
      const payload = { plan_id: plan.id, bill_id: bill, idempotency_key: randomUUID() };
      const r = await user.request.post(base + "/api/vip/purchases", {
        headers: { Origin: base },
        data: payload,
      });
      expect(r.status()).toBe(201);
      order = await r.json();
      expect(order.amount).toBe(Number(plan.price));
      expect(order.status).toBe("PENDING");
      const retry = await user.request.post(base + "/api/vip/purchases", {
        headers: { Origin: base },
        data: payload,
      });
      expect((await retry.json()).id).toBe(order.id);
      expect(
        (
          await pool.query("SELECT id FROM cinevjet.vip_subscriptions WHERE user_id=$1", [
            credentials.userId,
          ])
        ).rowCount,
      ).toBe(0);
      await page.goto(base + "/vip");
      await expect(
        page.locator("#request-history").getByText("Đang chờ duyệt", { exact: true }),
      ).toBeVisible();
    },
  );
  await check(
    "Admin verifies bill then activates VIP; user scene and rewards resolve real membership",
    async () => {
      await settle("VIP_PURCHASE", order.id, "APPROVE");
      await page.getByRole("button", { name: "Cập nhật trạng thái" }).click();
      await expect(
        page.locator("#request-history").getByText("Đã duyệt", { exact: true }),
      ).toBeVisible();
      await page.goto(base + "/rewards");
      await expect(page.locator(".reward-membership")).not.toHaveText("Free");
      const r = await user.request.get(base + "/api/rewards");
      expect((await r.json()).reward_tier).not.toBe("FREE");
      expect((await state()).snapshot.balance).toBe(250000);
    },
  );
  await check(
    "Admin finance filters expose VIP purchases and coin redemption separately",
    async () => {
      await studio.goto(base + "/admin/finance");
      await studio.getByRole("button", { name: "Đổi thưởng", exact: true }).click();
      await expect(studio.locator("tbody tr").first()).toContainText("xu");
      await studio.getByRole("button", { name: "VIP", exact: true }).click();
      await expect(studio.locator("tbody tr").first()).toContainText("Mua VIP");
    },
  );
  await check(
    "Mobile scenes at 360/390/430 pixels have no horizontal overflow and preserve navigation",
    async () => {
      for (const width of [360, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        for (const route of ["/rewards", "/rewards/redeem", "/vip"]) {
          await page.goto(base + route);
          await expect(page.locator(".bottom-nav a")).toHaveCount(5);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        }
      }
    },
  );
  await check("No browser runtime errors", async () => expect(errors).toEqual([]));
  await writeFile(
    "test-results/rewards-redemption-ui.json",
    JSON.stringify(
      {
        status: "PASS",
        tests: results.length,
        results,
        base,
        branch: "br-quiet-silence-b30z8m9u",
        productionWritten: false,
        newBlobObjectsWritten: 0,
        vipBillUpload:
          "Existing unchanged upload service reused; new checkout file validation/preview tested, successful upload not rerun against production store.",
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
  await browser.close();
}
