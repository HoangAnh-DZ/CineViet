import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "./db";
import { ApiError } from "./http";
import { moneyConfig } from "./money-config";
import { activateVipPurchaseInTransaction, vipCommissionInTransaction } from "./vip-purchases";
import { paymentInput, type PayosOrder } from "@/domain/payos";
import { assertVipPlanNotPurchased } from "./vip-eligibility";
import { currentOriginConfig, resolveRequestOrigin } from "@/lib/domain-routing";
import {
  payosConfigured,
  paymentOrigin,
  getPaymentInfo,
  createPaymentLink,
  cancelPaymentLink,
  PayosApiError,
  verifySignature,
  type paymentInfoSchema,
} from "./payos-client";
type Info = z.infer<typeof paymentInfoSchema>;
type Executor = Pick<ReturnType<typeof database>, "execute">;
function dto(r: Record<string, unknown>): PayosOrder {
  return {
    id: String(r.id),
    kind: r.kind as PayosOrder["kind"],
    order_code: Number(r.order_code),
    amount: Number(r.amount),
    status: String(r.status),
    checkout_url: r.checkout_url as string | null,
    qr_code: r.qr_code as string | null,
    expires_at: new Date(r.expires_at as string).toISOString(),
    payment_link_id: r.payment_link_id as string | null,
    account_number: r.account_number as string | null,
    account_name: r.account_name as string | null,
    bank_code: r.bank_code as string | null,
    plan_id: r.plan_id as string | null,
  };
}
function sameOrder(r: Record<string, unknown>, info: Info) {
  const link = info.paymentLinkId || info.id;
  if (
    !link ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(link) ||
    info.orderCode !== Number(r.order_code) ||
    info.amount !== Number(r.amount) ||
    (r.payment_link_id && link !== r.payment_link_id)
  )
    throw new ApiError(409, "Thông tin thanh toán không khớp.");
  if (
    info.status === "PAID" &&
    (info.amountPaid !== Number(r.amount) || info.amountRemaining !== 0)
  )
    throw new ApiError(409, "Số tiền thực nhận chưa khớp.");
  return link;
}
async function event(
  tx: Executor,
  id: string,
  source: string,
  key: string,
  status: string,
  reference?: string,
) {
  await tx.execute(
    sql`INSERT INTO cinevjet.payment_events(id,order_id,source,event_key,state,provider_reference) VALUES(${randomUUID()},${id},${source},${key},${status},${reference || null}) ON CONFLICT(event_key) DO NOTHING`,
  );
}
export async function createPayosOrder(
  userId: string,
  input: unknown,
  initiatingOrigin = paymentOrigin(),
) {
  if (
    resolveRequestOrigin(
      { url: initiatingOrigin, headers: new Headers() },
      currentOriginConfig(),
    ) !== initiatingOrigin
  )
    throw new ApiError(403, "Tên miền thanh toán chưa được cấu hình.");
  if (!payosConfigured())
    throw new ApiError(503, "Chuyển khoản ngân hàng chưa sẵn sàng. Vui lòng thử lại sau.");
  const d = paymentInput.parse(input),
    config = await moneyConfig();
  if (!config.deposit_enabled) throw new ApiError(503, "Nạp tiền đang tạm bảo trì.");
  const row = await database().transaction(async (tx) => {
    const user = (
      await tx.execute(
        sql`SELECT id FROM cinevjet.users WHERE id=${userId} AND status='ACTIVE' FOR UPDATE`,
      )
    ).rows[0];
    if (!user) throw new ApiError(403, "Tài khoản không thể giao dịch.");
    const old = (
      await tx.execute(
        sql`SELECT * FROM cinevjet.payos_orders WHERE idempotency_key=${d.idempotency_key}`,
      )
    ).rows[0];
    if (old) {
      if (
        old.user_id !== userId ||
        old.kind !== d.kind ||
        (d.kind === "DEPOSIT" ? Number(old.amount) !== d.amount : old.plan_id !== d.plan_id)
      )
        throw new ApiError(409, "Mã yêu cầu đã được sử dụng.");
      if (
        d.kind === "VIP_PURCHASE" &&
        ["CREATING", "PENDING", "UNDERPAID", "PROCESSING"].includes(String(old.status))
      )
        await assertVipPlanNotPurchased(tx, userId, d.plan_id);
      return old;
    }
    if (d.kind === "VIP_PURCHASE") {
      await assertVipPlanNotPurchased(tx, userId, d.plan_id);
      // The user row is locked: reopening/reloading or another tab reuses the
      // previously confirmed order even if its client idempotency key was lost.
      const pendingVip = (
        await tx.execute(
          sql`SELECT * FROM cinevjet.payos_orders WHERE user_id=${userId} AND kind='VIP_PURCHASE' AND plan_id=${d.plan_id} AND status IN ('CREATING','PENDING','UNDERPAID','PROCESSING') ORDER BY created_at DESC LIMIT 1`,
        )
      ).rows[0];
      if (pendingVip) return pendingVip;
    }
    if (d.kind === "VIP_PURCHASE") {
      const manual = (
        await tx.execute(
          sql`SELECT id FROM cinevjet.vip_purchase_requests WHERE user_id=${userId} AND plan_id=${d.plan_id} AND provider='MANUAL_BANK' AND status='PENDING' LIMIT 1`,
        )
      ).rows[0];
      if (manual)
        throw new ApiError(
          409,
          "Bạn còn yêu cầu chuyển khoản trước đây. Hãy kiểm tra lịch sử hoặc liên hệ hỗ trợ trước khi tạo thanh toán mới.",
        );
    }
    const pending = (
      await tx.execute(
        sql`SELECT count(*)::int n FROM cinevjet.payos_orders WHERE user_id=${userId} AND status IN ('CREATING','PENDING','UNDERPAID','PROCESSING') AND expires_at>now()`,
      )
    ).rows[0];
    if (Number(pending.n) >= 5) throw new ApiError(429, "Bạn đã có 5 đơn thanh toán đang chờ.");
    const id = randomUUID();
    let amount: number, plan: Record<string, unknown> | undefined;
    if (d.kind === "VIP_PURCHASE") {
      plan = (
        await tx.execute(
          sql`SELECT * FROM cinevjet.vip_plans WHERE id=${d.plan_id} AND active AND purchase_enabled AND price>0 AND (reward_enabled OR mission_count>0)`,
        )
      ).rows[0];
      if (!plan) throw new ApiError(400, "Gói VIP không còn bán.");
      amount = Number(plan.price);
    } else amount = d.amount;
    if (
      !Number.isSafeInteger(amount) ||
      amount > Math.min(config.max_amount, 100000000) ||
      (d.kind === "DEPOSIT" && amount < Math.max(config.min_deposit, 50000))
    )
      throw new ApiError(400, "Số tiền ngoài hạn mức.");
    if (plan) {
      await tx.execute(
        sql`INSERT INTO cinevjet.vip_purchase_requests(id,user_id,plan_id,plan_name,amount,duration_days,reward_tier,reward_schedule,benefits_json,bank_name,bank_account_number,bank_account_name,idempotency_key,user_note,provider) VALUES(${id},${userId},${plan.id},${plan.name},${amount},${plan.duration_days},${plan.reward_tier},ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(plan.checkin_rewards)}::jsonb)::integer),${JSON.stringify(plan.benefits_json)}::jsonb,'payOS','','',${d.idempotency_key},'','PAYOS')`,
      );
    } else
      await tx.execute(
        sql`INSERT INTO cinevjet.deposits(id,user_id,amount,provider,idempotency_key,updated_at) VALUES(${id},${userId},${amount},'PAYOS',${d.idempotency_key},now())`,
      );
    const url = `${initiatingOrigin}/payments/payos/${id}`;
    return (
      await tx.execute(
        sql`INSERT INTO cinevjet.payos_orders(id,user_id,kind,deposit_id,vip_purchase_id,amount,plan_id,idempotency_key,return_url,cancel_url,expires_at) VALUES(${id},${userId},${d.kind},${plan ? null : id},${plan ? id : null},${amount},${plan?.id || null},${d.idempotency_key},${url},${url},now()+interval '30 minutes') RETURNING *`,
      )
    ).rows[0];
  });
  return ensurePaymentLink(String(row.id), userId);
}
export async function pendingVipPayment(userId: string, planId: string) {
  const r = (
    await database().execute(
      sql`SELECT * FROM cinevjet.payos_orders WHERE user_id=${userId} AND kind='VIP_PURCHASE' AND plan_id=${planId} AND status IN ('CREATING','PENDING','UNDERPAID','PROCESSING') ORDER BY created_at DESC LIMIT 1`,
    )
  ).rows[0];
  return r
    ? new Date(String(r.expires_at)).getTime() <= Date.now()
      ? await cancelVipPayment(String(r.id), userId, true)
      : dto(r)
    : null;
}
export async function cancelVipPayment(
  id: string,
  userId: string,
  expired = false,
): Promise<PayosOrder> {
  // Serialize against CREATE. A cancellation must never create a missing link.
  const result = await database().transaction(async (tx) => {
    const r = (
      await tx.execute(
        sql`SELECT * FROM cinevjet.payos_orders WHERE id=${id} AND user_id=${userId} AND kind='VIP_PURCHASE' FOR UPDATE`,
      )
    ).rows[0];
    if (!r) throw new ApiError(404, "Lệnh nâng cấp không tồn tại.");
    if (r.settled_at || ["CANCELLED", "EXPIRED", "FAILED"].includes(String(r.status)))
      return { stored: dto(r) };
    if (expired && new Date(String(r.expires_at)).getTime() > Date.now()) return { stored: dto(r) };
    let info: Info;
    try {
      info = await getPaymentInfo(Number(r.order_code));
    } catch (e) {
      if (!(e instanceof PayosApiError) || !e.paymentNotFound || r.payment_link_id) throw e;
      await tx.execute(
        sql`UPDATE cinevjet.vip_purchase_requests SET status='REJECTED',public_reason=${expired ? "Thanh toán hết hạn" : "Thanh toán đã hủy"},updated_at=now() WHERE id=${id} AND provider='PAYOS' AND status='PENDING'`,
      );
      const updated = (
        await tx.execute(
          sql`UPDATE cinevjet.payos_orders SET status=${expired ? "EXPIRED" : "CANCELLED"},checked_at=now(),updated_at=now() WHERE id=${id} RETURNING *`,
        )
      ).rows[0];
      await event(
        tx,
        id,
        "RECONCILIATION",
        `CANCEL_UNCREATED/${id}`,
        expired ? "EXPIRED" : "CANCELLED",
      );
      return { stored: dto(updated) };
    }
    const link = sameOrder(r, info);
    if (info.status === "PAID" || ["CANCELLED", "EXPIRED", "FAILED"].includes(info.status))
      return { info };
    if (
      info.status !== "PENDING" ||
      info.amountPaid !== 0 ||
      info.amountRemaining !== Number(r.amount)
    )
      throw new ApiError(
        409,
        "Lệnh đang xử lý hoặc đã nhận một phần tiền. Chưa thể hủy; hãy kiểm tra trạng thái hoặc liên hệ hỗ trợ.",
      );
    try {
      info = await cancelPaymentLink(Number(r.order_code));
    } catch (error) {
      // The provider might have accepted cancellation before the connection
      // failed. Recover the same order; never assume it was cancelled.
      try {
        info = await getPaymentInfo(Number(r.order_code));
      } catch {
        throw error;
      }
    }
    sameOrder({ ...r, payment_link_id: link }, info);
    if (!["PAID", "CANCELLED", "EXPIRED", "FAILED"].includes(info.status))
      throw new ApiError(
        409,
        "Chưa xác nhận được việc hủy lệnh. Hãy kiểm tra lại cùng lệnh trước khi thanh toán.",
      );
    return { info };
  });
  if (result.stored) return result.stored;
  const info = result.info!;
  // EXPIRED is the app presentation of a provider-confirmed cancellation at
  // its original deadline, never a client-supplied status.
  const state =
    expired && info.status === "CANCELLED" ? { ...info, status: "EXPIRED" as const } : info;
  return settleVerifiedInfo(id, state, "RECONCILIATION", `VIP_CANCEL/${id}/${state.status}`);
}
export async function paymentPresentation(order: PayosOrder, userId: string): Promise<PayosOrder> {
  if (order.kind !== "VIP_PURCHASE") return order;
  const detail = (
    await database().execute(
      sql`SELECT r.plan_name,r.duration_days,s.expires_at FROM cinevjet.vip_purchase_requests r LEFT JOIN cinevjet.vip_subscriptions s ON s.id=r.subscription_id AND s.user_id=r.user_id WHERE r.id=${order.id} AND r.user_id=${userId} AND r.provider='PAYOS'`,
    )
  ).rows[0];
  return {
    ...order,
    plan_name: detail ? String(detail.plan_name) : null,
    duration_days: detail ? Number(detail.duration_days) : null,
    vip_expires_at:
      order.status === "PAID" && detail?.expires_at
        ? new Date(detail.expires_at as string).toISOString()
        : null,
  };
}
// Durable order is committed before network I/O. Row lock serializes duplicate creates;
// an ambiguous response is recovered using the SAME order code, never a new payment.
async function ensurePaymentLink(id: string, userId: string): Promise<PayosOrder> {
  const verifiedPending = await database().transaction(async (tx) => {
    const r = (
      await tx.execute(
        sql`SELECT * FROM cinevjet.payos_orders WHERE id=${id} AND user_id=${userId} FOR UPDATE`,
      )
    ).rows[0];
    if (!r) throw new ApiError(404, "Đơn thanh toán không tồn tại.");
    if (r.payment_link_id || r.status !== "CREATING") return;
    let info: Info;
    try {
      info = await getPaymentInfo(Number(r.order_code));
    } catch (e) {
      // Production returns 101 + "Mã thanh toán không tồn tại" for this GET.
      // Only confirmed absence permits POST; unknown/auth/network errors never do.
      if (!(e instanceof PayosApiError) || !e.paymentNotFound) throw e;
      if (new Date(r.expires_at as string).getTime() <= Date.now()) {
        const legacyTable =
          r.kind === "DEPOSIT" ? sql`cinevjet.deposits` : sql`cinevjet.vip_purchase_requests`;
        await tx.execute(
          sql`UPDATE ${legacyTable} SET status=${r.kind === "DEPOSIT" ? "FAILED" : "REJECTED"},public_reason='Thanh toán hết hạn',updated_at=now() WHERE id=${id} AND provider='PAYOS' AND status='PENDING'`,
        );
        await tx.execute(
          sql`UPDATE cinevjet.payos_orders SET status='EXPIRED',checked_at=now(),updated_at=now() WHERE id=${id}`,
        );
        await event(tx, id, "RECONCILIATION", `EXPIRED_UNCREATED/${id}`, "EXPIRED");
        return;
      }
      try {
        info = await createPaymentLink({
          orderCode: Number(r.order_code),
          amount: Number(r.amount),
          description: "CVJ" + String(r.order_code).slice(-6),
          returnUrl: String(r.return_url),
          cancelUrl: String(r.cancel_url),
          expiredAt: Math.floor(new Date(r.expires_at as string).getTime() / 1000),
        });
      } catch (createError) {
        // A duplicate/order-creation race or network timeout may have been accepted.
        try {
          info = await getPaymentInfo(Number(r.order_code));
        } catch {
          throw createError;
        }
      }
    }
    // Creation responses use amount/status; PAID recovery is settled separately via GET.
    const link = sameOrder(r, info),
      checkout = info.checkoutUrl || `https://pay.payos.vn/web/${link}`;
    const checkoutUrl = new URL(checkout);
    if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "pay.payos.vn")
      throw new ApiError(503, "Link thanh toán không hợp lệ.");
    const stored = (
      await tx.execute(
        sql`UPDATE cinevjet.payos_orders SET payment_link_id=${link},checkout_url=${checkout},qr_code=${info.qrCode || null},account_number=${info.accountNumber || null},account_name=${info.accountName || null},bank_code=${info.bin || null},status='PENDING',checked_at=now(),updated_at=now() WHERE id=${id} RETURNING *`,
      )
    ).rows[0];
    await event(tx, id, "CREATE", `CREATE/${id}`, "PENDING");
    // Signed CREATE already proves a pending link. An immediate GET can lag behind
    // and return 101; it must not turn a successful creation into a frontend error.
    // Paid/other recovery still goes through independent GET settlement below.
    if (info.status === "PENDING") return dto(stored);
  });
  if (verifiedPending) return verifiedPending;
  return reconcilePayosOrder(id, userId, true);
}
export async function reconcilePayosOrder(
  id: string,
  userId?: string,
  force = false,
): Promise<PayosOrder> {
  const r = (
    await database().execute(
      sql`SELECT * FROM cinevjet.payos_orders WHERE id=${id} ${userId ? sql`AND user_id=${userId}` : sql``}`,
    )
  ).rows[0];
  if (!r) throw new ApiError(404, "Đơn thanh toán không tồn tại.");
  if (r.settled_at) return dto(r);
  if (
    r.kind === "VIP_PURCHASE" &&
    ["CREATING", "PENDING", "UNDERPAID", "PROCESSING"].includes(String(r.status)) &&
    new Date(String(r.expires_at)).getTime() <= Date.now()
  )
    return cancelVipPayment(id, String(r.user_id), true);
  if (!r.payment_link_id) {
    if (userId && r.status === "CREATING") return ensurePaymentLink(id, userId);
    return dto(r);
  }
  if (!force && r.checked_at && Date.now() - new Date(r.checked_at as string).getTime() < 10000)
    return dto(r);
  const info = await getPaymentInfo(Number(r.order_code));
  return settleVerifiedInfo(id, info, "RECONCILIATION", `STATE/${id}/${info.status}`);
}
async function settleVerifiedInfo(
  id: string,
  info: Info,
  source: "WEBHOOK" | "RECONCILIATION",
  key: string,
  reference?: string,
) {
  return database().transaction(async (tx) => {
    const r = (await tx.execute(sql`SELECT * FROM cinevjet.payos_orders WHERE id=${id} FOR UPDATE`))
      .rows[0];
    if (!r) throw new ApiError(404, "Đơn thanh toán không tồn tại.");
    sameOrder(r, info);
    if (r.settled_at) return dto(r);
    // A stale polling result cannot reopen a cancelled/expired link. A verified
    // late payment still settles through the normal financial transaction.
    if (["CANCELLED", "EXPIRED", "FAILED"].includes(String(r.status)) && info.status !== "PAID")
      return dto(r);
    const table =
      r.kind === "DEPOSIT" ? sql`cinevjet.deposits` : sql`cinevjet.vip_purchase_requests`;
    const legacy = (await tx.execute(sql`SELECT * FROM ${table} WHERE id=${id} FOR UPDATE`))
      .rows[0];
    if (
      !legacy ||
      legacy.provider !== "PAYOS" ||
      legacy.user_id !== r.user_id ||
      Number(legacy.amount) !== Number(r.amount) ||
      legacy.status === "COMPLETED"
    )
      throw new ApiError(409, "Đơn không thể quyết toán.");
    if (info.status === "PAID") {
      if (r.kind === "DEPOSIT") {
        const wallet = (
          await tx.execute(
            sql`UPDATE cinevjet.wallets SET balance=balance+${Number(r.amount)}::bigint WHERE user_id=${r.user_id} AND balance<=9007199254740991-${Number(r.amount)}::bigint RETURNING user_id`,
          )
        ).rows[0];
        if (!wallet) throw new ApiError(409, "Số dư vượt giới hạn.");
        await tx.execute(
          sql`INSERT INTO cinevjet.wallet_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES(${randomUUID()},${r.user_id},${Number(r.amount)},'DEPOSIT','DEPOSIT',${id})`,
        );
        await tx.execute(
          sql`UPDATE cinevjet.deposits SET status='COMPLETED',completed_at=now(),updated_at=now(),bank_name='payOS',bank_account_number=${r.account_number || null},bank_account_name=${r.account_name || null},public_reason=NULL WHERE id=${id}`,
        );
      } else {
        const sub = await activateVipPurchaseInTransaction(tx, legacy);
        await tx.execute(
          sql`UPDATE cinevjet.vip_purchase_requests SET status='COMPLETED',subscription_id=${sub},completed_at=now(),updated_at=now(),public_reason=NULL WHERE id=${id}`,
        );
        await vipCommissionInTransaction(tx, legacy);
      }
    } else if (["CANCELLED", "EXPIRED", "FAILED"].includes(info.status)) {
      await tx.execute(
        sql`UPDATE ${table} SET status=${r.kind === "DEPOSIT" ? "FAILED" : "REJECTED"},public_reason=${info.status === "EXPIRED" ? "Thanh toán hết hạn" : info.status === "CANCELLED" ? "Thanh toán đã hủy" : "Thanh toán thất bại"},updated_at=now() WHERE id=${id}`,
      );
    }
    const providerReference =
      reference ||
      (Array.isArray(info.transactions)
        ? z.object({ reference: z.string().min(1).max(120) }).safeParse(info.transactions.at(-1))
            .data?.reference
        : undefined);
    await event(tx, id, source, key, info.status, providerReference);
    const updated = (
      await tx.execute(
        sql`UPDATE cinevjet.payos_orders SET status=${info.status},checked_at=now(),updated_at=now(),settled_at=${info.status === "PAID" ? sql`now()` : sql`NULL`} WHERE id=${id} RETURNING *`,
      )
    ).rows[0];
    return dto(updated);
  });
}
const webhookSchema = z.object({
  code: z.string(),
  success: z.boolean(),
  signature: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export async function receivePayosWebhook(input: unknown) {
  const w = webhookSchema.parse(input);
  verifySignature(w.data, w.signature);
  const d = z
    .object({
      orderCode: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      amount: z.number().int().positive(),
      currency: z.literal("VND"),
      paymentLinkId: z.string().min(1),
      code: z.string(),
      reference: z.string().min(1),
      description: z.string(),
      accountNumber: z.string(),
    })
    .parse(w.data);
  if (w.code !== "00" || !w.success || d.code !== "00")
    throw new ApiError(400, "Webhook chưa xác nhận thanh toán.");
  // Documented confirm-webhook sample; sequence never issues order 123.
  if (
    d.orderCode === 123 &&
    d.amount === 3000 &&
    d.description === "VQRIO123" &&
    d.reference === "TF230204212323" &&
    d.accountNumber === "12345678" &&
    d.paymentLinkId === "124c33293c43417ab7879e14c8d9eb18"
  )
    return { received: true, sample: true };
  const r = (
    await database().execute(
      sql`SELECT * FROM cinevjet.payos_orders WHERE order_code=${d.orderCode}`,
    )
  ).rows[0];
  if (!r) throw new ApiError(404, "Không tìm thấy đơn thanh toán.");
  if (
    d.amount !== Number(r.amount) ||
    (r.payment_link_id && d.paymentLinkId !== r.payment_link_id) ||
    (r.account_number && d.accountNumber !== r.account_number)
  )
    throw new ApiError(409, "Webhook không khớp đơn thanh toán.");
  // Independent authenticated, signed provider lookup also handles partial payments.
  const info = await getPaymentInfo(d.orderCode);
  if ((info.paymentLinkId || info.id) !== d.paymentLinkId || info.status !== "PAID")
    throw new ApiError(409, "payOS chưa xác nhận đủ tiền.");
  if (!r.payment_link_id) {
    // Create response may be lost; recover its verified identity before settlement.
    await database().execute(
      sql`UPDATE cinevjet.payos_orders SET payment_link_id=${d.paymentLinkId},checkout_url=${`https://pay.payos.vn/web/${d.paymentLinkId}`} WHERE id=${r.id} AND payment_link_id IS NULL`,
    );
  }
  await settleVerifiedInfo(String(r.id), info, "WEBHOOK", `WEBHOOK/${d.reference}`, d.reference);
  return { received: true };
}
export async function reconcilePendingPayments(limit = 10) {
  const rows = (
    await database().execute(
      sql`SELECT id,user_id FROM cinevjet.payos_orders WHERE settled_at IS NULL AND status IN ('CREATING','PENDING','UNDERPAID','PROCESSING') ORDER BY checked_at NULLS FIRST,created_at LIMIT ${limit}`,
    )
  ).rows;
  let reconciled = 0,
    failed = 0;
  for (const r of rows) {
    try {
      await reconcilePayosOrder(String(r.id), String(r.user_id), true);
      reconciled++;
    } catch {
      failed++;
      await database().execute(
        sql`UPDATE cinevjet.payos_orders SET checked_at=now() WHERE id=${r.id} AND settled_at IS NULL`,
      );
    }
  }
  return { reconciled, failed };
}
