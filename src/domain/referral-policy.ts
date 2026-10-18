import { z } from "zod";
// PostgreSQL integer storage, not a business or budget limit.
export const MAX_REFERRAL_BPS = 2147483647;
export const referralRate = z.number().int().min(0).max(MAX_REFERRAL_BPS);
export const referralPolicyInput = z
  .object({
    expected_version: z.string().min(1).max(100),
    rates_bps: z.tuple([referralRate, referralRate, referralRate]),
    reason: z.string().trim().min(10).max(500),
    confirmation: z.literal("CONFIRM_FUTURE_ORDERS"),
  })
  .strict();
export function commissionAmount(amount: number, bps: number) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Number.isInteger(bps) ||
    bps < 0 ||
    bps > MAX_REFERRAL_BPS
  )
    throw new Error("Invalid commission basis");
  const value = (BigInt(amount) * BigInt(bps)) / 10000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Commission exceeds integer precision");
  return Number(value);
}
export const reportFilters = z
  .object({
    mode: z.enum(["ALL", "BUSINESS"]).default("ALL"),
    period: z.enum(["TODAY", "WEEK", "MONTH", "ALL"]).default("ALL"),
  })
  .strict();
export const reportClassificationInput = z
  .object({
    target_kind: z.enum(["DEPOSIT", "VIP_PURCHASE", "WITHDRAWAL"]),
    target_id: z.string().min(1).max(100),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    expected_revision: z.string().uuid().nullable(),
    excluded: z.boolean(),
    reason: z.string().trim().min(10).max(500),
    confirmation: z.literal("CONFIRM_REPORT_ONLY"),
  })
  .strict();
