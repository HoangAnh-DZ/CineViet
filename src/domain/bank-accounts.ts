import { z } from "zod";

const normalizedText = (max: number) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, " "))
    .pipe(z.string().min(2, "Vui lòng nhập tên chủ tài khoản.").max(max));
export const bankAccountInput = z
  .object({
    bank_code: z.string().regex(/^\d{6}$/, "Vui lòng chọn ngân hàng trong danh sách."),
    account_number: z
      .string()
      .transform((v) => v.replace(/\s/g, ""))
      .pipe(z.string().regex(/^\d{4,40}$/, "Số tài khoản phải gồm 4–40 chữ số.")),
    account_holder_name: normalizedText(120),
    nickname: z.string().trim().max(60).optional().default(""),
  })
  .strict();
export const savedRedemptionInput = z
  .object({
    coins: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    bank_account_id: z.string().uuid(),
    idempotency_key: z.string().uuid(),
    note: z.string().trim().max(500).optional().default(""),
  })
  .strict();
export type SavedBankAccount = {
  id: string;
  bank_code: string;
  bank_name: string;
  bank_label: string;
  account_number_masked: string;
  account_holder_name: string;
  nickname: string;
  is_default: boolean;
};
export type BankOption = { code: string; name: string; label: string };
export const maskBankNumber = (value: string) => "•••• " + value.replace(/\s/g, "").slice(-4);
