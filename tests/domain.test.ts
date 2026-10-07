import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDay,
  checkInDays,
  parseVnd,
  withdrawalQuote,
  deriveEntitlements,
} from "../src/domain/rules.ts";
import type { VipPlan, VipSubscription } from "../src/domain/models.ts";
test("calendar days follow configured server timezone at midnight boundary", () => {
  assert.equal(calendarDay(new Date("2026-10-06T17:01:00Z")), "2026-10-07");
  assert.equal(calendarDay(new Date("2026-10-06T16:59:00Z")), "2026-10-06");
});
test("seven-day cycle exposes only one claim and locks after a claim", () => {
  const days = checkInDays(3, false);
  assert.equal(days.length, 7);
  assert.equal(days[3].status, "AVAILABLE");
  assert.equal(days[4].status, "LOCKED");
  assert.equal(checkInDays(4, true).filter((d) => d.status === "AVAILABLE").length, 0);
  assert.equal(checkInDays(0, false)[0].status, "AVAILABLE");
});
test("money rejects decimals, negative, unsafe and below-minimum values", () => {
  for (const value of ["50000.5", "-100000", "1e6", "NaN", "49999", "9007199254740993"])
    assert.throws(() => parseVnd(value));
  assert.equal(parseVnd("200000"), 200000);
});
test("withdrawal quote does integer math and checks available balance", () => {
  assert.deepEqual(withdrawalQuote(200000, 1250000), {
    amount: 200000,
    fee: 3000,
    net_amount: 197000,
  });
  assert.throws(() => withdrawalQuote(1300000, 1250000));
  assert.throws(() => withdrawalQuote(49999, 1250000));
});
test("VIP permissions require active paid subscription and server time", () => {
  const plans: VipPlan[] = [
    {
      id: "VIP_MONTHLY",
      name: "Monthly",
      price: 99000,
      duration_days: 30,
      benefits: ["VIP_MOVIES", "FULL_HD"],
      active: true,
      discount: 0,
    },
  ];
  const sub: VipSubscription = {
    id: "s",
    user_id: "u",
    plan_id: "VIP_MONTHLY",
    status: "ACTIVE",
    started_at: "2026-10-01T00:00:00Z",
    expires_at: "2026-11-01T00:00:00Z",
  };
  assert.equal(deriveEntitlements(null, plans, new Date()).size, 0);
  assert.equal(deriveEntitlements(sub, plans, new Date("2026-10-07")).has("VIP_MOVIES"), true);
  assert.equal(deriveEntitlements(sub, plans, new Date("2026-11-01")).size, 0);
  assert.equal(
    deriveEntitlements({ ...sub, status: "CANCELLED" }, plans, new Date("2026-10-07")).size,
    0,
  );
});
