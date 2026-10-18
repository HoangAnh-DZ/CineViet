import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { ApiError } from "./http";
import { commissionAmount, referralPolicyInput, referralRate } from "@/domain/referral-policy";
type Executor = Pick<ReturnType<typeof database>, "execute">;
export async function currentReferralPolicy(tx: Executor = database()) {
  const r = (
    await tx.execute(
      sql`SELECT v.*,u.display_name AS editor FROM cinevjet.referral_policy_control c JOIN cinevjet.referral_policy_versions v ON v.id=c.active_version LEFT JOIN cinevjet.users u ON u.id=v.created_by WHERE c.id='default'`,
    )
  ).rows[0];
  if (!r) throw new ApiError(503, "Chưa tải được cấu hình hoa hồng.");
  return {
    version: String(r.id),
    rates_bps: [Number(r.level1_bps), Number(r.level2_bps), Number(r.level3_bps)] as [
      number,
      number,
      number,
    ],
    editor: r.editor ? String(r.editor) : null,
    updated_at: new Date(r.created_at as string).toISOString(),
  };
}
export async function adminReferralPolicy(actor: string) {
  await assertAdmin(actor);
  return currentReferralPolicy();
}
export async function updateReferralPolicy(actor: string, input: unknown) {
  await assertAdmin(actor);
  const d = referralPolicyInput.parse(input);
  return database().transaction(async (tx) => {
    const c = (
      await tx.execute(
        sql`SELECT * FROM cinevjet.referral_policy_control WHERE id='default' FOR UPDATE`,
      )
    ).rows[0];
    if (c.active_version !== d.expected_version)
      throw new ApiError(409, "Cấu hình đã đổi. Hãy tải lại trang.");
    const id = randomUUID();
    await tx.execute(
      sql`INSERT INTO cinevjet.referral_policy_versions(id,previous_id,level1_bps,level2_bps,level3_bps,created_by,reason) VALUES(${id},${c.active_version},${d.rates_bps[0]},${d.rates_bps[1]},${d.rates_bps[2]},${actor},${d.reason})`,
    );
    await tx.execute(
      sql`UPDATE cinevjet.referral_policy_control SET active_version=${id} WHERE id='default'`,
    );
    return currentReferralPolicy(tx);
  });
}
// Called only inside the existing verified settlement transaction, after completion.
// NULL snapshot means pre-migration order: the caller retains its legacy policy.
export async function settleReferralCommission(tx: Executor, id: string) {
  const r = (
    await tx.execute(
      sql`SELECT id,user_id,amount,status,referral_snapshot FROM cinevjet.vip_purchase_requests WHERE id=${id} FOR UPDATE`,
    )
  ).rows[0];
  if (!r || r.status !== "COMPLETED") throw new ApiError(409, "VIP chưa được xác nhận thanh toán.");
  if (!r.referral_snapshot) return false;
  const s = r.referral_snapshot as {
    version: string;
    rates_bps: number[];
    beneficiaries: string[];
  };
  if (
    s.rates_bps.length !== 3 ||
    s.beneficiaries.length > 3 ||
    new Set([String(r.user_id), ...s.beneficiaries]).size !== s.beneficiaries.length + 1 ||
    s.rates_bps.some((bps) => !referralRate.safeParse(bps).success)
  )
    throw new ApiError(409, "Snapshot hoa hồng không hợp lệ.");
  // Stable lock ordering across overlapping referral trees avoids wallet deadlocks.
  for (const beneficiary of [...s.beneficiaries].sort())
    if (
      !(
        await tx.execute(
          sql`SELECT user_id FROM cinevjet.wallets WHERE user_id=${beneficiary} FOR UPDATE`,
        )
      ).rows.length
    )
      throw new ApiError(409, "Chưa sẵn sàng ghi có hoa hồng.");
  for (let i = 0; i < s.beneficiaries.length; i++) {
    const beneficiary = s.beneficiaries[i],
      bps = s.rates_bps[i],
      amount = commissionAmount(Number(r.amount), bps);
    if (!amount) continue;
    const entry = randomUUID();
    const inserted = await tx.execute(
      sql`INSERT INTO cinevjet.referral_commission_entries(id,source_id,buyer_id,beneficiary_id,level,bps,purchase_amount,amount,policy_id) VALUES(${entry},${id},${r.user_id},${beneficiary},${i + 1},${bps},${r.amount},${amount},${s.version}) ON CONFLICT DO NOTHING RETURNING id`,
    );
    if (!inserted.rows.length) continue;
    await tx.execute(
      sql`UPDATE cinevjet.wallets SET balance=balance+${amount}::bigint WHERE user_id=${beneficiary}`,
    );
    await tx.execute(
      sql`INSERT INTO cinevjet.wallet_ledger(id,user_id,amount,type,reference_type,reference_id) VALUES(${randomUUID()},${beneficiary},${amount},'REFERRAL_COMMISSION','REFERRAL_V2',${entry})`,
    );
  }
  return true;
}
