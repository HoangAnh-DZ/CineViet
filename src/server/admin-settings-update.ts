import "server-only";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { moneyConfig } from "./money-config";
import { ApiError } from "./http";
const input = z
  .object({
    deposit_enabled: z.boolean(),
    withdrawal_enabled: z.boolean(),
    min_deposit: z.number().int().min(1).max(1_000_000_000),
    min_withdrawal: z.number().int().min(1).max(1_000_000_000),
    max_amount: z.number().int().min(1).max(10_000_000_000),
    withdrawal_fee_bps: z.literal(400),
  })
  .strict();
export async function updateTransactionSettings(actor: string, raw: unknown) {
  await assertAdmin(actor);
  const v = input.parse(raw);
  if (v.max_amount < Math.max(v.min_deposit, v.min_withdrawal))
    throw new ApiError(400, "Hạn mức phải lớn hơn mức tối thiểu.");
  if (!v.deposit_enabled && !v.withdrawal_enabled)
    throw new ApiError(400, "Không thể tắt đồng thời cả nạp và rút tiền.");
  await database().execute(
    sql`UPDATE cinevjet.system_settings SET deposit_enabled=${v.deposit_enabled},withdrawal_enabled=${v.withdrawal_enabled},min_deposit=${v.min_deposit},min_withdrawal=${v.min_withdrawal},max_amount=${v.max_amount},updated_by=${actor},updated_at=now() WHERE id='default'`,
  );
  return moneyConfig();
}
