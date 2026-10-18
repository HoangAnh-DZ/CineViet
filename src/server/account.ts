import "server-only";
import { coinBalances } from "@/domain/coins";
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { findMovie, mapMovie } from "./catalog";
import { ApiError } from "./http";
import { favoriteSchema, progressSchema } from "./validation";
import type { Movie, VipPlan, VipRewardPlan, WatchProgress, Entitlement } from "@/domain/models";
import { vipDescription } from "@/domain/product-policy";
export async function favoriteMovies(userId: string): Promise<Movie[]> {
  const result = await database()
    .execute(sql`SELECT m.*,COALESCE((SELECT json_agg(g.name) FROM cinevjet.movie_genres mg JOIN cinevjet.genres g ON g.id=mg.genre_id WHERE mg.movie_id=m.id),'[]') AS genres
    FROM cinevjet.favorites f JOIN cinevjet.movies m ON m.id=f.movie_id WHERE f.user_id=${userId} AND m.status='PUBLISHED' AND NOT m.is_demo ORDER BY f.created_at DESC,m.id LIMIT 100`);
  return result.rows.map(mapMovie);
}
export async function history(userId: string): Promise<WatchProgress[]> {
  const result = await database().execute(sql`SELECT w.*,row_to_json(m) AS movie,e.episode_number,
    COALESCE((SELECT json_agg(g.name) FROM cinevjet.movie_genres mg JOIN cinevjet.genres g ON g.id=mg.genre_id WHERE mg.movie_id=m.id),'[]') AS genres,
    (SELECT count(*)::int FROM cinevjet.episodes ep WHERE ep.movie_id=m.id AND ep.status='PUBLISHED') AS episode_count
    FROM cinevjet.watch_history w JOIN cinevjet.movies m ON m.id=w.movie_id LEFT JOIN cinevjet.episodes e ON e.id=w.episode_id
    WHERE w.user_id=${userId} AND m.status='PUBLISHED' AND NOT m.is_demo AND (w.episode_id IS NULL OR e.status='PUBLISHED') ORDER BY w.updated_at DESC,w.id LIMIT 100`);
  return result.rows.map((r) => ({
    user_id: userId,
    movie_id: String(r.movie_id),
    episode_id: r.episode_id ? String(r.episode_id) : undefined,
    position_seconds: Number(r.position_seconds),
    duration_seconds: Number(r.duration_seconds),
    updated_at: new Date(r.updated_at as string).toISOString(),
    completed: Boolean(r.completed),
    episode_number: r.episode_number ? Number(r.episode_number) : undefined,
    movie: mapMovie({
      ...(r.movie as Record<string, unknown>),
      genres: r.genres,
      episode_count: r.episode_count,
    }),
  }));
}
export async function setFavorite(userId: string, input: unknown) {
  const data = favoriteSchema.parse(input);
  if (!(await findMovie(data.movie_id))) throw new ApiError(404, "Phim không tồn tại.");
  if (data.active)
    await database().execute(
      sql`INSERT INTO cinevjet.favorites(user_id,movie_id) VALUES(${userId},${data.movie_id}) ON CONFLICT DO NOTHING`,
    );
  else
    await database().execute(
      sql`DELETE FROM cinevjet.favorites WHERE user_id=${userId} AND movie_id=${data.movie_id}`,
    );
  return { active: data.active };
}
export async function saveWatchProgress(userId: string, input: unknown) {
  const data = progressSchema.parse(input);
  const movie = await findMovie(data.movie_id);
  if (!movie) throw new ApiError(404, "Phim không tồn tại.");
  if (movie.vip_required && !(await entitlements(userId)).includes("VIP_MOVIES"))
    throw new ApiError(403, "Phim yêu cầu VIP.");
  if ((movie.type === "SERIES" && !data.episode_id) || (movie.type === "MOVIE" && data.episode_id))
    throw new ApiError(400, "Tập phim không hợp lệ.");
  let expectedDuration = movie.duration_seconds || movie.duration * 60;
  if (data.episode_id) {
    const result = await database().execute(
      sql`SELECT id,duration_seconds FROM cinevjet.episodes WHERE id=${data.episode_id} AND movie_id=${movie.id} AND status='PUBLISHED'`,
    );
    if (!result.rows.length) throw new ApiError(404, "Tập phim không tồn tại.");
    expectedDuration = Number(result.rows[0].duration_seconds);
  }
  if (data.duration_seconds > expectedDuration + 300)
    throw new ApiError(400, "Thời lượng không phù hợp với phim.");
  const duration = Math.ceil(data.duration_seconds),
    position = Math.min(duration, Math.floor(data.position_seconds));
  await database()
    .execute(sql`INSERT INTO cinevjet.watch_history(id,user_id,movie_id,episode_id,position_seconds,duration_seconds,completed)
    VALUES(${randomUUID()},${userId},${movie.id},${data.episode_id || null},${position},${duration},${position >= duration * 0.95})
    ON CONFLICT(user_id,movie_id,episode_id) DO UPDATE SET position_seconds=excluded.position_seconds,duration_seconds=excluded.duration_seconds,completed=excluded.completed,updated_at=now()`);
  return { saved: true };
}
export async function vipPlans(): Promise<VipRewardPlan[]> {
  const result = await database().execute(
    sql`SELECT * FROM cinevjet.vip_plans WHERE active AND purchase_enabled AND reward_tier IS NOT NULL ORDER BY price,id`,
  );
  return result.rows.map((r) => ({
    id: r.id as VipPlan["id"],
    name: String(r.name),
    price: Number(r.price),
    duration_days: Number(r.duration_days),
    benefits: r.benefits_json as Entitlement[],
    active: true,
    discount: Number(r.discount),
    tier: r.reward_tier as VipRewardPlan["tier"],
    rewards: r.checkin_rewards as number[],
    mission_count: Number(r.mission_count || 0),
    mission_reward: Number(r.mission_reward || 0),
    commission_total:
      Number(r.mission_count || 0) > 0
        ? Number(r.mission_count || 0) * Number(r.mission_reward || 0) * Number(r.duration_days)
        : (r.checkin_rewards as number[]).reduce((sum, value) => sum + value, 0),
    ...vipDescription(
      Number(r.price),
      Number(r.additional_amount || 0),
      Number(r.mission_count || 0),
      Number(r.duration_days),
    ),
    total:
      Number(r.mission_count || 0) > 0
        ? Number(r.mission_count || 0) * Number(r.mission_reward || 0) * Number(r.duration_days)
        : (r.checkin_rewards as number[]).reduce((sum, value) => sum + value, 0),
    difference: Number(r.additional_amount || 0),
  }));
}
export async function entitlements(userId?: string): Promise<Entitlement[]> {
  if (!userId) return [];
  const result = await database()
    .execute(sql`SELECT COALESCE(s.plan_snapshot->'benefits_json',p.benefits_json) AS benefits_json FROM cinevjet.vip_subscriptions s JOIN cinevjet.vip_plans p ON p.id=s.plan_id
    WHERE s.user_id=${userId} AND s.status='ACTIVE' AND s.started_at<=now() AND s.expires_at>now() AND (s.plan_snapshot IS NOT NULL OR p.active) ORDER BY s.expires_at DESC LIMIT 1`);
  return (result.rows[0]?.benefits_json as Entitlement[] | undefined) || [];
}
export async function balances(userId: string) {
  const [cash, coins] = await Promise.all([
    database().execute(sql`SELECT balance,reserved FROM cinevjet.wallets WHERE user_id=${userId}`),
    database().execute(
      sql`SELECT balance,reserved FROM cinevjet.coin_wallets WHERE user_id=${userId}`,
    ),
  ]);
  return {
    cash: Number(cash.rows[0]?.balance || 0),
    available: Number(cash.rows[0]?.balance || 0) - Number(cash.rows[0]?.reserved || 0),
    coins: coinBalances(coins.rows[0]?.balance ?? 0, coins.rows[0]?.reserved ?? 0).available,
    coins_total: Number(coins.rows[0]?.balance || 0),
    coins_reserved: Number(coins.rows[0]?.reserved || 0),
  };
}
export async function walletLedger(userId: string) {
  const result = await database().execute(
    sql`SELECT id,user_id,amount,type AS kind,'COMPLETED' AS status,created_at FROM cinevjet.wallet_ledger WHERE user_id=${userId} ORDER BY created_at DESC,id LIMIT 50`,
  );
  return result.rows.map((r) => ({
    ...r,
    wallet_id: userId,
    amount: Number(r.amount),
    created_at: new Date(r.created_at as string).toISOString(),
  }));
}
export async function coinLedger(userId: string) {
  const result = await database().execute(
    sql`SELECT id,amount,type AS reason,reference_id AS idempotency_key,created_at FROM cinevjet.coin_ledger WHERE user_id=${userId} ORDER BY created_at DESC,id LIMIT 50`,
  );
  return result.rows.map((r) => ({
    ...r,
    wallet_id: userId,
    amount: Number(r.amount),
    created_at: new Date(r.created_at as string).toISOString(),
  }));
}
export async function referralSummary(userId: string) {
  return database().transaction(async (tx) => {
    let row = (
      await tx.execute(sql`SELECT referral_code FROM cinevjet.users WHERE id=${userId} FOR UPDATE`)
    ).rows[0];
    if (!row) throw new ApiError(404, "Tài khoản không tồn tại.");
    let code = row.referral_code
      ? String(row.referral_code)
      : `CVJ-${randomBytes(5).toString("hex").toUpperCase()}`;
    if (!row.referral_code) {
      await tx.execute(
        sql`UPDATE cinevjet.users SET referral_code=${code},updated_at=now() WHERE id=${userId}`,
      );
    }
    const stats = (
      await tx.execute(
        sql`SELECT (SELECT count(*)::int FROM cinevjet.users WHERE referred_by=${userId} AND id<>${userId}) referred,COALESCE(sum(amount),0) AS earned FROM cinevjet.referral_commissions WHERE referrer_id=${userId}`,
      )
    ).rows[0];
    return {
      code,
      referred: Number(stats?.referred || 0),
      earned: Number(stats?.earned || 0),
      percent: 10,
    };
  });
}
