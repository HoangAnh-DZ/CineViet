import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { ApiError } from "./http";

const planInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    price: z.number().int().min(0).max(10_000_000_000),
    duration_days: z.number().int().min(0).max(3650),
    active: z.boolean(),
    purchase_enabled: z.boolean(),
    mission_count: z.number().int().min(0).max(100),
    mission_reward: z.number().int().min(0).max(10_000_000),
    additional_amount: z.number().int().min(0).max(10_000_000_000).optional(),
  })
  .strict();

export async function updateVipPlan(actor: string, id: string, raw: unknown) {
  await assertAdmin(actor);
  const value = planInput.parse(raw);
  if (id === "FREE" && (value.price !== 0 || value.purchase_enabled || value.mission_count !== 0))
    throw new ApiError(400, "Gói Free chỉ dùng cho điểm danh mặc định.");
  if (value.purchase_enabled && (!value.active || value.price <= 0))
    throw new ApiError(400, "Gói đang bán phải hoạt động và có giá lớn hơn 0.");
  const result = await database().execute(
    sql`UPDATE cinevjet.vip_plans SET name=${value.name},price=${value.price},duration_days=${value.duration_days},active=${value.active},purchase_enabled=${value.purchase_enabled},mission_count=${value.mission_count},mission_reward=${value.mission_reward},additional_amount=COALESCE(${value.additional_amount ?? null},additional_amount) WHERE id=${id} RETURNING id,name,price,duration_days,active,purchase_enabled,mission_count,mission_reward,additional_amount`,
  );
  if (!result.rows.length) throw new ApiError(404, "Gói VIP không tồn tại.");
  const row = result.rows[0];
  return {
    ...row,
    price: Number(row.price),
    duration_days: Number(row.duration_days),
    mission_count: Number(row.mission_count),
    mission_reward: Number(row.mission_reward),
    additional_amount: Number(row.additional_amount),
  };
}
