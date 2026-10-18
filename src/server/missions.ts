import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "./db";
import { ApiError } from "./http";
import { rewardClock, lockCoinWallet } from "./rewards";
import { verifiedWatchMs, watchDaySegments, WATCH_LEASE_MS } from "@/domain/watch-rewards";
import type { DailyMissionsState } from "@/domain/models";
type Executor = Pick<ReturnType<typeof database>, "execute">;
type Clock = Awaited<ReturnType<typeof rewardClock>>;
async function snapshot(db: Executor, userId: string, time: Clock): Promise<DailyMissionsState> {
  const plan = (
    await db.execute(sql`SELECT COALESCE(s.plan_snapshot->>'reward_tier',p.reward_tier) AS reward_tier,
      COALESCE((s.plan_snapshot->>'mission_count')::int,p.mission_count) AS mission_count,
      COALESCE((s.plan_snapshot->>'mission_reward')::bigint,p.mission_reward) AS mission_reward
      FROM cinevjet.vip_subscriptions s JOIN cinevjet.vip_plans p ON p.id=s.plan_id
      WHERE s.user_id=${userId} AND s.status='ACTIVE' AND s.started_at<=${time.now}::timestamptz
        AND s.expires_at>${time.now}::timestamptz AND (s.plan_snapshot IS NOT NULL OR p.active)
        AND COALESCE((s.plan_snapshot->>'mission_count')::int,p.mission_count)>0
      ORDER BY s.expires_at DESC LIMIT 1`)
  ).rows[0];
  if (!plan) return { calendar_date: time.day, timezone: "Asia/Ho_Chi_Minh", missions: [] };
  const tier = String(plan.reward_tier),
    count = Math.min(100, Number(plan.mission_count));
  const progress = (
    await db.execute(sql`SELECT COALESCE(watched_ms,0) AS watched_ms
      FROM cinevjet.daily_watch_progress WHERE user_id=${userId} AND calendar_date=${time.day}::date`)
  ).rows[0];
  const watchedMs = Number(progress?.watched_ms || 0);
  const rows = (
    await db.execute(sql`SELECT m.id,m.target_seconds,c.id AS claim_id
      FROM cinevjet.daily_missions m
      LEFT JOIN cinevjet.daily_mission_claims c ON c.user_id=${userId} AND c.mission_id=m.id AND c.calendar_date=${time.day}::date
      WHERE m.enabled AND m.id LIKE ${tier + "_TASK_%"} ORDER BY m.id LIMIT ${count}`)
  ).rows;
  return {
    calendar_date: time.day,
    timezone: "Asia/Ho_Chi_Minh",
    missions: rows.map((r, index) => {
      const target = Number(r.target_seconds),
        required = target * (index + 1);
      return {
        id: String(r.id),
        // Each mission uses the same cumulative playback clock. This keeps
        // the UI honest: task 1 is 0/30, task 2 is 0/60, task 3 is 0/90...
        target_seconds: required,
        reward: Number(plan.mission_reward),
        watched_seconds: Math.min(required, Math.max(0, Math.floor(watchedMs / 1000))),
        status: r.claim_id ? "CLAIMED" : watchedMs >= required * 1000 ? "AVAILABLE" : "IN_PROGRESS",
      };
    }),
  };
}
export async function missionsSnapshot(userId: string) {
  return database().transaction(async (tx) => snapshot(tx, userId, await rewardClock(tx)), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}
const claimInput = z
  .object({ mission_id: z.string().min(1).max(64), calendar_date: z.iso.date() })
  .strict();
export async function claimMission(userId: string, input: unknown) {
  const data = claimInput.parse(input);
  return database().transaction(async (tx) => {
    await lockCoinWallet(tx, userId);
    const time = await rewardClock(tx);
    if (time.day !== data.calendar_date)
      throw new ApiError(409, "Đã sang ngày mới. Vui lòng tải lại nhiệm vụ.");
    const state = await snapshot(tx, userId, time),
      mission = state.missions.find((m) => m.id === data.mission_id);
    if (!mission) throw new ApiError(404, "Nhiệm vụ không khả dụng.");
    if (mission.status === "IN_PROGRESS") throw new ApiError(409, "Chưa đủ thời gian xem hợp lệ.");
    if (mission.status === "CLAIMED") return state;
    const id = randomUUID();
    await tx.execute(sql`INSERT INTO cinevjet.daily_mission_claims(id,user_id,mission_id,calendar_date,reward,created_at)
      VALUES(${id},${userId},${mission.id},${time.day}::date,${mission.reward},${time.now}::timestamptz)`);
    await tx.execute(
      sql`UPDATE cinevjet.coin_wallets SET balance=balance+${mission.reward}::bigint WHERE user_id=${userId}`,
    );
    await tx.execute(sql`INSERT INTO cinevjet.coin_ledger(id,user_id,amount,type,reference_type,reference_id,created_at)
      VALUES(${randomUUID()},${userId},${mission.reward},'MISSION','DAILY_MISSION',${id},${time.now}::timestamptz)`);
    return snapshot(tx, userId, time);
  });
}
const startInput = z
  .object({
    source_id: z.string().min(1).max(128),
    position: z.number().finite().nonnegative().max(86400),
  })
  .strict();
const beatInput = z
  .object({
    session_id: z.uuid(),
    nonce: z.uuid(),
    position: z.number().finite().nonnegative().max(86400),
    playing: z.boolean(),
  })
  .strict();
async function authorizedSource(db: Executor, userId: string, sourceId: string, now: string) {
  const source = (
    await db.execute(sql`SELECT COALESCE(e.duration_seconds,m.duration_minutes*60)+300 AS max_position
    FROM cinevjet.video_sources v JOIN cinevjet.movies m ON m.id=v.movie_id
    LEFT JOIN cinevjet.episodes e ON e.id=v.episode_id AND e.movie_id=m.id
    WHERE v.id=${sourceId} AND v.is_active AND v.format='MP4' AND m.status='PUBLISHED'
    AND ((m.type='MOVIE' AND v.episode_id IS NULL) OR (m.type='SERIES' AND e.status='PUBLISHED'))
    AND (NOT m.vip_required OR EXISTS(SELECT 1 FROM cinevjet.vip_subscriptions s JOIN cinevjet.vip_plans p ON p.id=s.plan_id
      WHERE s.user_id=${userId} AND s.status='ACTIVE' AND (s.plan_snapshot IS NOT NULL OR p.active) AND s.started_at<=${now}::timestamptz
      AND s.expires_at>${now}::timestamptz AND COALESCE(s.plan_snapshot->'benefits_json',p.benefits_json) @> '["VIP_MOVIES"]'::jsonb))`)
  ).rows[0];
  if (!source) throw new ApiError(403, "Nguồn phát không đủ điều kiện nhận xu.");
  return Number(source.max_position);
}
export async function startRewardWatch(userId: string, input: unknown) {
  const data = startInput.parse(input);
  return database().transaction(async (tx) => {
    await lockCoinWallet(tx, userId);
    const time = await rewardClock(tx),
      max = await authorizedSource(tx, userId, data.source_id, time.now);
    if (data.position > max) throw new ApiError(400, "Vị trí phát không hợp lệ.");
    const previous = (
      await tx.execute(
        sql`SELECT playing,last_at FROM cinevjet.reward_watch_sessions WHERE user_id=${userId}`,
      )
    ).rows[0];
    if (
      previous?.playing &&
      Date.parse(time.now) - new Date(previous.last_at as string).getTime() < WATCH_LEASE_MS
    )
      throw new ApiError(409, "Thời gian xem đang được ghi nhận ở một tab khác.");
    const id = randomUUID(),
      nonce = randomUUID();
    await tx.execute(sql`INSERT INTO cinevjet.reward_watch_sessions(user_id,id,source_id,nonce,last_at,position_seconds,playing)
      VALUES(${userId},${id}::uuid,${data.source_id},${nonce}::uuid,${time.now}::timestamptz,${data.position},true)
      ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,source_id=excluded.source_id,nonce=excluded.nonce,
      previous_nonce=NULL,request_hash=NULL,last_at=excluded.last_at,position_seconds=excluded.position_seconds,playing=true`);
    return { session_id: id, nonce };
  });
}
export async function heartbeatRewardWatch(userId: string, input: unknown) {
  const data = beatInput.parse(input),
    digest = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return database().transaction(async (tx) => {
    await lockCoinWallet(tx, userId);
    const time = await rewardClock(tx);
    const s = (
      await tx.execute(
        sql`SELECT * FROM cinevjet.reward_watch_sessions WHERE user_id=${userId} AND id=${data.session_id}::uuid`,
      )
    ).rows[0];
    if (!s) throw new ApiError(409, "Phiên theo dõi đã kết thúc.");
    if (s.previous_nonce === data.nonce && s.request_hash === digest)
      return { session_id: String(s.id), nonce: String(s.nonce) };
    if (s.nonce !== data.nonce) throw new ApiError(409, "Heartbeat không hợp lệ.");
    const max = await authorizedSource(tx, userId, String(s.source_id), time.now);
    const start = new Date(s.last_at as string).getTime(),
      end = Date.parse(time.now);
    const credit = verifiedWatchMs(
      { at: start, position: Number(s.position_seconds), playing: Boolean(s.playing) },
      { at: end, position: data.position, playing: data.playing },
      max,
    );
    for (const segment of watchDaySegments(start, end, credit))
      await tx.execute(sql`INSERT INTO cinevjet.daily_watch_progress(user_id,calendar_date,watched_ms)
        VALUES(${userId},${segment.day}::date,${segment.ms}) ON CONFLICT(user_id,calendar_date)
        DO UPDATE SET watched_ms=LEAST(86400000,cinevjet.daily_watch_progress.watched_ms+excluded.watched_ms)`);
    const nonce = randomUUID();
    await tx.execute(sql`UPDATE cinevjet.reward_watch_sessions SET previous_nonce=nonce,nonce=${nonce}::uuid,
      request_hash=${digest},last_at=${time.now}::timestamptz,position_seconds=${data.position},playing=${data.playing && data.position <= max}
      WHERE user_id=${userId}`);
    return { session_id: String(s.id), nonce };
  });
}
