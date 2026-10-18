import type { CheckInDay, Entitlement, VipPlan, VipSubscription } from "./models.ts";
import { withdrawalFee } from "./product-policy.ts";
export const CHECK_IN_REWARDS = [10, 15, 20, 25, 30, 40, 60] as const;
export const CHECK_IN_TIMEZONE = "Asia/Ho_Chi_Minh";
export function calendarDay(now: Date, timezone = CHECK_IN_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function checkInDays(
  claimed: number,
  claimedToday: boolean,
  rewards: readonly number[] = CHECK_IN_REWARDS,
): CheckInDay[] {
  return rewards.map((reward, i) => ({
    day: i + 1,
    reward,
    status: i < claimed ? "CLAIMED" : i === claimed && !claimedToday ? "AVAILABLE" : "LOCKED",
  }));
}
export function parseVnd(value: string, minimum = 50_000): number {
  if (!/^\d+$/.test(value)) throw new Error("Nhập số tiền nguyên hợp lệ.");
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < minimum || amount > 100_000_000)
    throw new Error(`Số tiền từ ${minimum.toLocaleString("vi-VN")} đ đến 100.000.000 đ.`);
  return amount;
}
export function withdrawalQuote(amount: number, available: number, fee = withdrawalFee(amount)) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 35_000 ||
    amount > 100000000 ||
    amount > available ||
    amount <= fee
  )
    throw new Error("Số tiền rút vượt số dư hoặc dưới 35.000 đ.");
  return { amount, fee, net_amount: amount - fee };
}
export function deriveEntitlements(
  subscription: VipSubscription | null,
  plans: VipPlan[],
  serverNow: Date,
): ReadonlySet<Entitlement> {
  if (
    !subscription ||
    subscription.status !== "ACTIVE" ||
    Date.parse(subscription.started_at) > serverNow.getTime() ||
    Date.parse(subscription.expires_at) <= serverNow.getTime()
  )
    return new Set();
  return new Set(plans.find((p) => p.id === subscription.plan_id && p.active)?.benefits ?? []);
}
