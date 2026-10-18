import "server-only";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { assertAdmin } from "./admin-core";
import { currentReferralPolicy } from "./referral-policy";
import { classificationCTE, periodSince } from "./financial-reporting";
import { reportFilters } from "@/domain/referral-policy";
// Only ledger-backed credits are labelled credited. External payout attribution is unknown.
export const commissionSourceCTE = sql`commission_records AS (
 SELECT c.id,c.referrer_id beneficiary_id,c.referred_user_id buyer_id,c.source_id,1 level,c.amount,c.percent*100 bps,c.created_at,'REFERRAL'::text reference_type FROM cinevjet.referral_commissions c
 UNION ALL SELECT id,beneficiary_id,buyer_id,source_id,level,amount,bps,created_at,'REFERRAL_V2' FROM cinevjet.referral_commission_entries
), ledger_credits AS (
 SELECT c.* FROM commission_records c JOIN cinevjet.wallet_ledger l ON l.reference_type=c.reference_type AND l.reference_id=c.id AND l.user_id=c.beneficiary_id AND l.amount=c.amount AND l.type='REFERRAL_COMMISSION'
)`;
export async function adminReferralReport(actor: string, input: unknown = {}) {
  await assertAdmin(actor);
  const f = reportFilters.parse(input);
  return database().transaction(
    async (tx) => {
      const policy = await currentReferralPolicy(tx);
      const r = (
        await tx.execute(sql`WITH RECURSIVE ${classificationCTE}, ${commissionSourceCTE}, network AS (
 SELECT referred_by root,id,1 depth,ARRAY[referred_by,id]::text[] path FROM cinevjet.users WHERE referred_by IS NOT NULL AND referred_by<>id
 UNION ALL SELECT n.root,u.id,n.depth+1,n.path||u.id FROM network n JOIN cinevjet.users u ON u.referred_by=n.id WHERE n.depth<3 AND NOT u.id=ANY(n.path)
 ), registrations AS (SELECT * FROM cinevjet.users WHERE created_at>=${periodSince(f.period)} AND created_at<=now()), credits AS (
 SELECT l.* FROM ledger_credits l LEFT JOIN classifications c ON c.target_kind='VIP_PURCHASE' AND c.target_id=l.source_id
 WHERE l.created_at>=${periodSince(f.period)} AND l.created_at<=now() AND (${f.mode}='ALL' OR NOT COALESCE(c.excluded,false))
 ), ranks AS (
 SELECT u.id,u.display_name,(SELECT count(*) FROM registrations d WHERE d.referred_by=u.id AND d.id<>u.id) direct,
 (SELECT count(DISTINCT n.id) FROM network n JOIN registrations d ON d.id=n.id WHERE n.root=u.id) network,
 count(DISTINCT c.source_id) vip_events,count(c.id) records,COALESCE(sum(c.amount) FILTER(WHERE c.level=1),0) level1,COALESCE(sum(c.amount) FILTER(WHERE c.level=2),0) level2,COALESCE(sum(c.amount) FILTER(WHERE c.level=3),0) level3,COALESCE(sum(c.amount),0) total
 FROM cinevjet.users u LEFT JOIN credits c ON c.beneficiary_id=u.id GROUP BY u.id HAVING count(c.id)>0 OR EXISTS(SELECT 1 FROM registrations d WHERE d.referred_by=u.id)
 ) SELECT
 (SELECT count(*) FROM registrations WHERE referred_by IS NOT NULL AND referred_by<>id) direct,
 (SELECT count(DISTINCT n.id) FROM network n JOIN registrations d ON d.id=n.id) network,
(SELECT count(DISTINCT n.id) FROM network n JOIN registrations d ON d.id=n.id WHERE depth=1) f1,
(SELECT count(DISTINCT n.id) FROM network n JOIN registrations d ON d.id=n.id WHERE depth=2) f2,
(SELECT count(DISTINCT n.id) FROM network n JOIN registrations d ON d.id=n.id WHERE depth=3) f3,
 (SELECT count(DISTINCT source_id) FROM credits) vip_events,(SELECT count(*) FROM credits) records,
 (SELECT COALESCE(sum(amount),0) FROM credits) total,
 (SELECT COALESCE(sum(amount),0) FROM credits WHERE level=1) level1,
 (SELECT COALESCE(sum(amount),0) FROM credits WHERE level=2) level2,
 (SELECT COALESCE(sum(amount),0) FROM credits WHERE level=3) level3,
 (SELECT count(*) FROM commission_records)-(SELECT count(*) FROM ledger_credits) ledger_mismatches,
 COALESCE((SELECT jsonb_agg(x) FROM(SELECT * FROM ranks ORDER BY total DESC,direct DESC,id LIMIT 100) x),'[]'::jsonb) ranking,
 COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC,x.id) FROM(SELECT c.id,c.source_id,c.level,c.bps,c.amount,c.created_at,b.display_name beneficiary_name,u.display_name buyer_name FROM credits c JOIN cinevjet.users b ON b.id=c.beneficiary_id JOIN cinevjet.users u ON u.id=c.buyer_id ORDER BY c.created_at DESC,c.id LIMIT 100) x),'[]'::jsonb) history`)
      ).rows[0];
      const num = (v: Record<string, unknown>, key: string) => Number(v[key]);
      return {
        policy,
        ...f,
        stats: Object.fromEntries(
          [
            "direct",
            "network",
            "f1",
            "f2",
            "f3",
            "vip_events",
            "records",
            "total",
            "level1",
            "level2",
            "level3",
            "ledger_mismatches",
          ].map((k) => [k, num(r, k)]),
        ),
        ranking: (r.ranking as Record<string, unknown>[]).map((x) => ({
          id: String(x.id),
          name: String(x.display_name),
          direct: num(x, "direct"),
          network: num(x, "network"),
          vip_events: num(x, "vip_events"),
          records: num(x, "records"),
          levels: [num(x, "level1"), num(x, "level2"), num(x, "level3")],
          total: num(x, "total"),
        })),
        history: (r.history as Record<string, unknown>[]).map((x) => ({
          id: String(x.id),
          source_id: String(x.source_id),
          level: Number(x.level),
          bps: Number(x.bps),
          amount: Number(x.amount),
          created_at: new Date(x.created_at as string).toISOString(),
          beneficiary_name: String(x.beneficiary_name),
          buyer_name: String(x.buyer_name),
        })),
        external_payouts: "UNATTRIBUTABLE" as const,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export type ReferralAdminData = Awaited<ReturnType<typeof adminReferralReport>>;
