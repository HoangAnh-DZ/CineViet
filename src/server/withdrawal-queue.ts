import "server-only";
import { withdrawalBankDetails } from "./bank-secrets";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "./db";
import { ApiError } from "./http";
import { assertAdmin } from "./admin-core";
import {
  autoPayoutEnabled,
  payoutConfigured,
  payosPayoutAdapter,
  PayoutError,
  type PayoutInfo,
  type PayoutJob,
} from "./payos-payout";
type Executor = Pick<ReturnType<typeof database>, "execute">;
export async function payoutAudit(
  tx: Executor,
  id: string | null,
  action: string,
  actor: string | null = null,
  amount: number | null = null,
  note: string | null = null,
) {
  await tx.execute(
    sql`INSERT INTO cinevjet.payout_audit(id,withdrawal_id,actor_id,action,amount,note) VALUES(${randomUUID()},${id},${actor},${action},${amount},${note})`,
  );
}
export async function enqueueWithdrawal(
  tx: Executor,
  r: Record<string, unknown>,
  bankCode?: string,
) {
  const c = (
    await tx.execute(
      sql`SELECT transaction_limit,daily_limit FROM cinevjet.payout_control WHERE id='default'`,
    )
  ).rows[0];
  const ready =
    r.source_asset === "VND" &&
    autoPayoutEnabled() &&
    c.transaction_limit &&
    c.daily_limit &&
    bankCode;
  await tx.execute(
    sql`INSERT INTO cinevjet.withdrawal_jobs(withdrawal_id,bank_code,reference_id,idempotency_key,status) VALUES(${r.id},${bankCode || null},${"CVJ/" + r.id},${randomUUID()},${ready ? "QUEUED" : "MANUAL_REVIEW"})`,
  );
  // Reservation doesn't change total balance: use a hold audit, not a monetary debit.
  await payoutAudit(tx, String(r.id), "RESERVED", null, Number(r.amount));
  return ready ? "QUEUED" : "MANUAL_REVIEW";
}
export async function queueSnapshot(actor: string) {
  await assertAdmin(actor);
  const [c, jobs] = await Promise.all([
    database().execute(
      sql`SELECT paused,interval_seconds,transaction_limit,daily_limit FROM cinevjet.payout_control WHERE id='default'`,
    ),
    database().execute(
      sql`SELECT j.*,w.amount,w.fee,w.bank_name,w.bank_account_number,u.display_name FROM cinevjet.withdrawal_jobs j JOIN cinevjet.withdrawals w ON w.id=j.withdrawal_id JOIN cinevjet.users u ON u.id=w.user_id ORDER BY j.created_at,j.withdrawal_id LIMIT 100`,
    ),
  ]);
  return {
    control: c.rows[0],
    auto_enabled: autoPayoutEnabled(),
    jobs: jobs.rows.map((r) => ({
      ...r,
      bank_account_number: "••••" + String(r.bank_account_number).slice(-4),
    })),
  };
}
const controlInput = z
  .object({
    paused: z.boolean(),
    interval_seconds: z.number().int().min(30).max(86400),
    transaction_limit: z.number().int().positive().max(100000000).nullable(),
    daily_limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict();
export async function setQueueControl(actor: string, input: unknown) {
  await assertAdmin(actor);
  const d = controlInput.parse(input);
  await database().transaction(async (tx) => {
    await tx.execute(
      sql`UPDATE cinevjet.payout_control SET paused=${d.paused},interval_seconds=${d.interval_seconds},transaction_limit=${d.transaction_limit},daily_limit=${d.daily_limit},updated_at=now() WHERE id='default'`,
    );
    await payoutAudit(
      tx,
      null,
      d.paused ? "QUEUE_PAUSED" : "QUEUE_RESUMED",
      actor,
      null,
      "Interval " + d.interval_seconds,
    );
  });
  return queueSnapshot(actor);
}
export async function queueAction(actor: string, id: string, action: "RETRY" | "MANUAL_REVIEW") {
  await assertAdmin(actor);
  await database().transaction(async (tx) => {
    const j = (
      await tx.execute(
        sql`SELECT * FROM cinevjet.withdrawal_jobs WHERE withdrawal_id=${id} FOR UPDATE`,
      )
    ).rows[0];
    if (!j || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(String(j.status)))
      throw new ApiError(409, "Lệnh đã kết thúc.");
    if (
      action === "RETRY" &&
      (!autoPayoutEnabled() ||
        j.status !== "RETRY_WAIT" ||
        Number(j.attempts) >= 5 ||
        j.provider_id)
    )
      throw new ApiError(409, "Lệnh chưa đủ điều kiện retry an toàn.");
    if (
      action === "MANUAL_REVIEW" &&
      (j.provider_id ||
        ["PROCESSING", "SUBMITTED", "NEEDS_RECONCILIATION"].includes(String(j.status)))
    )
      throw new ApiError(409, "Cần đối soát provider trước khi xử lý thủ công.");
    await tx.execute(
      sql`UPDATE cinevjet.withdrawal_jobs SET status=${action === "RETRY" ? "QUEUED" : "MANUAL_REVIEW"},next_attempt_at=now(),updated_at=now() WHERE withdrawal_id=${id}`,
    );
    await payoutAudit(tx, id, action, actor);
  });
}
export async function claimPayout(reconcileOnly = false) {
  if (reconcileOnly ? !payoutConfigured() : !autoPayoutEnabled()) return null;
  return database().transaction(async (tx) => {
    const c = (
      await tx.execute(
        sql`SELECT *,now() AS db_now FROM cinevjet.payout_control WHERE id='default' FOR UPDATE`,
      )
    ).rows[0];
    const now = new Date(c.db_now as string).getTime();
    if (
      (!reconcileOnly && (c.paused || !c.daily_limit || !c.transaction_limit)) ||
      (c.leased_until && new Date(c.leased_until as string).getTime() > now) ||
      new Date(c.next_dispatch_at as string).getTime() > now
    )
      return null;
    // Oldest unresolved dispatch blocks later sends. Expired leases reconcile rather than resubmit.
    const j = (
      await tx.execute(
        sql`SELECT j.*,w.amount,w.fee,w.bank_account_number,w.bank_account_name,w.bank_snapshot_ciphertext,w.destination,w.user_id,w.status AS withdrawal_status,u.status AS user_status FROM cinevjet.withdrawal_jobs j JOIN cinevjet.withdrawals w ON w.id=j.withdrawal_id JOIN cinevjet.users u ON u.id=w.user_id WHERE w.source_asset='VND' AND ${reconcileOnly ? sql`j.status IN ('PROCESSING','SUBMITTED','NEEDS_RECONCILIATION')` : sql`j.status IN ('QUEUED','PROCESSING','SUBMITTED','RETRY_WAIT','NEEDS_RECONCILIATION')`} ORDER BY j.created_at,j.withdrawal_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
      )
    ).rows[0];
    if (!j || new Date(j.next_attempt_at as string).getTime() > now) return null;
    if (j.user_status !== "ACTIVE" && ["QUEUED", "RETRY_WAIT"].includes(String(j.status))) {
      await tx.execute(
        sql`UPDATE cinevjet.withdrawal_jobs SET status='MANUAL_REVIEW',last_error_code='USER_INACTIVE' WHERE withdrawal_id=${j.withdrawal_id}`,
      );
      return null;
    }
    if (["QUEUED", "RETRY_WAIT"].includes(String(j.status))) {
      const daily = (
        await tx.execute(
          sql`SELECT COALESCE(sum(w.amount),0) AS amount FROM cinevjet.withdrawal_jobs j JOIN cinevjet.withdrawals w ON w.id=j.withdrawal_id WHERE j.status IN ('PROCESSING','SUBMITTED','NEEDS_RECONCILIATION','SUCCEEDED') AND j.updated_at >= date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`,
        )
      ).rows[0];
      if (
        Number(j.amount) > Number(c.transaction_limit) ||
        Number(daily.amount) + Number(j.amount) > Number(c.daily_limit) ||
        !j.bank_code
      ) {
        await tx.execute(
          sql`UPDATE cinevjet.withdrawal_jobs SET status='MANUAL_REVIEW',last_error_code='LIMIT_OR_BANK_REVIEW' WHERE withdrawal_id=${j.withdrawal_id}`,
        );
        return null;
      }
    }
    const recipient = await withdrawalBankDetails({ ...j, id: j.withdrawal_id });
    const token = randomUUID(),
      reconcile = !["QUEUED", "RETRY_WAIT"].includes(String(j.status));
    await tx.execute(
      sql`UPDATE cinevjet.payout_control SET lease_token=${token},leased_until=now()+interval '90 seconds',next_dispatch_at=now()+(${Number(c.interval_seconds)}*interval '1 second') WHERE id='default'`,
    );
    await tx.execute(
      sql`UPDATE cinevjet.withdrawal_jobs SET status=${reconcile ? "NEEDS_RECONCILIATION" : "PROCESSING"},lease_token=${token},leased_until=now()+interval '90 seconds',attempts=attempts+${reconcile ? 0 : 1},updated_at=now() WHERE withdrawal_id=${j.withdrawal_id}`,
    );
    await payoutAudit(
      tx,
      String(j.withdrawal_id),
      reconcile ? "RECONCILE_CLAIMED" : "DISPATCH_CLAIMED",
    );
    return {
      ...j,
      bank_account_number: recipient.account_number,
      token,
      reconcile,
      attempts: Number(j.attempts) + (reconcile ? 0 : 1),
      amount: Number(j.amount),
      fee: Number(j.fee),
    } as unknown as PayoutJob & { token: string; reconcile: boolean };
  });
}
export async function settlePayout(j: PayoutJob & { token: string }, info: PayoutInfo) {
  const t = info.transactions;
  if (
    info.referenceId !== j.reference_id ||
    (j.provider_id && info.id !== j.provider_id) ||
    t.length !== 1 ||
    t[0].referenceId !== j.reference_id ||
    t[0].amount !== j.amount - j.fee ||
    t[0].toBin !== j.bank_code ||
    t[0].toAccountNumber !== j.bank_account_number
  )
    throw new PayoutError("PAYOUT_MISMATCH");
  const success = t[0].state === "SUCCEEDED",
    failure =
      ["FAILED", "CANCELLED"].includes(t[0].state) &&
      ["FAILED", "REJECTED", "CANCELLED"].includes(info.approvalState);
  // A failed transaction can still be subject to provider processing; only definitive rejection releases funds.
  return database().transaction(async (tx) => {
    const w = (
      await tx.execute(
        sql`SELECT * FROM cinevjet.withdrawals WHERE id=${j.withdrawal_id} FOR UPDATE`,
      )
    ).rows[0];
    const q = (
      await tx.execute(
        sql`SELECT * FROM cinevjet.withdrawal_jobs WHERE withdrawal_id=${j.withdrawal_id} FOR UPDATE`,
      )
    ).rows[0];
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(String(q.status))) return;
    if (q.lease_token !== j.token) throw new PayoutError("LEASE_CHANGED");
    if (!w || w.source_asset !== "VND" || Number(w.amount) !== j.amount || w.status !== "PENDING")
      throw new PayoutError("WITHDRAWAL_MISMATCH");
    if (success || failure) {
      const r = await tx.execute(
        sql`UPDATE cinevjet.wallets SET reserved=reserved-${j.amount},balance=balance-${success ? j.amount : 0} WHERE user_id=${w.user_id} AND reserved>=${j.amount} RETURNING user_id`,
      );
      if (!r.rows.length) throw new PayoutError("RESERVATION_MISMATCH");
      if (success)
        await tx.execute(
          sql`INSERT INTO cinevjet.wallet_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES(${randomUUID()},${w.user_id},${-j.amount},'WITHDRAWAL','WITHDRAWAL',${j.withdrawal_id})`,
        );
      await tx.execute(
        sql`UPDATE cinevjet.withdrawals SET status=${success ? "COMPLETED" : "FAILED"},completed_at=${success ? sql`now()` : sql`NULL`},public_reason=${failure ? "Chuyển tiền thất bại, khoản giữ đã được hoàn lại." : null},updated_at=now() WHERE id=${j.withdrawal_id}`,
      );
      await payoutAudit(
        tx,
        j.withdrawal_id,
        success ? "PAYOUT_SUCCEEDED" : "RESERVATION_RELEASED",
        null,
        j.amount,
      );
    }
    await tx.execute(
      sql`UPDATE cinevjet.withdrawal_jobs SET status=${success ? "SUCCEEDED" : failure ? "FAILED" : "SUBMITTED"},provider_id=${info.id},next_attempt_at=now()+interval '60 seconds',leased_until=NULL,updated_at=now(),completed_at=${success || failure ? sql`now()` : sql`NULL`} WHERE withdrawal_id=${j.withdrawal_id}`,
    );
  });
}
export async function runPayoutWorker(adapter = payosPayoutAdapter, reconcileOnly = false) {
  const j = await claimPayout(reconcileOnly);
  if (!j) return { dispatched: false, auto_enabled: autoPayoutEnabled() };
  try {
    const info = j.reconcile ? await adapter.find(j) : await adapter.submit(j);
    if (!info) throw new PayoutError("NOT_FOUND_UNKNOWN");
    await settlePayout(j, info);
    return { dispatched: !j.reconcile, reconciled: j.reconcile };
  } catch (e) {
    const retry =
      e instanceof PayoutError && e.httpStatus === 429 && !j.reconcile && j.attempts < 5;
    const exhaustedRateLimit =
      e instanceof PayoutError && e.httpStatus === 429 && !j.reconcile && !retry;
    const state = retry
      ? "RETRY_WAIT"
      : exhaustedRateLimit
        ? "MANUAL_REVIEW"
        : "NEEDS_RECONCILIATION";
    const code = e instanceof PayoutError ? e.safeCode : "PROVIDER_UNKNOWN";
    await database().transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE cinevjet.withdrawal_jobs SET status=${state},last_error_code=${code},next_attempt_at=now()+(${Math.min(3600, 30 * 2 ** Math.min(j.attempts, 7))}*interval '1 second'),leased_until=NULL,updated_at=now() WHERE withdrawal_id=${j.withdrawal_id} AND lease_token=${j.token} AND status NOT IN ('SUCCEEDED','FAILED','CANCELLED')`,
      );
      await payoutAudit(
        tx,
        j.withdrawal_id,
        retry ? "SAFE_RETRY_WAIT" : exhaustedRateLimit ? "RETRY_EXHAUSTED" : "NEEDS_RECONCILIATION",
        null,
        null,
        code,
      );
    });
    return { dispatched: false, state };
  } finally {
    await database().execute(
      sql`UPDATE cinevjet.payout_control SET leased_until=NULL,lease_token=NULL WHERE id='default' AND lease_token=${j.token}`,
    );
  }
}
