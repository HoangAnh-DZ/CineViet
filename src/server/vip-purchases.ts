import { settleReferralCommission } from "./referral-policy";
import { commissionAmount } from "@/domain/referral-policy";
import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { ApiError } from "./http";
import { payosConfigured } from "./payos-client";
import { assertAdmin } from "./admin-core";
import { moneyConfig } from "./money-config";
import { moneyDto } from "./manual-money";
import { openVipCheckinCycleInTransaction } from "./rewards";
import { vipPurchaseInput, reviewInput, type VipBankRequest } from "@/domain/money";
import { assertVipPlanNotPurchased } from "./vip-eligibility";
type Executor = Pick<ReturnType<typeof database>, "execute">;
async function lockUser(tx: Executor, userId: string) {
  const user = (
    await tx.execute(
      sql`SELECT id FROM cinevjet.users WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`,
    )
  ).rows[0];
  if (!user) throw new ApiError(403, "Tài khoản không thể mua VIP.");
  const r = await tx.execute(
    sql`SELECT c.user_id FROM cinevjet.coin_wallets c JOIN cinevjet.users u ON u.id=c.user_id WHERE c.user_id=${userId} AND u.status='ACTIVE' FOR UPDATE OF c`,
  );
  if (!r.rows.length) throw new ApiError(403, "Tài khoản không thể mua VIP.");
}
export async function userVipPurchases(userId: string) {
  const r = await database().execute(
    sql`SELECT r.*,p.order_code,p.status AS payos_status,p.expires_at AS payment_expires_at FROM cinevjet.vip_purchase_requests r LEFT JOIN cinevjet.payos_orders p ON p.id=r.id WHERE r.user_id=${userId} ORDER BY r.created_at DESC,r.id LIMIT 50`,
  );
  return r.rows.map((r) => moneyDto(r, "VIP_PURCHASE"));
}
function bankRequest(row: Record<string, unknown>): VipBankRequest {
  const plan = row.plan_snapshot as Record<string, unknown>;
  return {
    ...moneyDto(row, "VIP_PURCHASE"),
    transfer_bank: {
      bank_name: String(row.bank_name),
      account_number: String(row.bank_account_number),
      account_name: String(row.bank_account_name),
    },
    plan: {
      name: String(row.plan_name),
      price: Number(row.amount),
      duration_days: Number(row.duration_days),
      mission_count: Number(plan.mission_count),
      mission_reward: Number(plan.mission_reward),
      total_videos: Number(plan.mission_count) * Number(row.duration_days),
    },
    vip_expires_at: row.vip_expires_at ? new Date(String(row.vip_expires_at)).toISOString() : null,
  };
}
export async function vipBankRequest(userId: string, query: { id?: string; planId?: string }) {
  const filter = query.id
    ? sql`r.id=${query.id}`
    : sql`r.plan_id=${query.planId} AND r.status='PENDING'`;
  const row = (
    await database()
      .execute(sql`SELECT r.*,s.expires_at AS vip_expires_at FROM cinevjet.vip_purchase_requests r
    LEFT JOIN cinevjet.vip_subscriptions s ON s.id=r.subscription_id
    WHERE r.user_id=${userId} AND r.provider='MANUAL_BANK' AND r.payment_reference IS NOT NULL AND ${filter}
    ORDER BY r.created_at DESC,r.id LIMIT 1`)
  ).rows[0];
  if (!row && query.id) throw new ApiError(404, "Yêu cầu chuyển khoản không tồn tại.");
  return row ? bankRequest(row) : null;
}
export async function createVipPurchase(userId: string, input: unknown) {
  const d = vipPurchaseInput.parse(input),
    bank = await moneyConfig({ requireStoredBank: true });
  if (!bank.deposit_enabled)
    throw new ApiError(503, "Nạp tiền đang tạm bảo trì; chưa thể gửi yêu cầu VIP.");
  return database()
    .transaction(async (tx) => {
      await lockUser(tx, userId);
      const old = (
        await tx.execute(
          sql`SELECT * FROM cinevjet.vip_purchase_requests WHERE idempotency_key=${d.idempotency_key}`,
        )
      ).rows[0];
      if (old) {
        if (
          old.user_id !== userId ||
          old.plan_id !== d.plan_id ||
          (old.bill_id || null) !== (d.bill_id || null) ||
          old.user_note !== d.note
        )
          throw new ApiError(409, "Mã yêu cầu đã được sử dụng.");
        if (old.provider !== "MANUAL_BANK")
          throw new ApiError(409, "Hãy kiểm tra giao dịch trước đây trong lịch sử mua VIP.");
        return bankRequest(old);
      }
      await assertVipPlanNotPurchased(tx, userId, d.plan_id);
      const prior = (
        await tx.execute(
          sql`SELECT * FROM cinevjet.vip_purchase_requests WHERE user_id=${userId} AND plan_id=${d.plan_id} AND status='PENDING' ORDER BY created_at DESC,id LIMIT 1`,
        )
      ).rows[0];
      if (prior) {
        if (prior.provider === "MANUAL_BANK" && prior.payment_reference) return bankRequest(prior);
        throw new ApiError(
          409,
          "Bạn có giao dịch trước đây đang chờ. Hãy kiểm tra lịch sử mua VIP trước khi tạo yêu cầu mới.",
        );
      }
      if (payosConfigured())
        throw new ApiError(
          409,
          "Thanh toán mới sử dụng QR ngân hàng. Vui lòng chọn gói VIP để tiếp tục.",
        );
      const p = (
        await tx.execute(
          sql`SELECT * FROM cinevjet.vip_plans WHERE id=${d.plan_id} AND active AND purchase_enabled AND price>0 AND (reward_enabled OR mission_count>0)`,
        )
      ).rows[0];
      if (!p) throw new ApiError(400, "Gói VIP không còn bán.");
      if (!Number.isSafeInteger(Number(p.price)) || Number(p.price) > bank.max_amount)
        throw new ApiError(400, "Giá gói nằm ngoài hạn mức chuyển khoản.");
      let billUrl: string | null = null;
      if (d.bill_id) {
        const bill = (
          await tx.execute(
            sql`SELECT url FROM cinevjet.deposit_bills WHERE id=${d.bill_id} AND user_id=${userId} FOR UPDATE`,
          )
        ).rows[0];
        if (!bill) throw new ApiError(400, "Bill không hợp lệ.");
        const used = await tx.execute(
          sql`SELECT id FROM cinevjet.deposits WHERE bill_id=${d.bill_id} UNION ALL SELECT id FROM cinevjet.vip_purchase_requests WHERE bill_id=${d.bill_id}`,
        );
        if (used.rows.length) throw new ApiError(409, "Bill này đã được gửi.");
        billUrl = String(bill.url);
      }
      const pending = (
        await tx.execute(
          sql`SELECT count(*)::int n FROM cinevjet.vip_purchase_requests WHERE user_id=${userId} AND status='PENDING'`,
        )
      ).rows[0];
      if (Number(pending.n) >= 5) throw new ApiError(429, "Bạn đã có 5 yêu cầu VIP đang chờ.");
      await tx.execute(sql`SELECT set_config('cinevjet.referral_v2','on',true)`);
      const r = await tx.execute(
        sql`INSERT INTO cinevjet.vip_purchase_requests(id,user_id,plan_id,plan_name,amount,duration_days,reward_tier,reward_schedule,benefits_json,bill_id,bill_url,bank_name,bank_account_number,bank_account_name,idempotency_key,user_note,payment_reference) VALUES(${randomUUID()},${userId},${p.id},${p.name},${p.price},${p.duration_days},${p.reward_tier},ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(p.checkin_rewards)}::jsonb)::integer),${JSON.stringify(p.benefits_json)}::jsonb,${d.bill_id || null},${billUrl},${bank.bank_name},${bank.account_number},${bank.account_name},${d.idempotency_key},${d.note},${"CVJ" + randomBytes(8).toString("hex").toUpperCase()}) RETURNING *`,
      );
      return bankRequest(r.rows[0]);
    })
    .catch((error) => {
      if (error?.code === "23505" || error?.cause?.code === "23505")
        throw new ApiError(
          409,
          "Mã yêu cầu đã được sử dụng. Hãy kiểm tra trạng thái trước khi thử lại.",
        );
      throw error;
    });
}
export async function approveVipPurchase(actor: string, id: string, input: unknown) {
  await assertAdmin(actor);
  const d = reviewInput.parse(input),
    reject = d.action === "REJECT";
  if (!reject && (d.action !== "APPROVE" || !d.confirmed))
    throw new ApiError(400, "Cần xác nhận đã nhận đủ tiền mua VIP.");
  if (reject && !d.reason) throw new ApiError(400, "Vui lòng nhập lý do từ chối.");
  return database()
    .transaction(async (tx) => {
      const r = (
        await tx.execute(
          sql`SELECT * FROM cinevjet.vip_purchase_requests WHERE id=${id} FOR UPDATE`,
        )
      ).rows[0];
      if (!r) throw new ApiError(404, "Yêu cầu không tồn tại.");
      if (r.status !== "PENDING") throw new ApiError(409, "Yêu cầu đã được xử lý.");
      if (r.provider === "PAYOS")
        throw new ApiError(409, "Đơn payOS được xác nhận tự động, không duyệt thủ công.");
      if (!reject && r.payment_reference && !d.evidence_reference)
        throw new ApiError(400, "Cần mã giao dịch ngân hàng đã đối soát tiền thực nhận.");
      if (!reject && d.evidence_reference) {
        const reference = d.evidence_reference.trim().toUpperCase();
        const used = (
          await tx.execute(
            sql`SELECT id FROM cinevjet.vip_purchase_requests WHERE bank_evidence_reference=${reference} AND id<>${id}`,
          )
        ).rows[0];
        if (used) throw new ApiError(409, "Mã giao dịch ngân hàng đã được dùng cho yêu cầu khác.");
        await tx.execute(
          sql`UPDATE cinevjet.vip_purchase_requests SET bank_evidence_reference=${reference} WHERE id=${id}`,
        );
      }
      const subscriptionId = reject ? null : await activateVipPurchaseInTransaction(tx, r);
      const result = await tx.execute(
        sql`UPDATE cinevjet.vip_purchase_requests SET status=${reject ? "REJECTED" : "COMPLETED"},subscription_id=${subscriptionId},admin_note=${d.note},public_reason=${reject ? d.reason : null},reviewed_by=${actor},completed_at=${reject ? null : sql`now()`},rejected_at=${reject ? sql`now()` : null},updated_at=now() WHERE id=${id} RETURNING *`,
      );
      if (!reject) {
        await vipCommissionInTransaction(tx, r);
      }
      const a = (await tx.execute(sql`SELECT email FROM cinevjet.users WHERE id=${actor}`)).rows[0];
      await tx.execute(
        sql`INSERT INTO cinevjet.money_audit(id,admin_id,admin_email,request_id,kind,action,note) VALUES(${randomUUID()},${actor},${a.email},${id},'VIP_PURCHASE',${reject ? "VIP_REJECTED" : "VIP_APPROVED"},${d.note})`,
      );
      return moneyDto(result.rows[0], "VIP_PURCHASE");
    })
    .catch((error) => {
      if (error?.code === "23505" || error?.cause?.code === "23505")
        throw new ApiError(409, "Giao dịch đã được xử lý hoặc mã đối soát đã được sử dụng.");
      throw error;
    });
}

export async function activateVipPurchaseInTransaction(tx: Executor, r: Record<string, unknown>) {
  await lockUser(tx, String(r.user_id));
  await assertVipPlanNotPurchased(tx, String(r.user_id), String(r.plan_id), String(r.id));
  const p = (
    await tx.execute(
      sql`SELECT active,reward_enabled,mission_count FROM cinevjet.vip_plans WHERE id=${r.plan_id}`,
    )
  ).rows[0];
  const contract = r.plan_snapshot as Record<string, unknown>;
  if (!p?.active || (!contract.reward_enabled && Number(contract.mission_count || 0) <= 0))
    throw new ApiError(409, "Gói đã dừng. Hãy từ chối và hoàn tiền theo quy trình ngân hàng.");
  const time = (
    await tx.execute(
      sql`SELECT cinevjet.reward_now() AS now, GREATEST(cinevjet.reward_now(),COALESCE(max(expires_at),cinevjet.reward_now()))+(${Number(r.duration_days)}*interval '1 day') AS expires FROM cinevjet.vip_subscriptions WHERE user_id=${r.user_id} AND status='ACTIVE'`,
    )
  ).rows[0];
  await tx.execute(
    sql`UPDATE cinevjet.vip_subscriptions SET status='CANCELLED' WHERE user_id=${r.user_id} AND status='ACTIVE'`,
  );
  const subscriptionId = randomUUID();
  const reference = "VIP_PURCHASE/" + String(r.id);
  await tx.execute(
    sql`INSERT INTO cinevjet.vip_subscriptions(id,user_id,plan_id,status,started_at,expires_at,activation_reference,activation_verified_at,plan_snapshot) VALUES(${subscriptionId},${r.user_id},${r.plan_id},'ACTIVE',${time.now}::timestamptz,${time.expires}::timestamptz,${reference},now(),${JSON.stringify(contract)}::jsonb)`,
  );
  if (contract.reward_enabled) {
    await openVipCheckinCycleInTransaction(tx, subscriptionId, reference, {
      tier: String(r.reward_tier),
      rewards: r.reward_schedule as number[],
      price: Number(r.amount),
    });
  }

  return subscriptionId;
}
export async function vipCommissionInTransaction(tx: Executor, r: Record<string, unknown>) {
  if (await settleReferralCommission(tx, String(r.id))) return;
  const referred = (
    await tx.execute(sql`SELECT referred_by FROM cinevjet.users WHERE id=${r.user_id}`)
  ).rows[0];
  const referrerId = referred?.referred_by ? String(referred.referred_by) : "";
  const legacyPolicy = (
    await tx.execute(
      sql`SELECT level1_bps FROM cinevjet.referral_policy_versions WHERE id='legacy-10-percent'`,
    )
  ).rows[0];
  if (!legacyPolicy) throw new ApiError(503, "Chưa tải được chính sách hoa hồng của đơn cũ.");
  const legacyBps = Number(legacyPolicy.level1_bps);
  const commission = commissionAmount(Number(r.amount), legacyBps);
  if (referrerId && referrerId !== String(r.user_id) && commission > 0) {
    const wallet = (
      await tx.execute(
        sql`SELECT user_id FROM cinevjet.wallets WHERE user_id=${referrerId} FOR UPDATE`,
      )
    ).rows[0];
    if (wallet) {
      const inserted = await tx.execute(
        sql`INSERT INTO cinevjet.referral_commissions(id,referrer_id,referred_user_id,source_id,percent,amount) VALUES(${randomUUID()},${referrerId},${r.user_id},${r.id},${legacyBps / 100},${commission}) ON CONFLICT(referred_user_id) DO NOTHING RETURNING id`,
      );
      if (inserted.rows.length) {
        await tx.execute(
          sql`UPDATE cinevjet.wallets SET balance=balance+${commission}::bigint WHERE user_id=${referrerId}`,
        );
        await tx.execute(
          sql`INSERT INTO cinevjet.wallet_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES(${randomUUID()},${referrerId},${commission},'REFERRAL_COMMISSION','REFERRAL',${String(inserted.rows[0].id)})`,
        );
      }
    }
  }
}
