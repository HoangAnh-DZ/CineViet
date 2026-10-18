import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const base = "http://localhost:3010",
  credentials = JSON.parse(await readFile("test-results/rewards-preview-credentials.json", "utf8"));
const browser = await chromium.launch({ headless: true }),
  user = await browser.newContext({ viewport: { width: 390, height: 844 } }),
  admin = await browser.newContext(),
  page = await user.newPage();
try {
  for (const [c, email] of [
    [user, credentials.userEmail],
    [admin, credentials.adminEmail],
  ])
    expect(
      (
        await c.request.post(base + "/api/auth/login", {
          headers: { Origin: base },
          data: { email, password: credentials.password, remember: false },
        })
      ).status(),
    ).toBe(200);
  const before = (await (await user.request.get(base + "/api/rewards/redemptions")).json())
    .snapshot;
  let committed,
    first = true;
  // Inject response loss after a real server commit; never substitute a mock response.
  await page.route("**/api/rewards/redemptions", async (route) => {
    if (first && route.request().method() === "POST") {
      first = false;
      const r = await route.fetch();
      expect(r.status()).toBe(201);
      committed = await r.json();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto(base + "/rewards/redeem");
  await page.getByLabel("Số xu muốn đổi").fill("50000");
  await page.getByLabel("Tên chủ tài khoản", { exact: true }).fill("QA LOST RESPONSE");
  await page.getByLabel("Số tài khoản ngân hàng").fill("1234567890");
  await page.getByLabel("Tên ngân hàng", { exact: true }).fill("TPBank");
  await page.getByRole("button", { name: "Xác nhận đổi thưởng", exact: true }).click();
  await expect(page.locator('.form-error[role="alert"]')).toBeVisible();
  expect(committed.status).toBe("PENDING");
  expect(
    (
      await admin.request.post(`${base}/api/admin/money/WITHDRAWAL/${committed.id}`, {
        headers: { Origin: base },
        data: {
          action: "COMPLETE",
          confirmed: true,
          note: "QA real server flow, no actual transfer",
        },
      })
    ).status(),
  ).toBe(200);
  const retry = page.waitForResponse(
    (r) => r.url().endsWith("/api/rewards/redemptions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Xác nhận đổi thưởng", exact: true }).click();
  const response = await retry;
  expect(response.status()).toBe(201);
  const result = await response.json();
  expect(result.id).toBe(committed.id);
  expect(result.status).toBe("COMPLETED");
  await expect(page.locator(".money-success")).toContainText("Đã chuyển tiền");
  await expect(page.locator(".money-success")).not.toContainText("Xu được giữ");
  const after = await (await user.request.get(base + "/api/rewards/redemptions")).json();
  expect(after.snapshot.balance).toBe(before.balance - 50000);
  expect(after.snapshot.reserved).toBe(before.reserved);
  expect(after.requests.filter((r) => r.id === committed.id)).toHaveLength(1);
  await writeFile(
    "test-results/reward-retry-ui.json",
    JSON.stringify(
      {
        status: "PASS",
        tests: 1,
        responseLossAfterRealCommit: true,
        retryAfterAdminCompletion: true,
        reservedOnce: true,
        productionWritten: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS Lost response and retry after completion preserve one request/debit and display the actual terminal status.",
  );
} finally {
  await browser.close();
}
