import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const base = "http://localhost:3010",
  credentials = JSON.parse(await readFile("test-results/money-preview-credentials.json", "utf8"));
const browser = await chromium.launch({ headless: true }),
  user = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["clipboard-read", "clipboard-write"],
  }),
  admin = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  guest = await browser.newContext();
const page = await user.newPage(),
  studio = await admin.newPage(),
  results = [];
const check = async (name, fn) => {
  await fn();
  results.push({ name, status: "PASS" });
  console.log("PASS " + name);
};
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
studio.on("pageerror", (e) => errors.push(e.message));
async function login(context, email) {
  const r = await context.request.post(base + "/api/auth/login", {
    headers: { Origin: base },
    data: { email, password: credentials.password, remember: false },
  });
  expect(r.status()).toBe(200);
}
async function balance() {
  return (await (await user.request.get(base + "/api/account")).json()).balance;
}
async function requestList() {
  return await (await user.request.get(base + "/api/money/requests")).json();
}
async function openAdmin(kind, id) {
  await studio.goto(`${base}/admin/finance?kind=${kind}&id=${id}`);
  await expect(studio.getByRole("dialog")).toBeVisible();
  await expect(
    studio.getByRole("dialog").getByText(credentials.userEmail, { exact: false }),
  ).toBeVisible();
}
async function settle(kind, id, reject = false) {
  await openAdmin(kind, id);
  const dialog = studio.getByRole("dialog");
  if (reject) {
    await dialog.getByRole("button", { name: "Từ chối", exact: true }).click();
    await dialog
      .getByLabel("Lý do gửi người dùng", { exact: false })
      .fill("QA thông tin chưa khớp");
  } else {
    await expect(
      dialog.getByRole("button", {
        name: kind === "DEPOSIT" ? "Xác nhận duyệt nạp" : "Xác nhận đã chuyển tiền",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog.getByRole("checkbox").check();
  }
  await dialog.getByLabel("Ghi chú nội bộ", { exact: false }).fill("INTERNAL QA ONLY");
  const response = studio.waitForResponse(
    (r) => r.url().endsWith(`/api/admin/money/${kind}/${id}`) && r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", {
      name: reject
        ? "Xác nhận từ chối"
        : kind === "DEPOSIT"
          ? "Xác nhận duyệt nạp"
          : "Xác nhận đã chuyển tiền",
      exact: true,
    })
    .click();
  expect((await response).status()).toBe(200);
  await expect(dialog).toBeHidden();
}
const image = await sharp(
  Buffer.from(
    '<svg width="640" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="400" fill="#f5f5f5"/><text x="40" y="90" font-size="32" fill="#111">CineVjet isolated QA</text><text x="40" y="180" font-size="28" fill="#b02030">NO REAL BANK TRANSFER</text><text x="40" y="260" font-size="22" fill="#222">Bill upload / preview / admin review</text></svg>',
  ),
)
  .png()
  .toBuffer();
async function deposit() {
  await page.goto(base + "/wallet/deposit");
  await page
    .locator("#deposit-bill")
    .setInputFiles({ name: "qa-bill.png", mimeType: "image/png", buffer: image });
  await expect(page.getByAltText("Preview bill chuyển khoản")).toBeVisible();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/money/deposits") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Gửi yêu cầu nạp tiền", exact: true }).click();
  const r = await response;
  expect(r.status()).toBe(201);
  return r.json();
}
async function withdraw(amount) {
  await page.goto(base + "/wallet/withdraw");
  await page.getByLabel("Số tiền rút", { exact: false }).fill(String(amount));
  await page.getByLabel("Ngân hàng nhận tiền").fill("TPBank");
  await page.getByLabel("Số tài khoản", { exact: true }).fill("1234567890");
  await page.getByLabel("Tên chủ tài khoản").fill("MONEY UI QA");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/money/withdrawals") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Gửi yêu cầu rút tiền", exact: true }).click();
  const r = await response;
  expect(r.status()).toBe(201);
  return r.json();
}
try {
  await login(user, credentials.userEmail);
  await login(admin, credentials.adminEmail);
  await check("NAV 1: Rewards renders five tabs without Wallet", async () => {
    await page.goto(base + "/rewards");
    await expect(
      page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link"),
    ).toHaveCount(5);
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).not.toContainText(
      "Ví",
    );
  });
  await check("NAV 2: Deposit opens from Rewards", async () => {
    await page.getByRole("link", { name: "Nạp tiền", exact: true }).click();
    await expect(page).toHaveURL(base + "/wallet/deposit");
  });
  await check("NAV 3: Deposit close targets Rewards", async () => {
    await expect(page.getByRole("link", { name: "Đóng", exact: true })).toHaveAttribute(
      "href",
      "/rewards",
    );
    await page.getByRole("link", { name: "Đóng", exact: true }).click();
  });
  await check("NAV 4: Deposit back returns Rewards", async () => {
    await page.getByRole("link", { name: "Nạp tiền", exact: true }).click();
    await page.getByRole("link", { name: "Quay lại", exact: true }).click();
    await expect(page).toHaveURL(base + "/rewards");
  });
  await check("NAV 5: Withdrawal opens from Rewards", async () => {
    await page.getByRole("link", { name: "Rút tiền", exact: true }).click();
    await expect(page).toHaveURL(base + "/wallet/withdraw");
  });
  await check("NAV 6: Withdrawal close returns Rewards", async () => {
    await page.getByRole("link", { name: "Đóng", exact: true }).click();
    await expect(page).toHaveURL(base + "/rewards");
  });
  await check("NAV 7: Withdrawal back returns Rewards", async () => {
    await page.getByRole("link", { name: "Rút tiền", exact: true }).click();
    await page.getByRole("link", { name: "Quay lại", exact: true }).click();
    await expect(page).toHaveURL(base + "/rewards");
  });
  await check("NAV 8: External returnTo cannot open legacy Wallet or external URL", async () => {
    await page.goto(base + "/wallet/deposit?returnTo=https://example.com");
    await expect(page.getByRole("link", { name: "Quay lại", exact: true })).toHaveAttribute(
      "href",
      "/rewards",
    );
    await expect(page.getByRole("link", { name: "Đóng", exact: true })).toHaveAttribute(
      "href",
      "/rewards",
    );
  });
  await check("Deposit TPBank copy controls and mobile layout", async () => {
    await expect(page.locator(".deposit-bank")).toContainText("TPBank");
    await expect(page.locator(".deposit-bank")).toContainText("0000000000");
    await expect(page.locator(".deposit-bank")).toContainText("EXAMPLE ACCOUNT");
    await page.getByRole("button", { name: "Copy số tài khoản" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("0000000000");
    await page.getByRole("button", { name: "Copy số tiền" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("200000");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: "test-results/money-deposit-mobile.png", fullPage: true });
  });
  await check("Deposit invalid MIME rejected by form and API", async () => {
    await page
      .locator("#deposit-bill")
      .setInputFiles({
        name: "bill.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from("<svg/>"),
      });
    await expect(page.locator(".form-error[role=alert]")).toContainText("Bill phải");
    const r = await user.request.post(base + "/api/money/bills", {
      headers: { Origin: base },
      multipart: {
        bill: { name: "bill.png", mimeType: "image/png", buffer: Buffer.from("not an image") },
      },
    });
    expect(r.status()).toBe(400);
  });
  const before = await balance();
  let incoming;
  await check(
    "Deposit real Blob upload + preview creates pending without cash credit",
    async () => {
      incoming = await deposit();
      expect(incoming.status).toBe("PENDING");
      expect(incoming.bill_url).toMatch(
        /^https:\/\/1uun41e8ziuloclw\.public\.blob\.vercel-storage\.com\/deposit-bills\//,
      );
      expect((await user.request.get(incoming.bill_url)).status()).toBe(200);
      expect((await balance()).cash).toBe(before.cash);
      await expect(page.getByRole("status").filter({ hasText: "Đã gửi yêu cầu" })).toBeVisible();
    },
  );
  await check("Admin bill lightbox and full bank/user info", async () => {
    await openAdmin("DEPOSIT", incoming.id);
    const dialog = studio.getByRole("dialog");
    await expect(dialog).toContainText("EXAMPLE ACCOUNT");
    await dialog.getByRole("button", { name: "Xem bill lớn" }).click();
    await expect(dialog.getByRole("button", { name: "Thu nhỏ bill" })).toBeVisible();
    await expect(dialog.getByAltText("Bill chuyển khoản")).toBeVisible();
    await studio.screenshot({ path: "test-results/money-admin-bill.png", fullPage: true });
    await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  });
  await check(
    "Admin approval requires confirmation, credits cash once and shows audit",
    async () => {
      await settle("DEPOSIT", incoming.id);
      expect((await balance()).cash).toBe(before.cash + 200000);
      await openAdmin("DEPOSIT", incoming.id);
      await expect(studio.getByRole("dialog")).toContainText("DEPOSIT_APPROVED");
      await expect(
        studio.getByRole("dialog").getByRole("button", { name: "Xác nhận duyệt nạp", exact: true }),
      ).toHaveCount(0);
      await studio.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
    },
  );
  await check(
    "Deposit rejection leaves cash unchanged and history hides internal notes",
    async () => {
      const d = await deposit(),
        cash = (await balance()).cash;
      await settle("DEPOSIT", d.id, true);
      expect((await balance()).cash).toBe(cash);
      await page.reload();
      await expect(page.locator(".money-history")).toContainText("Bị từ chối");
      await expect(page.locator(".money-history")).toContainText("QA thông tin chưa khớp");
      await expect(page.locator(".money-history")).not.toContainText("INTERNAL QA ONLY");
    },
  );
  let outgoing;
  await check("Withdrawal bank form shows fee/net and holds available cash", async () => {
    const before = await balance();
    outgoing = await withdraw(100000);
    const after = await balance();
    expect(after.cash).toBe(before.cash);
    expect(after.available).toBe(before.available - 100000);
    await expect(page.locator(".money-history")).toContainText("97.000 đ");
    await expect(page.locator(".money-history")).toContainText("1234567890");
    await page.screenshot({ path: "test-results/money-withdraw-mobile.png", fullPage: true });
  });
  await check("Admin manual withdrawal completion requires transferred checkbox", async () => {
    const before = await balance();
    await openAdmin("WITHDRAWAL", outgoing.id);
    await expect(studio.getByRole("dialog")).toContainText("97.000 đ");
    await expect(studio.getByRole("dialog").getByRole("checkbox")).toHaveAccessibleName(
      "Tôi xác nhận đã chuyển tiền",
    );
    await expect(studio.getByRole("dialog")).not.toContainText("txHash");
    await studio.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
    await settle("WITHDRAWAL", outgoing.id);
    const after = await balance();
    expect(after.cash).toBe(before.cash - 100000);
    expect(after.available).toBe(before.available);
  });
  await check("Withdrawal rejection releases hold without deducting cash", async () => {
    const before = await balance(),
      r = await withdraw(50000);
    await settle("WITHDRAWAL", r.id, true);
    expect(await balance()).toEqual(before);
    await page.reload();
    await expect(page.locator(".money-history")).toContainText("Bị từ chối");
  });
  await check("Finance periods, bill thumbnails and recent links", async () => {
    await studio.goto(base + "/admin/finance");
    for (const name of ["Hôm nay", "7 ngày", "Tháng này", "Toàn thời gian"])
      await expect(
        studio.locator(".money-period-heading").getByRole("button", { name, exact: true }),
      ).toBeVisible();
    await studio.getByRole("button", { name: "Nạp", exact: true }).click();
    await expect(studio.locator(".money-table-bill").first()).toBeVisible();
    await studio.goto(base + "/admin");
    const link = studio.getByRole("link", { name: "Xem chi tiết", exact: true }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(studio.getByRole("dialog")).toBeVisible();
    await studio.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click();
  });
  await check("Admin member money summary is read-only and accurate", async () => {
    await studio.goto(base + "/admin/users");
    await studio.getByRole("textbox", { name: "Tìm kiếm người dùng" }).fill(credentials.userEmail);
    await studio.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
    await expect(studio.locator("tbody tr")).toHaveCount(1);
    await studio.getByRole("button", { name: "Chi tiết Finance QA user" }).click();
    await expect(
      studio.getByRole("heading", { name: "Tổng quan tiền của thành viên" }),
    ).toBeVisible();
    await expect(studio.getByRole("dialog")).toContainText(
      (before.cash + 100000).toLocaleString("vi-VN") + " đ",
    );
    await expect(studio.getByRole("dialog")).toContainText("Tổng nạp đã duyệt");
    await expect(studio.getByRole("dialog")).toContainText("Nạp đang chờ");
  });
  await check("API guest/auth/admin/origin/payload boundaries", async () => {
    const data = { amount: 50000, bill_id: randomUUID(), idempotency_key: randomUUID() };
    expect(
      (
        await guest.request.post(base + "/api/money/deposits", { headers: { Origin: base }, data })
      ).status(),
    ).toBe(401);
    expect(
      (await user.request.get(`${base}/api/admin/money/DEPOSIT/${incoming.id}`)).status(),
    ).toBe(403);
    expect(
      (
        await user.request.post(base + "/api/money/deposits", {
          headers: { Origin: "https://example.com" },
          data,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await user.request.post(base + "/api/money/deposits", {
          headers: { Origin: base },
          data: { ...data, status: "COMPLETED" },
        })
      ).status(),
    ).toBe(400);
    expect((await guest.request.get(base + "/api/money/requests")).status()).toBe(401);
  });
  await check("No browser runtime errors on financial flows", async () => {
    expect(errors).toEqual([]);
  });
  await writeFile(
    "test-results/manual-money-ui.json",
    JSON.stringify(
      {
        status: "PASS",
        tests: results.length,
        results,
        productionWritten: false,
        realBlobUpload: true,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
