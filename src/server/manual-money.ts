import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { ApiError } from "./http";
import { payosConfigured } from "./payos-client";
import { assertAdmin } from "./admin-core";
import { moneyConfig } from "./money-config";
import {
  depositInput,
  withdrawalInput,
  reviewInput,
  type MoneyKind,
  type MoneyRequest,
} from "@/domain/money";
import { withdrawalQuote } from "@/domain/rules";
import { withdrawalFee } from "@/domain/product-policy";
import { enqueueWithdrawal, payoutAudit } from "./withdrawal-queue";
import { banks } from "./banks";
import { openBankDetails } from "./bank-secrets";
type Executor = Pick<ReturnType<typeof database>, "execute">;
const date = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
export function moneyDto(r: Record<string, unknown>, kind: MoneyKind): MoneyRequest {
  return {
    id: String(r.id),
    kind,
    amount: Number(r.amount),
    fee: Number(r.fee || 0),
    status: String(r.status),
    created_at: date(r.created_at)!,
    completed_at: date(r.completed_at),
    rejected_at: date(r.rejected_at),
    bank_name: r.bank_name as string | null,
    bank_account_number: r.bank_account_number
      ? "••••" + String(r.bank_account_number).slice(-4)
      : null,
    bank_account_name: null,
    bill_url: kind !== "WITHDRAWAL" ? (r.bill_url as string | null) : null,
    user_note: r.user_note as string | null,
    review_note: r.public_reason as string | null,
    source_asset: r.source_asset === "COIN" ? "COIN" : "VND",
    coins_amount: r.coins_amount ? Number(r.coins_amount) : null,
    coin_value_vnd: r.coin_value_vnd ? Number(r.coin_value_vnd) : null,
    plan_name: r.plan_name ? String(r.plan_name) : null,
    plan_id: r.plan_id ? String(r.plan_id) : null,
    payment_expires_at: date(r.payment_expires_at),
    payment_reference: r.payment_reference ? String(r.payment_reference) : null,
    provider: r.provider ? String(r.provider) : undefined,
    order_code: r.order_code ? Number(r.order_code) : null,
    payos_status: r.payos_status ? String(r.payos_status) : null,
    queue_status: r.queue_status ? String(r.queue_status) : null,
    queue_attempts: Number(r.queue_attempts || 0),
    payout_reference: r.payout_reference ? String(r.payout_reference) : null,
    queue_error: r.queue_error ? String(r.queue_error) : null,
  };
}
const dto = moneyDto;
async function lockWallet(tx: Executor, userId: string) {
  const r = await tx.execute(
    sql`SELECT w.balance,w.reserved FROM cinevjet.wallets w JOIN cinevjet.users u ON u.id=w.user_id WHERE w.user_id=${userId} AND u.status='ACTIVE' FOR UPDATE OF w`,
  );
  if (!r.rows.length) throw new ApiError(403, "Tài khoản không thể giao dịch.");
  return { balance: Number(r.rows[0].balance), reserved: Number(r.rows[0].reserved) };
}
export async function createDepositRequest(userId: string, input: unknown) {
  const d = depositInput.parse(input),
    bank = await moneyConfig();
  if (!bank.deposit_enabled) throw new ApiError(503, "Nạp tiền đang tạm bảo trì.");
  return database().transaction(async (tx) => {
    await lockWallet(tx, userId);
    const old = await tx.execute(
      sql`SELECT * FROM cinevjet.deposits WHERE idempotency_key=${d.idempotency_key}`,
    );
    if (old.rows.length) {
      const r = old.rows[0];
      if (
        r.user_id !== userId ||
        Number(r.amount) !== d.amount ||
        r.bill_id !== d.bill_id ||
        r.user_note !== d.note
      )
        throw new ApiError(409, "Mã yêu cầu đã được sử dụng.");
      return dto(r, "DEPOSIT");
    }
    if (payosConfigured())
      throw new ApiError(409, "Vui lòng tạo thanh toán chuyển khoản ngân hàng tại trang Nạp tiền.");
    const bill = await tx.execute(
      sql`SELECT * FROM cinevjet.deposit_bills WHERE id=${d.bill_id} AND user_id=${userId} FOR UPDATE`,
    );
    if (!bill.rows.length) throw new ApiError(400, "Vui lòng tải bill hợp lệ của bạn.");
    const used = await tx.execute(
      sql`SELECT id FROM cinevjet.deposits WHERE bill_id=${d.bill_id} UNION ALL SELECT id FROM cinevjet.vip_purchase_requests WHERE bill_id=${d.bill_id}`,
    );
    if (used.rows.length)
      throw new ApiError(409, "Bill này đã được gửi. Vui lòng xem lịch sử yêu cầu.");
    const pending = await tx.execute(
      sql`SELECT count(*)::int n FROM cinevjet.deposits WHERE user_id=${userId} AND status='PENDING'`,
    );
    if (Number(pending.rows[0].n) >= 5)
      throw new ApiError(429, "Bạn đã có 5 yêu cầu nạp đang chờ duyệt.");
    const r = await tx.execute(
      sql`INSERT INTO cinevjet.deposits(id,user_id,amount,provider,idempotency_key,bill_id,bill_url,bank_name,bank_account_number,bank_account_name,user_note,updated_at) VALUES(${randomUUID()},${userId},${d.amount},'MANUAL_BANK',${d.idempotency_key},${d.bill_id},${bill.rows[0].url},${bank.bank_name},${bank.account_number},${bank.account_name},${d.note},now()) RETURNING *`,
    );
    return dto(r.rows[0], "DEPOSIT");
  });
}
export async function createWithdrawalRequest(userId: string, input: unknown) {
  const d = withdrawalInput.parse(input),
    config = await moneyConfig();
  if (!config.withdrawal_enabled) throw new ApiError(503, "Rút tiền đang tạm bảo trì.");
  if (d.bank_code && !(await banks()).some((b) => b.code === d.bank_code && b.name === d.bank_name))
    throw new ApiError(400, "Ngân hàng nhận tiền chưa hợp lệ.");
  return database().transaction(async (tx) => {
    const wallet = await lockWallet(tx, userId);
    const old = await tx.execute(
      sql`SELECT * FROM cinevjet.withdrawals WHERE idempotency_key=${d.idempotency_key}`,
    );
    if (old.rows.length) {
      const r = old.rows[0];
      if (
        r.user_id !== userId ||
        Number(r.amount) !== d.amount ||
        r.bank_name !== d.bank_name ||
        r.source_asset !== "VND" ||
        r.bank_account_number !== d.account_number ||
        r.bank_account_name !== d.account_name ||
        r.user_note !== d.note
      )
        throw new ApiError(409, "Mã yêu cầu đã được sử dụng.");
      return dto(r, "WITHDRAWAL");
    }
    if (
      d.amount < Math.max(35000, config.min_withdrawal) ||
      d.amount > Math.min(config.max_amount, 100000000)
    )
      throw new ApiError(400, "Số tiền ngoài hạn mức rút.");
    let quote;
    try {
      quote = withdrawalQuote(
        d.amount,
        wallet.balance - wallet.reserved,
        withdrawalFee(d.amount, config.withdrawal_fee_bps),
      );
    } catch {
      throw new ApiError(400, "Số tiền vượt số dư VND khả dụng hoặc dưới hạn mức rút.");
    }
    const pending = await tx.execute(
      sql`SELECT count(*)::int n FROM cinevjet.withdrawals WHERE user_id=${userId} AND status='PENDING'`,
    );
    if (Number(pending.rows[0].n) >= 5)
      throw new ApiError(429, "Bạn đã có 5 yêu cầu rút đang chờ duyệt.");
    await tx.execute(
      sql`UPDATE cinevjet.wallets SET reserved=reserved+${quote.amount} WHERE user_id=${userId}`,
    );
    const r = await tx.execute(
      sql`INSERT INTO cinevjet.withdrawals(id,user_id,amount,fee,destination,idempotency_key,bank_name,bank_account_number,bank_account_name,user_note,updated_at) VALUES(${randomUUID()},${userId},${quote.amount},${quote.fee},${d.bank_name + " / " + d.account_number + " / " + d.account_name},${d.idempotency_key},${d.bank_name},${d.account_number},${d.account_name},${d.note},now()) RETURNING *`,
    );
    const queueState = await enqueueWithdrawal(tx, r.rows[0], d.bank_code);
    return dto({ ...r.rows[0], queue_status: queueState }, "WITHDRAWAL");
  });
}
export async function userMoneyRequests(userId: string, asset?: "VND" | "COIN") {
  const [deposits, withdrawals] = await Promise.all([
    asset === "COIN"
      ? Promise.resolve({ rows: [] })
      : database().execute(
          sql`SELECT d.*,p.order_code,p.status AS payos_status FROM cinevjet.deposits d LEFT JOIN cinevjet.payos_orders p ON p.id=d.id WHERE d.user_id=${userId} ORDER BY d.created_at DESC,d.id LIMIT 50`,
        ),
    database().execute(
      sql`SELECT w.*,j.status AS queue_status,j.attempts AS queue_attempts,j.provider_id AS payout_reference,j.last_error_code AS queue_error FROM cinevjet.withdrawals w LEFT JOIN cinevjet.withdrawal_jobs j ON j.withdrawal_id=w.id WHERE w.user_id=${userId} AND (${asset || ""}='' OR w.source_asset=${asset || ""}) ORDER BY w.created_at DESC,w.id LIMIT 50`,
    ),
  ]);
  return [
    ...deposits.rows.map((r) => dto(r, "DEPOSIT")),
    ...withdrawals.rows.map((r) => dto(r, "WITHDRAWAL")),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function adminMoneyDetail(actor: string, kind: MoneyKind, id: string) {
  await assertAdmin(actor);
  const table =
    kind === "DEPOSIT"
      ? sql`cinevjet.deposits`
      : kind === "VIP_PURCHASE"
        ? sql`cinevjet.vip_purchase_requests`
        : sql`cinevjet.withdrawals`;
  const r = await database().execute(
    sql`SELECT r.*,u.display_name,u.email,p.order_code,p.status AS payos_status,j.status AS queue_status,j.attempts AS queue_attempts,j.provider_id AS payout_reference,j.last_error_code AS queue_error,j.evidence_reference,j.evidence_url FROM ${table} r JOIN cinevjet.users u ON u.id=r.user_id LEFT JOIN cinevjet.payos_orders p ON p.id=r.id LEFT JOIN cinevjet.withdrawal_jobs j ON j.withdrawal_id=r.id WHERE r.id=${id}`,
  );
  if (!r.rows.length) throw new ApiError(404, "Yêu cầu không tồn tại.");
  const audit = await database().execute(
    sql`SELECT action,admin_email,note,created_at FROM cinevjet.money_audit WHERE request_id=${id} AND kind=${kind}`,
  );
  const a = audit.rows[0];
  const events = await database().execute(
    sql`SELECT action,note,created_at FROM cinevjet.payout_audit WHERE withdrawal_id=${id} ORDER BY created_at DESC LIMIT 30`,
  );
  const payments = await database().execute(
    sql`SELECT state AS action,source AS note,created_at FROM cinevjet.payment_events WHERE order_id=${id} ORDER BY created_at DESC LIMIT 30`,
  );
  const bankSnapshot =
    kind === "WITHDRAWAL" && r.rows[0].bank_snapshot_ciphertext
      ? await openBankDetails(
          String(r.rows[0].bank_snapshot_ciphertext),
          `withdrawal:${r.rows[0].user_id}:${id}`,
        )
      : null;
  return {
    ...dto(r.rows[0], kind),
    bank_evidence_reference: r.rows[0].bank_evidence_reference
      ? String(r.rows[0].bank_evidence_reference)
      : null,
    transfer_evidence:
      kind === "WITHDRAWAL" && r.rows[0].evidence_reference && r.rows[0].evidence_url
        ? {
            evidence_reference: String(r.rows[0].evidence_reference),
            evidence_url: String(r.rows[0].evidence_url),
          }
        : null,
    bank_account_number:
      bankSnapshot?.account_number ?? (r.rows[0].bank_account_number as string | null),
    bank_account_name:
      bankSnapshot?.account_holder_name ?? (r.rows[0].bank_account_name as string | null),
    events: [...events.rows, ...payments.rows].map((e) => ({
      action: String(e.action),
      note: String(e.note || ""),
      created_at: date(e.created_at)!,
    })),
    user_id: String(r.rows[0].user_id),
    display_name: String(r.rows[0].display_name),
    email: String(r.rows[0].email),
    audit: a
      ? {
          action: String(a.action),
          admin_email: String(a.admin_email),
          note: String(a.note || ""),
          created_at: date(a.created_at)!,
        }
      : null,
  };
}
async function settle(actor: string, kind: MoneyKind, id: string, input: unknown) {
  await assertAdmin(actor);
  const d = reviewInput.parse(input),
    reject = d.action === "REJECT" || d.action === "FAIL";
  if (kind === "VIP_PURCHASE" || (kind === "DEPOSIT" && ["FAIL", "PROCESS"].includes(d.action)))
    throw new ApiError(400, "Loại xử lý không hợp lệ.");
  if (
    !reject &&
    d.action !== "PROCESS" &&
    ((kind === "DEPOSIT" && d.action !== "APPROVE") ||
      (kind === "WITHDRAWAL" && d.action !== "COMPLETE") ||
      !d.confirmed)
  )
    throw new ApiError(400, "Vui lòng xác nhận đã kiểm tra/chuyển tiền thực tế.");
  const table = kind === "DEPOSIT" ? sql`cinevjet.deposits` : sql`cinevjet.withdrawals`;
  return database().transaction(async (tx) => {
    const r = await tx.execute(sql`SELECT * FROM ${table} WHERE id=${id} FOR UPDATE`);
    if (!r.rows.length) throw new ApiError(404, "Yêu cầu không tồn tại.");
    const request = r.rows[0];
    if (request.status !== "PENDING" && !(kind === "WITHDRAWAL" && request.status === "PROCESSING"))
      throw new ApiError(409, "Yêu cầu đã được xử lý. Không thể xử lý lần nữa.");
    if (kind === "DEPOSIT" && (request.provider !== "MANUAL_BANK" || !request.bill_id))
      throw new ApiError(
        409,
        "Yêu cầu cũ không có bill được xác thực; không hỗ trợ duyệt ở flow này.",
      );
    if (kind === "WITHDRAWAL" && !request.bank_account_number)
      throw new ApiError(409, "Yêu cầu cũ chưa có thông tin ngân hàng; cần xử lý riêng.");
    let job =
      kind === "WITHDRAWAL"
        ? (
            await tx.execute(
              sql`SELECT * FROM cinevjet.withdrawal_jobs WHERE withdrawal_id=${id} FOR UPDATE`,
            )
          ).rows[0]
        : null;
    if (
      job &&
      (job.provider_id ||
        ["PROCESSING", "SUBMITTED", "NEEDS_RECONCILIATION"].includes(String(job.status)))
    )
      throw new ApiError(409, "Phải đối soát lệnh provider trước khi xử lý thủ công.");
    let proofUrl: string | null = null;
    if (d.action === "PROCESS") {
      if (request.status === "PROCESSING") return dto(request, kind);
      if (!job) await enqueueWithdrawal(tx, request);
      // Manual acceptance removes a not-yet-dispatched job from automatic dispatch.
      await tx.execute(
        sql`UPDATE cinevjet.withdrawal_jobs SET status='MANUAL_REVIEW',updated_at=now() WHERE withdrawal_id=${id}`,
      );
      const accepted = await tx.execute(
        sql`UPDATE cinevjet.withdrawals SET status='PROCESSING',updated_at=now() WHERE id=${id} RETURNING *`,
      );
      await payoutAudit(tx, id, "ADMIN_REVIEW_STARTED", actor);
      return dto(accepted.rows[0], kind);
    }
    const needsEvidence = kind === "WITHDRAWAL";
    if (needsEvidence && !reject) {
      if (!d.evidence_reference || !d.proof_bill_id)
        throw new ApiError(400, "Cần mã giao dịch ngân hàng và bill chuyển tiền để xác nhận.");
      const proof = (
        await tx.execute(
          sql`SELECT url FROM cinevjet.deposit_bills WHERE id=${d.proof_bill_id} AND user_id=${actor}`,
        )
      ).rows[0];
      if (!proof) throw new ApiError(400, "Bill chuyển tiền chưa hợp lệ.");
      proofUrl = String(proof.url);
      if (!job) {
        // Attach manual evidence at settlement; never backfill production history.
        await enqueueWithdrawal(tx, request);
        job = (
          await tx.execute(
            sql`SELECT * FROM cinevjet.withdrawal_jobs WHERE withdrawal_id=${id} FOR UPDATE`,
          )
        ).rows[0];
      }
    }
    const userId = String(request.user_id),
      amount = Number(request.amount);
    // Suspension must not strand a rejected reservation; settlement authenticates the admin.
    const isCoins = kind === "WITHDRAWAL" && request.source_asset === "COIN";
    if (d.action === "FAIL" && !isCoins)
      throw new ApiError(400, "Chỉ yêu cầu đổi thưởng hỗ trợ trạng thái thất bại.");
    const assetTable = isCoins ? sql`cinevjet.coin_wallets` : sql`cinevjet.wallets`;
    const debit = isCoins ? Number(request.coins_amount) : amount;
    const w = await tx.execute(
      sql`SELECT balance,reserved FROM ${assetTable} WHERE user_id=${userId} FOR UPDATE`,
    );
    if (!w.rows.length) throw new ApiError(409, "Ví không tồn tại.");
    if (kind === "DEPOSIT" && !reject) {
      if (Number(w.rows[0].balance) > Number.MAX_SAFE_INTEGER - amount)
        throw new ApiError(409, "Số dư vượt giới hạn.");
      await tx.execute(
        sql`UPDATE cinevjet.wallets SET balance=balance+${amount} WHERE user_id=${userId}`,
      );
    }
    if (kind === "WITHDRAWAL") {
      if (Number(w.rows[0].reserved) < debit)
        throw new ApiError(409, "Khoản giữ tiền không đủ. Không thể quyết toán.");
      await tx.execute(
        sql`UPDATE ${assetTable} SET reserved=reserved-${debit},balance=balance-${reject ? 0 : debit} WHERE user_id=${userId}`,
      );
    }
    if (!reject && isCoins)
      await tx.execute(
        sql`INSERT INTO cinevjet.coin_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES(${randomUUID()},${userId},${-debit},'EXCHANGE','REDEMPTION',${id})`,
      );
    if (!reject && !isCoins)
      await tx.execute(
        sql`INSERT INTO cinevjet.wallet_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES(${randomUUID()},${userId},${kind === "DEPOSIT" ? amount : -amount},${kind},${kind},${id})`,
      );
    const admin = await tx.execute(sql`SELECT email FROM cinevjet.users WHERE id=${actor}`);
    const result = await tx.execute(
      sql`UPDATE ${table} SET status=${d.action === "FAIL" ? "FAILED" : reject ? "REJECTED" : "COMPLETED"},admin_note=${d.note},public_reason=${reject ? d.reason : null},reviewed_by=${actor},completed_at=${reject ? null : sql`now()`},rejected_at=${reject ? sql`now()` : null},updated_at=now() WHERE id=${id} RETURNING *`,
    );
    await tx.execute(
      sql`INSERT INTO cinevjet.money_audit(id,admin_id,admin_email,request_id,kind,action,note) VALUES(${randomUUID()},${actor},${String(admin.rows[0].email)},${id},${kind},${isCoins ? (d.action === "FAIL" ? "REDEMPTION_FAILED" : reject ? "REDEMPTION_REJECTED" : "REDEMPTION_COMPLETED") : kind === "DEPOSIT" ? (reject ? "DEPOSIT_REJECTED" : "DEPOSIT_APPROVED") : reject ? "WITHDRAWAL_REJECTED" : "WITHDRAWAL_COMPLETED"},${d.note})`,
    );
    if (job) {
      await tx.execute(
        sql`UPDATE cinevjet.withdrawal_jobs SET status=${reject ? "CANCELLED" : "SUCCEEDED"},evidence_reference=${d.evidence_reference || null},evidence_url=${proofUrl},completed_at=now(),updated_at=now() WHERE withdrawal_id=${id}`,
      );
      await payoutAudit(
        tx,
        id,
        reject ? "RESERVATION_RELEASED" : "MANUAL_TRANSFER_VERIFIED",
        actor,
        amount,
        d.evidence_reference || null,
      );
    }
    return dto(result.rows[0], kind);
  });
}
export const approveDepositRequest = (actor: string, id: string, input: unknown) =>
  settle(actor, "DEPOSIT", id, input);
export const completeWithdrawal = (actor: string, id: string, input: unknown) =>
  settle(actor, "WITHDRAWAL", id, input);
export type AdminMoneyDetail = Awaited<ReturnType<typeof adminMoneyDetail>>;
