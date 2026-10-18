import { commissionSourceCTE } from "./referral-reporting";
import { currentReferralPolicy } from "./referral-policy";
import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "./db";
import { referralSummary } from "./account";

export const referralFilters = z
  .object({
    level: z.coerce.number().int().min(0).max(3).default(0),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
export async function referralDashboard(userId: string, filters: unknown = {}) {
  const { level, page } = referralFilters.parse(filters);
  const identity = await referralSummary(userId);
  const pageSize = 20;
  const row = await database().transaction(
    async (tx) =>
      (
        await tx.execute(sql`WITH RECURSIVE ${commissionSourceCTE}, network AS (
      SELECT u.id,1 AS level,ARRAY[${userId},u.id]::text[] AS path FROM cinevjet.users u WHERE u.referred_by=${userId} AND u.id<>${userId}
      UNION ALL
      SELECT u.id,n.level+1,n.path||u.id FROM cinevjet.users u JOIN network n ON u.referred_by=n.id WHERE n.level<3 AND NOT u.id=ANY(n.path)
    ), members AS (
      SELECT u.id,u.display_name,u.created_at,u.status,n.level,EXISTS(SELECT 1 FROM cinevjet.deposits d WHERE d.user_id=u.id AND d.status='COMPLETED') AS funded FROM network n JOIN cinevjet.users u ON u.id=n.id
    ) SELECT
      (SELECT jsonb_build_object('total',count(*),'funded',count(*) FILTER(WHERE funded),'level1',count(*) FILTER(WHERE level=1),'level2',count(*) FILTER(WHERE level=2),'level3',count(*) FILTER(WHERE level=3)) FROM members) AS stats,
      (SELECT count(*)::int FROM members WHERE (${level}=0 OR level=${level})) AS filtered_count,
      (SELECT jsonb_build_object('total',COALESCE(sum(amount),0),'f1',COALESCE(sum(amount) FILTER(WHERE level=1),0),'f2',COALESCE(sum(amount) FILTER(WHERE level=2),0),'f3',COALESCE(sum(amount) FILTER(WHERE level=3),0)) FROM ledger_credits WHERE beneficiary_id=${userId}) AS credited,
      COALESCE((SELECT jsonb_agg(h) FROM (SELECT id,level,amount,created_at FROM ledger_credits WHERE beneficiary_id=${userId} ORDER BY created_at DESC,id LIMIT 30) h),'[]'::jsonb) AS commission_history,
      COALESCE((SELECT jsonb_agg(item ORDER BY item.created_at DESC,item.id) FROM (SELECT id,display_name,created_at,status,level,funded FROM members WHERE (${level}=0 OR level=${level}) ORDER BY created_at DESC,id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}) item),'[]'::jsonb) AS members`)
      ).rows[0],
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const stats = row.stats as Record<string, number>;
  const policy = await currentReferralPolicy();
  return {
    code: identity.code,
    stats: {
      total: Number(stats.total),
      funded: Number(stats.funded),
      level1: Number(stats.level1),
      level2: Number(stats.level2),
      level3: Number(stats.level3),
    },
    credited: Object.fromEntries(
      Object.entries(row.credited as Record<string, unknown>).map(([key, value]) => [
        key,
        Number(value),
      ]),
    ),
    policy: {
      status: "ACTIVE" as const,
      percentages: policy.rates_bps.map((value) => value / 100),
    },
    commissionHistory: (row.commission_history as Record<string, unknown>[]).map((h) => ({
      id: String(h.id),
      level: Number(h.level),
      amount: Number(h.amount),
      created_at: new Date(h.created_at as string).toISOString(),
    })),
    members: (row.members as Record<string, unknown>[]).map((member) => ({
      nickname: String(member.display_name),
      member_code: String(member.id).slice(0, 8).toUpperCase(),
      level: Number(member.level),
      joined_at: new Date(member.created_at as string).toISOString(),
      active: member.status === "ACTIVE",
      funded: Boolean(member.funded),
    })),
    pagination: {
      page,
      page_size: pageSize,
      total: Number(row.filtered_count),
      pages: Math.max(1, Math.ceil(Number(row.filtered_count) / pageSize)),
      level,
    },
  };
}
export type ReferralDashboard = Awaited<ReturnType<typeof referralDashboard>>;
