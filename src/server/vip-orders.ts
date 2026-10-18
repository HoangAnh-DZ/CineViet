import "server-only";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { userVipPurchases, vipBankRequest } from "./vip-purchases";
import { purchasedVipPlanIds } from "./vip-eligibility";
import { cancelVipPayment } from "./payos-payments";
import { ApiError } from "./http";

export async function vipOrderState(userId: string) {
  // History GET is read-only. Expiry/settlement runs through the authenticated
  // reconciliation POST, verified webhook or authorized worker instead.
  const [requests, purchased] = await Promise.all([
    userVipPurchases(userId),
    purchasedVipPlanIds(userId),
  ]);
  return { requests, purchased };
}
export async function cancelVipOrder(userId: string, id: string) {
  const r = (
    await database().execute(
      sql`SELECT provider FROM cinevjet.vip_purchase_requests WHERE id=${id} AND user_id=${userId}`,
    )
  ).rows[0];
  if (!r) throw new ApiError(404, "Lệnh nâng cấp không tồn tại.");
  if (r.provider === "PAYOS") return cancelVipPayment(id, userId);
  return database().transaction(async (tx) => {
    const row = (
      await tx.execute(
        sql`SELECT * FROM cinevjet.vip_purchase_requests WHERE id=${id} AND user_id=${userId} FOR UPDATE`,
      )
    ).rows[0];
    if (row.status === "REJECTED" && row.public_reason === "Người dùng đã hủy lệnh")
      return { cancelled: true };
    if (row.status !== "PENDING" || row.bill_id || row.bank_evidence_reference)
      throw new ApiError(
        409,
        "Lệnh đã được xử lý hoặc có bằng chứng thanh toán. Vui lòng liên hệ hỗ trợ để đối soát.",
      );
    await tx.execute(
      sql`UPDATE cinevjet.vip_purchase_requests SET status='REJECTED',public_reason='Người dùng đã hủy lệnh',updated_at=now() WHERE id=${id} AND user_id=${userId}`,
    );
    return { cancelled: true };
  });
}
export { vipBankRequest };
