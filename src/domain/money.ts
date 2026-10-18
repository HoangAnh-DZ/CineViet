import { z } from "zod";
import { validWithdrawalSelection } from "./product-policy";
export const BILL_MAX_BYTES = 3 * 1024 * 1024;
const extensions: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};
export function validBillFile(name: string, mime: string, size: number) {
  return (
    Number.isInteger(size) &&
    size > 0 &&
    size <= BILL_MAX_BYTES &&
    !!extensions[mime]?.includes(name.toLowerCase().split(".").at(-1) || "")
  );
}
const amount = z
  .number()
  .int()
  .min(50000, "Tối thiểu 50.000 đ.")
  .max(100000000, "Tối đa 100.000.000 đ.");
const note = z.string().trim().max(500).optional().default("");
export const depositInput = z
  .object({ amount, bill_id: z.string().uuid(), note, idempotency_key: z.string().uuid() })
  .strict();
export const withdrawalInput = z
  .object({
    amount: z
      .number()
      .int()
      .refine(
        validWithdrawalSelection,
        "Chọn 35.000đ, 70.000đ, 110.000đ hoặc nhập số tiền lớn hơn 110.000đ.",
      ),
    bank_name: z.string().trim().min(2).max(100),
    account_number: z
      .string()
      .trim()
      .regex(/^\d{6,30}$/, "Số tài khoản từ 6–30 chữ số."),
    account_name: z.string().trim().min(2).max(100),
    bank_code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    note,
    idempotency_key: z.string().uuid(),
  })
  .strict();
export const reviewInput = z
  .object({
    action: z.enum(["APPROVE", "COMPLETE", "REJECT", "FAIL", "PROCESS"]),
    note,
    reason: z.string().trim().max(300).optional().default(""),
    confirmed: z.boolean().optional().default(false),
    evidence_reference: z.string().trim().min(4).max(120).optional(),
    proof_bill_id: z.string().uuid().optional(),
  })
  .strict();
export type MoneyKind = "DEPOSIT" | "WITHDRAWAL" | "VIP_PURCHASE";
export type MoneyRequest = {
  id: string;
  kind: MoneyKind;
  amount: number;
  fee: number;
  status: string;
  created_at: string;
  completed_at: string | null;
  rejected_at: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  bill_url: string | null;
  user_note: string | null;
  review_note: string | null;
  source_asset: "VND" | "COIN";
  coins_amount: number | null;
  coin_value_vnd: number | null;
  plan_name: string | null;
  plan_id?: string | null;
  payment_expires_at?: string | null;
  payment_reference?: string | null;
  provider?: string;
  order_code?: number | null;
  payos_status?: string | null;
  queue_status?: string | null;
  queue_attempts?: number;
  payout_reference?: string | null;
  queue_error?: string | null;
};
export type VipBankRequest = MoneyRequest & {
  transfer_bank: { bank_name: string; account_number: string; account_name: string };
  plan: {
    name: string;
    price: number;
    duration_days: number;
    mission_count: number;
    mission_reward: number;
    total_videos: number;
  };
  vip_expires_at: string | null;
};
export const moneyStatus = (kind: MoneyKind, status: string) =>
  status === "PENDING"
    ? "Đang chờ duyệt"
    : status === "COMPLETED"
      ? kind !== "WITHDRAWAL"
        ? "Đã duyệt"
        : "Đã chuyển tiền"
      : status === "REJECTED"
        ? "Bị từ chối"
        : status === "FAILED"
          ? "Thất bại"
          : "Đang xử lý";
export const queueStatus = (s: string) =>
  ({
    QUEUED: "Trong hàng đợi",
    MANUAL_REVIEW: "Chờ chuyển khoản thủ công",
    PROCESSING: "Đang xử lý",
    SUBMITTED: "Đang chờ ngân hàng",
    RETRY_WAIT: "Chờ thử lại",
    NEEDS_RECONCILIATION: "Cần kiểm tra",
    SUCCEEDED: "Đã chuyển tiền",
    FAILED: "Thất bại",
    CANCELLED: "Đã hủy",
  })[s] || "Chờ xử lý";
export const moneyReturnTo = "/rewards";
export const redemptionInput = withdrawalInput
  .omit({ amount: true })
  .extend({ coins: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
  .strict();
export const vipPurchaseInput = z
  .object({
    plan_id: z.string().trim().min(1).max(80),
    bill_id: z.string().uuid().optional(),
    idempotency_key: z.string().uuid(),
    note,
  })
  .strict();
