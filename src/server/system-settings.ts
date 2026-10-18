import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { ApiError } from "./http";
import { BILL_MAX_BYTES } from "@/domain/money";

export type SystemSettings = {
  deposit_enabled: boolean;
  withdrawal_enabled: boolean;
  bank_name: string;
  account_number: string;
  account_name: string;
  min_deposit: number;
  min_withdrawal: number;
  max_amount: number;
  withdrawal_fee: number;
  withdrawal_fee_bps: number;
  bill_max_bytes: number;
};

const defaults = (): SystemSettings => ({
  deposit_enabled: true,
  withdrawal_enabled: true,
  bank_name: process.env.DEPOSIT_BANK_NAME || "TPBank",
  account_number: process.env.DEPOSIT_BANK_ACCOUNT_NUMBER || "0000000000",
  account_name: process.env.DEPOSIT_BANK_ACCOUNT_NAME || "EXAMPLE ACCOUNT",
  min_deposit: 50000,
  min_withdrawal: 35000,
  max_amount: 100000000,
  withdrawal_fee: 3000,
  withdrawal_fee_bps: 400,
  bill_max_bytes: BILL_MAX_BYTES,
});

function dto(row: Record<string, unknown> | undefined): SystemSettings {
  const fallback = defaults();
  return {
    ...fallback,
    deposit_enabled:
      row?.deposit_enabled === undefined ? fallback.deposit_enabled : Boolean(row.deposit_enabled),
    withdrawal_enabled:
      row?.withdrawal_enabled === undefined
        ? fallback.withdrawal_enabled
        : Boolean(row.withdrawal_enabled),
    bank_name: row?.bank_name ? String(row.bank_name) : fallback.bank_name,
    account_number: row?.account_number ? String(row.account_number) : fallback.account_number,
    account_name: row?.account_name ? String(row.account_name) : fallback.account_name,
    min_deposit: Number(row?.min_deposit ?? fallback.min_deposit),
    min_withdrawal: Number(row?.min_withdrawal ?? fallback.min_withdrawal),
    max_amount: Number(row?.max_amount ?? fallback.max_amount),
    withdrawal_fee: Number(row?.withdrawal_fee ?? fallback.withdrawal_fee),
    withdrawal_fee_bps: Number(row?.withdrawal_fee_bps ?? fallback.withdrawal_fee_bps),
  };
}

export async function moneyConfig(
  options: { requireStoredBank?: boolean } = {},
): Promise<SystemSettings> {
  try {
    const result = await database().execute(
      sql`SELECT deposit_enabled,withdrawal_enabled,bank_name,account_number,account_name,min_deposit,min_withdrawal,max_amount,withdrawal_fee,withdrawal_fee_bps FROM cinevjet.system_settings WHERE id='default'`,
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(503, "Chưa tải được cấu hình giao dịch.");
    if (
      options.requireStoredBank &&
      (!row ||
        !String(row.bank_name || "").trim() ||
        !/^\d{4,40}$/.test(String(row.account_number || "")) ||
        !String(row.account_name || "").trim())
    )
      throw new ApiError(
        503,
        "Chưa có tài khoản ngân hàng nhận tiền hợp lệ. Vui lòng liên hệ hỗ trợ.",
      );
    return dto(row);
  } catch {
    if (options.requireStoredBank)
      throw new ApiError(503, "Chưa tải được tài khoản nhận tiền. Vui lòng thử lại sau.");
    throw new ApiError(503, "Chưa tải được cấu hình giao dịch. Vui lòng thử lại sau.");
  }
}

const input = z
  .object({
    deposit_enabled: z.boolean(),
    withdrawal_enabled: z.boolean(),
    bank_name: z.string().trim().min(2).max(100),
    account_number: z.string().trim().min(4).max(40),
    account_name: z.string().trim().min(2).max(120),
    min_deposit: z.number().int().min(1).max(1_000_000_000),
    min_withdrawal: z.number().int().min(1).max(1_000_000_000),
    max_amount: z.number().int().min(1).max(10_000_000_000),
    withdrawal_fee: z.number().int().min(0).max(1_000_000),
    withdrawal_fee_bps: z.literal(400).default(400),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.max_amount < value.min_withdrawal)
      ctx.addIssue({
        code: "custom",
        path: ["max_amount"],
        message: "Hạn mức tối đa phải lớn hơn mức rút tối thiểu.",
      });
  });

export async function adminSystemSettings(actor: string) {
  await assertAdmin(actor);
  return moneyConfig();
}

export async function updateSystemSettings(actor: string, raw: unknown) {
  await assertAdmin(actor);
  const value = input.parse(raw);
  if (!value.deposit_enabled && !value.withdrawal_enabled)
    throw new ApiError(400, "Không thể tắt đồng thời cả nạp và rút tiền.");
  await database().execute(
    sql`UPDATE cinevjet.system_settings SET deposit_enabled=${value.deposit_enabled},withdrawal_enabled=${value.withdrawal_enabled},bank_name=${value.bank_name},account_number=${value.account_number},account_name=${value.account_name},min_deposit=${value.min_deposit},min_withdrawal=${value.min_withdrawal},max_amount=${value.max_amount},withdrawal_fee=${value.withdrawal_fee},updated_by=${actor},updated_at=now() WHERE id='default'`,
  );
  return moneyConfig();
}
