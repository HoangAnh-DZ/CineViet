import "server-only";
import { sql } from "drizzle-orm";
import { database } from "@/server/db";
import { assertAdmin } from "@/server/admin-core";
import { adminMovies, adminUsers, type AdminUser } from "@/server/dashboard";
import { history, coinLedger } from "@/server/account";
import { ApiError } from "@/server/http";
import { rewardRiskSummary } from "@/server/reward-risk";
// Read-only projections for dashboard columns. Existing repositories and mutations stay unchanged.
export async function moviePresentation(actor: string, q = "", type = "", status = "", page = 1) {
  const batch = await adminMovies(actor, q, type, status, page);
  if (!batch.items.length) return { ...batch, items: [] };
  const r = await database().execute(
    sql`SELECT movie_id,count(*)::int AS episodes FROM cinevjet.episodes WHERE movie_id IN (${sql.join(
      batch.items.map((m) => sql`${m.id}`),
      sql`,`,
    )}) GROUP BY movie_id`,
  );
  const counts = new Map(r.rows.map((r) => [String(r.movie_id), Number(r.episodes)]));
  return { ...batch, items: batch.items.map((m) => ({ ...m, episodes: counts.get(m.id) || 0 })) };
}
export type PresentedMovie = Awaited<ReturnType<typeof moviePresentation>>["items"][number];
export type PresentedUser = AdminUser & { avatar_url: string | null; coins: number; vip: string };
async function memberColumns(ids: string[]) {
  if (!ids.length)
    return new Map<string, { avatar_url: string | null; coins: number; vip: string }>();
  const r = await database().execute(
    sql`SELECT u.id,u.avatar_url,COALESCE(c.balance,0) AS coins,COALESCE(v.name,'Free') AS vip FROM cinevjet.users u LEFT JOIN cinevjet.coin_wallets c ON c.user_id=u.id LEFT JOIN LATERAL (SELECT p.name FROM cinevjet.vip_subscriptions s JOIN cinevjet.vip_plans p ON p.id=s.plan_id WHERE s.user_id=u.id AND s.status='ACTIVE' AND s.started_at<=now() AND s.expires_at>now() AND p.active ORDER BY s.expires_at DESC LIMIT 1) v ON true WHERE u.id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`,`,
    )})`,
  );
  return new Map(
    r.rows.map((r) => [
      String(r.id),
      {
        avatar_url: r.avatar_url ? String(r.avatar_url) : null,
        coins: Number(r.coins),
        vip: String(r.vip),
      },
    ]),
  );
}
export async function userPresentation(actor: string, q = ""): Promise<PresentedUser[]> {
  const users = await adminUsers(actor, q),
    columns = await memberColumns(users.map((u) => u.id));
  return users.map((u) => ({ ...u, ...columns.get(u.id)! }));
}
export async function memberActivity(actor: string, id: string) {
  await assertAdmin(actor);
  const exists = await database().execute(sql`SELECT id FROM cinevjet.users WHERE id=${id}`);
  if (!exists.rows.length) throw new ApiError(404, "Thành viên không tồn tại.");
  const [watch, rewards, transactions, money, rewardRisk] = await Promise.all([
    history(id),
    coinLedger(id),
    database().execute(
      sql`SELECT id,amount,status,created_at,kind FROM (SELECT id,user_id,amount,status,created_at,'Nạp VND' AS kind FROM cinevjet.deposits UNION ALL SELECT id,user_id,amount,status,created_at,CASE WHEN source_asset='COIN' THEN 'Đổi thưởng' ELSE 'Rút VND' END FROM cinevjet.withdrawals UNION ALL SELECT id,user_id,amount,status,created_at,'Mua VIP' FROM cinevjet.vip_purchase_requests) t WHERE user_id=${id} ORDER BY created_at DESC,id LIMIT 30`,
    ),
    database().execute(
      sql`SELECT w.balance,w.reserved,COALESCE(c.balance,0) AS coins,COALESCE(c.reserved,0) AS reserved_coins,(SELECT COALESCE(sum(amount),0) FROM cinevjet.deposits WHERE user_id=${id} AND status='COMPLETED') AS deposited,(SELECT COALESCE(sum(amount),0) FROM cinevjet.withdrawals WHERE user_id=${id} AND status='COMPLETED' AND source_asset='VND') AS withdrawn,(SELECT count(*) FROM cinevjet.deposits WHERE user_id=${id} AND status='PENDING') AS pending_deposits,(SELECT count(*) FROM cinevjet.withdrawals WHERE user_id=${id} AND status='PENDING' AND source_asset='VND') AS pending_withdrawals,(SELECT count(*) FROM cinevjet.withdrawals WHERE user_id=${id} AND status='PENDING' AND source_asset='COIN') AS pending_redemptions FROM cinevjet.wallets w LEFT JOIN cinevjet.coin_wallets c ON c.user_id=w.user_id WHERE w.user_id=${id}`,
    ),
    rewardRiskSummary(actor, id),
  ]);
  return {
    reward_risk: rewardRisk,
    money: {
      balance: Number(money.rows[0]?.balance || 0),
      reserved: Number(money.rows[0]?.reserved || 0),
      available: Number(money.rows[0]?.balance || 0) - Number(money.rows[0]?.reserved || 0),
      coins: Number(money.rows[0]?.coins || 0),
      reserved_coins: Number(money.rows[0]?.reserved_coins || 0),
      pending_redemptions: Number(money.rows[0]?.pending_redemptions || 0),
      deposited: Number(money.rows[0]?.deposited || 0),
      withdrawn: Number(money.rows[0]?.withdrawn || 0),
      pending_deposits: Number(money.rows[0]?.pending_deposits || 0),
      pending_withdrawals: Number(money.rows[0]?.pending_withdrawals || 0),
    },
    watch: watch.slice(0, 10).map((w) => ({
      title: w.movie?.title || "Phim",
      episode: w.episode_number || null,
      position: w.position_seconds,
      duration: w.duration_seconds,
      date: w.updated_at,
    })),
    rewards: rewards.slice(0, 10).map((r) => {
      const row = r as typeof r & { id: string; reason: string };
      return {
        id: String(row.id),
        amount: row.amount,
        reason: String(row.reason),
        date: row.created_at,
      };
    }),
    transactions: transactions.rows.map((r) => ({
      id: String(r.id),
      amount: Number(r.amount),
      status: String(r.status),
      kind: String(r.kind),
      date: new Date(r.created_at as string).toISOString(),
    })),
  };
}
export type MemberActivity = Awaited<ReturnType<typeof memberActivity>>;
