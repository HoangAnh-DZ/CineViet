import { z } from "zod";
export const referralPolicyInput = z
  .object({
    expected_version: z.string().min(1).max(100),
    rates_bps: z.tuple([
      z.number().int().min(0).max(10000),
      z.number().int().min(0).max(10000),
      z.number().int().min(0).max(10000),
    ]),
    reason: z.string().trim().min(10).max(500),
    confirmation: z.literal("CONFIRM_FUTURE_ORDERS"),
  })
  .strict()
  .refine((d) => d.rates_bps.reduce((a, b) => a + b, 0) <= 10000, {
    message: "Tổng tỷ lệ không được vượt 100%.",
  });
export function commissionAmount(amount: number, bps: number) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !Number.isInteger(bps) ||
    bps < 0 ||
    bps > 10000
  )
    throw new Error("Invalid commission basis");
  return Number((BigInt(amount) * BigInt(bps)) / 10000n);
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
