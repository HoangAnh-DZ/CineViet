import { z } from "zod";
export const paymentInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("DEPOSIT"),
      amount: z.number().int().min(50000).max(100000000),
      idempotency_key: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("VIP_PURCHASE"),
      plan_id: z.string().min(1).max(80),
      idempotency_key: z.string().uuid(),
    })
    .strict(),
]);
export type PayosOrder = {
  id: string;
  kind: "DEPOSIT" | "VIP_PURCHASE";
  order_code: number;
  amount: number;
  status: string;
  checkout_url: string | null;
  qr_code: string | null;
  expires_at: string;
  payment_link_id?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  bank_code?: string | null;
  plan_id?: string | null;
  plan_name?: string | null;
  duration_days?: number | null;
  vip_expires_at?: string | null;
};
export const terminalPayment = (status: string) =>
  ["PAID", "CANCELLED", "EXPIRED", "FAILED"].includes(status);
export const paymentStatus = (status: string) =>
  ({
    CREATING: "Đang tạo thanh toán",
    PENDING: "Chờ thanh toán",
    UNDERPAID: "Chưa thanh toán đủ",
    PROCESSING: "Đang xử lý",
    PAID: "Đã thanh toán",
    CANCELLED: "Đã hủy",
    EXPIRED: "Đã hết hạn",
    FAILED: "Thanh toán thất bại",
  })[status] || "Đang kiểm tra";
