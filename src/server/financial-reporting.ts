import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { ApiError } from "./http";
import { reportClassificationInput, reportFilters } from "@/domain/referral-policy";

// One source definition for KPI, daily and monthly reports. Never substitutes created_at.
export const classificationCTE = sql`classifications AS (
 SELECT DISTINCT ON(target_kind,target_id) target_kind,target_id,excluded,id,reason,confirmed_by,confirmed_at
 FROM cinevjet.reporting_classifications ORDER BY target_kind,target_id,confirmed_at DESC,id DESC
)`;
export const cashSourceCTE = sql`${classificationCTE}, receipts AS (
 SELECT 'DEPOSIT'::text kind,id,amount,completed_at,provider FROM cinevjet.deposits WHERE status='COMPLETED'
 UNION ALL SELECT 'VIP_PURCHASE',id,amount,completed_at,provider FROM cinevjet.vip_purchase_requests WHERE status='COMPLETED'
), raw_cash AS (
 SELECT r.kind,r.id,r.amount gross,0::bigint fee,r.amount income,0::bigint outgoing,'VND'::text asset,
 CASE WHEN r.provider='PAYOS' THEN COALESCE(p.settled_at,r.completed_at) ELSE r.completed_at END settled_at,
 CASE WHEN r.provider='PAYOS' THEN 'PAYOS/'||p.order_code::text ELSE r.kind||'/'||r.id END cash_key,
 (r.provider='PAYOS' AND (p.id IS NULL OR p.status<>'PAID' OR p.amount<>r.amount OR p.kind<>r.kind)) provider_issue,
 COALESCE(c.excluded,false) excluded
 FROM receipts r LEFT JOIN cinevjet.payos_orders p ON (p.deposit_id=r.id AND r.kind='DEPOSIT') OR (p.vip_purchase_id=r.id AND r.kind='VIP_PURCHASE')
 LEFT JOIN classifications c ON c.target_kind=r.kind AND c.target_id=r.id
 UNION ALL SELECT 'WITHDRAWAL',w.id,w.amount,w.fee,0::bigint,w.amount-w.fee,w.source_asset,w.completed_at,'WITHDRAWAL/'||w.id,false,COALESCE(c.excluded,false)
 FROM cinevjet.withdrawals w LEFT JOIN classifications c ON c.target_kind='WITHDRAWAL' AND c.target_id=w.id WHERE w.status='COMPLETED'
), verified_cash AS (
 SELECT DISTINCT ON(cash_key) *,bool_or(excluded) OVER(PARTITION BY cash_key) group_excluded
 FROM raw_cash WHERE settled_at IS NOT NULL AND NOT provider_issue AND cash_key IS NOT NULL
 ORDER BY cash_key,settled_at,id
)`;
export function periodSince(period: string) {
  return sql`CASE ${period} WHEN 'TODAY' THEN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHEN 'WEEK' THEN ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-6)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHEN 'MONTH' THEN date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' ELSE '-infinity'::timestamptz END`;
}
export async function financialReport(
  actor: string,
  input: unknown = {},
  executor: Pick<ReturnType<typeof database>, "execute"> = database(),
) {
  await assertAdmin(actor, executor);
  const { mode } = reportFilters.parse(input);
  const r = (
    await executor.execute(sql`WITH ${cashSourceCTE}, cash AS (
 SELECT * FROM verified_cash WHERE settled_at<=now() AND (${mode}='ALL' OR NOT group_excluded)
 ), periods AS (SELECT unnest(ARRAY['TODAY','WEEK','MONTH','ALL']) period), totals AS (
 SELECT p.period,COALESCE(sum(c.income),0) income,COALESCE(sum(c.outgoing),0) outgoing,
 COALESCE(sum(c.income) FILTER(WHERE kind='DEPOSIT'),0) deposits,COALESCE(sum(c.income) FILTER(WHERE kind='VIP_PURCHASE'),0) vip,
 COALESCE(sum(c.outgoing) FILTER(WHERE kind='WITHDRAWAL' AND asset='VND'),0) withdrawal_vnd,
 COALESCE(sum(c.outgoing) FILTER(WHERE kind='WITHDRAWAL' AND asset='COIN'),0) redemptions,
 COALESCE(sum(c.gross) FILTER(WHERE kind='WITHDRAWAL'),0) gross,COALESCE(sum(c.fee) FILTER(WHERE kind='WITHDRAWAL'),0) fees
 FROM periods p LEFT JOIN cash c ON c.settled_at>=CASE p.period WHEN 'TODAY' THEN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHEN 'WEEK' THEN ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-6)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHEN 'MONTH' THEN date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' ELSE '-infinity'::timestamptz END GROUP BY p.period
 ), daily AS (
 SELECT to_char(d,'YYYY-MM-DD') AS day,COALESCE(sum(c.income),0) income,COALESCE(sum(c.outgoing),0) outgoing FROM generate_series((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-29,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,interval '1 day') d
 LEFT JOIN cash c ON (c.settled_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date=d::date GROUP BY d
 ), monthly AS (
 SELECT to_char(d,'YYYY-MM') AS day,COALESCE(sum(c.income),0) income,COALESCE(sum(c.outgoing),0) outgoing FROM generate_series(date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')-interval '11 months',date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh'),interval '1 month') d
 LEFT JOIN cash c ON date_trunc('month',c.settled_at AT TIME ZONE 'Asia/Ho_Chi_Minh')=d GROUP BY d
 ) SELECT
 (SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('new_users',(SELECT count(*) FROM cinevjet.users u WHERE u.created_at<=now() AND u.created_at>=CASE t.period WHEN 'TODAY' THEN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHEN 'WEEK' THEN ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-6)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' WHEN 'MONTH' THEN date_trunc('month',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' ELSE '-infinity'::timestamptz END))) FROM totals t) periods,
 (SELECT jsonb_agg(d ORDER BY d.day) FROM daily d) daily,(SELECT jsonb_agg(m ORDER BY m.day) FROM monthly m) monthly,
 (SELECT count(*) FROM cinevjet.users) users,
 (SELECT count(*) FROM raw_cash WHERE settled_at IS NULL OR provider_issue OR cash_key IS NULL) unverified,
 (SELECT count(*) FROM raw_cash WHERE settled_at IS NOT NULL AND NOT provider_issue)-(SELECT count(*) FROM verified_cash) duplicates,
 (SELECT count(*) FROM verified_cash WHERE group_excluded) excluded,
 now() reported_at,
 (SELECT count(*) FROM cinevjet.deposits d WHERE d.status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM cinevjet.wallet_ledger l WHERE l.reference_type='DEPOSIT' AND l.reference_id=d.id AND l.user_id=d.user_id AND l.amount=d.amount))+
 (SELECT count(*) FROM cinevjet.withdrawals w WHERE w.status='COMPLETED' AND ((w.source_asset='VND' AND NOT EXISTS(SELECT 1 FROM cinevjet.wallet_ledger l WHERE l.reference_type='WITHDRAWAL' AND l.reference_id=w.id AND l.user_id=w.user_id AND l.amount=-w.amount)) OR (w.source_asset='COIN' AND NOT EXISTS(SELECT 1 FROM cinevjet.coin_ledger l WHERE l.reference_type='REDEMPTION' AND l.reference_id=w.id AND l.user_id=w.user_id AND l.amount=-w.coins_amount))))+
 (SELECT count(*) FROM cinevjet.vip_purchase_requests v WHERE v.status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM cinevjet.vip_subscriptions s WHERE s.id=v.subscription_id AND s.user_id=v.user_id AND s.activation_reference='VIP_PURCHASE/'||v.id AND s.activation_verified_at IS NOT NULL)) ledger_mismatches`)
  ).rows[0];
  const point = (v: Record<string, unknown>) => ({
    day: String(v.day),
    income: Number(v.income),
    outgoing: Number(v.outgoing),
    profit: Number(v.income) - Number(v.outgoing),
  });
  const periods = (r.periods as Record<string, unknown>[]).map((v) => ({
    period: String(v.period),
    income: Number(v.income),
    outgoing: Number(v.outgoing),
    profit: Number(v.income) - Number(v.outgoing),
    deposits: Number(v.deposits),
    vip: Number(v.vip),
    withdrawal_vnd: Number(v.withdrawal_vnd),
    redemptions: Number(v.redemptions),
    gross: Number(v.gross),
    fees: Number(v.fees),
    new_users: Number(v.new_users),
  }));
  return {
    mode,
    reported_at: new Date(r.reported_at as string).toISOString(),
    periods,
    totals: periods.find((p) => p.period === "ALL")!,
    users: Number(r.users),
    chart: (r.daily as Record<string, unknown>[]).map(point),
    monthlyChart: (r.monthly as Record<string, unknown>[]).map(point),
    quality: {
      unverified: Number(r.unverified),
      duplicates: Number(r.duplicates),
      excluded: Number(r.excluded),
      ledger_mismatches: Number(r.ledger_mismatches),
    },
    refunds: "UNTRACKED" as const,
  };
}

const classificationSources = sql`(SELECT 'DEPOSIT'::text kind,id,user_id,amount,0::bigint fee,status,created_at,completed_at,provider,'VND'::text source_asset FROM cinevjet.deposits UNION ALL SELECT 'VIP_PURCHASE',id,user_id,amount,0::bigint,status,created_at,completed_at,provider,'VND' FROM cinevjet.vip_purchase_requests UNION ALL SELECT 'WITHDRAWAL',id,user_id,amount,fee,status,created_at,completed_at,'PAYOUT',source_asset FROM cinevjet.withdrawals)`;
function classificationDto(r: Record<string, unknown>) {
  const source = {
    kind: String(r.kind),
    id: String(r.id),
    user_id: String(r.user_id),
    amount: Number(r.amount),
    fee: Number(r.fee),
    status: String(r.status),
    completed_at: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
    provider: String(r.provider),
    source_asset: String(r.source_asset),
  };
  return {
    kind: source.kind,
    id: source.id,
    amount: source.amount,
    fee: source.fee,
    net: source.amount - source.fee,
    status: source.status,
    completed_at: source.completed_at,
    provider: source.provider,
    source_asset: source.source_asset,
    masked_user: "••••" + source.user_id.slice(-6),
    created_at: new Date(r.created_at as string).toISOString(),
    excluded: Boolean(r.excluded),
    classification: r.classification_id ? (r.excluded ? "TEST" : "REAL") : "UNKNOWN",
    revision: r.classification_id ? String(r.classification_id) : null,
    reason: r.reason ? String(r.reason) : null,
    confirmed_at: r.confirmed_at ? new Date(r.confirmed_at as string).toISOString() : null,
    confirmed_by: r.confirmed_by ? "••••" + String(r.confirmed_by).slice(-6) : null,
    evidence:
      source.status !== "COMPLETED"
        ? "Chưa hoàn tất"
        : r.provider_paid
          ? "payOS PAID, khớp số tiền"
          : r.reviewed
            ? "Có dấu vết Admin xác nhận"
            : "Chưa có bằng chứng đối soát đầy đủ",
    fingerprint: createHash("sha256").update(JSON.stringify(source)).digest("hex"),
  };
}
export async function reportingCandidates(actor: string) {
  await assertAdmin(actor);
  const r = await database()
    .execute(sql`WITH ${classificationCTE} SELECT t.*,c.excluded,c.id classification_id,c.reason,c.confirmed_at,c.confirmed_by,
 EXISTS(SELECT 1 FROM cinevjet.payos_orders p WHERE ((p.deposit_id=t.id AND t.kind='DEPOSIT') OR (p.vip_purchase_id=t.id AND t.kind='VIP_PURCHASE')) AND p.status='PAID' AND p.amount=t.amount) provider_paid,
 EXISTS(SELECT 1 FROM cinevjet.money_audit a WHERE a.request_id=t.id AND a.kind=t.kind AND a.action IN ('DEPOSIT_APPROVED','VIP_APPROVED','WITHDRAWAL_COMPLETED','REDEMPTION_COMPLETED')) reviewed
 FROM ${classificationSources} t LEFT JOIN classifications c ON c.target_kind=t.kind AND c.target_id=t.id ORDER BY t.created_at DESC,t.id LIMIT 100`);
  return r.rows.map(classificationDto);
}
export async function financialReportRevision(
  actor: string,
  executor: Pick<ReturnType<typeof database>, "execute"> = database(),
) {
  await assertAdmin(actor, executor);
  const row = (
    await executor.execute(sql`SELECT
 (SELECT jsonb_build_array(count(*),count(*) FILTER(WHERE status='COMPLETED'),max(updated_at)) FROM cinevjet.deposits) deposits,
 (SELECT jsonb_build_array(count(*),count(*) FILTER(WHERE status='COMPLETED'),max(updated_at)) FROM cinevjet.vip_purchase_requests) vip,
 (SELECT jsonb_build_array(count(*),count(*) FILTER(WHERE status='COMPLETED'),max(updated_at)) FROM cinevjet.withdrawals) withdrawals,
 (SELECT jsonb_build_array(count(*),max(updated_at)) FROM cinevjet.users) users,
 (SELECT jsonb_build_array(count(*),max(confirmed_at)) FROM cinevjet.reporting_classifications) classifications,
 to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') business_day`)
  ).rows[0];
  return createHash("sha256").update(JSON.stringify(row)).digest("hex");
}
export async function classifyReportingTransaction(actor: string, input: unknown) {
  await assertAdmin(actor);
  const d = reportClassificationInput.parse(input);
  return database().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${d.target_kind + "/" + d.target_id},0))`,
    );
    const table =
      d.target_kind === "DEPOSIT"
        ? sql`cinevjet.deposits`
        : d.target_kind === "VIP_PURCHASE"
          ? sql`cinevjet.vip_purchase_requests`
          : sql`cinevjet.withdrawals`;
    // Serialize with settlement/review so the confirmation cannot race a status change.
    await tx.execute(sql`SELECT id FROM ${table} WHERE id=${d.target_id} FOR SHARE`);
    const row = (
      await tx.execute(
        sql`SELECT * FROM ${classificationSources} t WHERE kind=${d.target_kind} AND id=${d.target_id}`,
      )
    ).rows[0];
    if (!row) throw new ApiError(404, "Không tìm thấy giao dịch.");
    if (classificationDto(row).fingerprint !== d.fingerprint)
      throw new ApiError(409, "Giao dịch đã đổi. Hãy tải lại trước khi xác nhận.");
    const previous = (
      await tx.execute(
        sql`SELECT id,excluded FROM cinevjet.reporting_classifications WHERE target_kind=${d.target_kind} AND target_id=${d.target_id} ORDER BY confirmed_at DESC,id DESC LIMIT 1`,
      )
    ).rows[0];
    if (previous?.excluded === d.excluded) return { changed: false };
    if ((previous?.id ?? null) !== d.expected_revision)
      throw new ApiError(409, "Phân loại đã được Admin khác cập nhật. Hãy tải lại giao dịch.");
    await tx.execute(
      sql`INSERT INTO cinevjet.reporting_classifications(id,target_kind,target_id,excluded,previous_id,fingerprint,reason,confirmed_by) VALUES(${randomUUID()},${d.target_kind},${d.target_id},${d.excluded},${previous?.id ?? null},${d.fingerprint},${d.reason},${actor})`,
    );
    return { changed: true };
  });
}
