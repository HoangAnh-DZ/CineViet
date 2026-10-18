import "server-only";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { ApiError } from "./http";
type Executor = Pick<ReturnType<typeof database>, "execute">;

export async function purchasedVipPlanIds(userId: string) {
  const r = await database().execute(
    sql`SELECT plan_id FROM cinevjet.vip_purchase_requests WHERE user_id=${userId} AND status='COMPLETED' UNION SELECT plan_id FROM cinevjet.vip_subscriptions WHERE user_id=${userId} AND plan_id<>'FREE'`,
  );
  return r.rows.map((r) => String(r.plan_id));
}
// Call while holding the user row lock, both before creating a purchase and
// before activation. Expiry or upgrading never resets lifetime eligibility.
export async function assertVipPlanNotPurchased(
  tx: Executor,
  userId: string,
  planId: string,
  requestId?: string,
) {
  const found = (
    await tx.execute(
      sql`SELECT plan_id FROM cinevjet.vip_purchase_requests WHERE user_id=${userId} AND plan_id=${planId} AND status='COMPLETED' AND id<>${requestId || ""} UNION SELECT plan_id FROM cinevjet.vip_subscriptions WHERE user_id=${userId} AND plan_id=${planId} LIMIT 1`,
    )
  ).rows[0];
  if (found)
    throw new ApiError(
      409,
      requestId
        ? "Gói này đã được mua trước đó. Đơn vừa nhận tiền cần hỗ trợ đối soát; vui lòng không chuyển thêm tiền."
        : "Bạn đã mua gói này. Mỗi tài khoản chỉ được mua mỗi gói VIP một lần; hãy chọn gói khác chưa mua.",
    );
}
