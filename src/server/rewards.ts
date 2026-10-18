import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { ApiError } from "./http";
import { checkInDays, CHECK_IN_TIMEZONE } from "@/domain/rules";
import { COIN_VALUE_VND, coinBalances } from "@/domain/coins";
import type { RewardsState, RewardTier, CoinLedgerEntry } from "@/domain/models";
type Executor = Pick<ReturnType<typeof database>, "execute">;
type Row = Record<string, unknown>;
const iso = (value: unknown) => new Date(value as string).toISOString();
export async function rewardClock(db: Executor) {
  const r = (
    await db.execute(
      sql`SELECT n AS now,to_char(n AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day FROM (SELECT cinevjet.reward_now() n) t`,
    )
  ).rows[0];
  return { now: iso(r.now), day: String(r.day) };
}
export async function lockCoinWallet(db: Executor, userId: string) {
  const r = await db.execute(
    sql`SELECT w.user_id FROM cinevjet.coin_wallets w JOIN cinevjet.users u ON u.id=w.user_id WHERE w.user_id=${userId} AND u.status='ACTIVE' FOR UPDATE OF w`,
  );
  if (!r.rows.length) throw new ApiError(401, "Tài khoản không hợp lệ.");
}
const clock = rewardClock;
const lockWallet = lockCoinWallet;
async function resolve(db: Executor, userId: string, time: Awaited<ReturnType<typeof clock>>) {
  // One query avoids queueing many queries on a transaction's single pg connection.
  const r = (
    await db.execute(sql`SELECT
    (SELECT row_to_json(p) FROM cinevjet.vip_plans p WHERE reward_tier='FREE') AS basic,
    (SELECT row_to_json(v) FROM (SELECT c.*,COALESCE(s.plan_snapshot->>'name',p.name) AS name,(s.plan_snapshot IS NOT NULL OR p.active) AS active,COALESCE((s.plan_snapshot->>'reward_enabled')::boolean,p.reward_enabled) AS reward_enabled,s.status AS subscription_status,s.started_at AS subscription_start,s.expires_at FROM cinevjet.vip_checkin_cycles c JOIN cinevjet.vip_subscriptions s ON s.id=c.vip_subscription_id JOIN cinevjet.vip_plans p ON p.id=c.vip_plan_id WHERE c.user_id=${userId} ORDER BY (c.status='ACTIVE') DESC,c.created_at DESC,c.id DESC LIMIT 1) v) AS cycle,
    (SELECT row_to_json(d) FROM cinevjet.daily_checkins d WHERE user_id=${userId} AND checkin_date=${time.day}::date) AS today,
    (SELECT count(*)::int FROM cinevjet.daily_checkins WHERE user_id=${userId} AND reward_tier='FREE') AS free_count,
    (SELECT row_to_json(m) FROM (SELECT COALESCE(s.plan_snapshot->>'name',p.name) AS name,s.expires_at FROM cinevjet.vip_subscriptions s JOIN cinevjet.vip_plans p ON p.id=s.plan_id WHERE s.user_id=${userId} AND s.status='ACTIVE' AND s.started_at<=${time.now}::timestamptz AND s.expires_at>${time.now}::timestamptz AND (s.plan_snapshot IS NOT NULL OR p.active) ORDER BY s.started_at DESC,s.expires_at DESC,s.id DESC LIMIT 1) m) AS membership,
    (SELECT row_to_json(w) FROM (SELECT balance,reserved FROM cinevjet.coin_wallets WHERE user_id=${userId}) w) AS wallet,
    COALESCE((SELECT json_agg(l) FROM (SELECT * FROM cinevjet.coin_ledger WHERE user_id=${userId} ORDER BY created_at DESC,id LIMIT 50) l),'[]') AS ledger`)
  ).rows[0];
  const basic = r.basic as Row | null;
  if (!basic?.checkin_rewards) throw new ApiError(503, "Chưa có cấu hình điểm danh.");
  const c = r.cycle as Row | null;
  const today = r.today as Row | null;
  const membership = r.membership as Row | null;
  let status = String(c?.status || "");
  if (c?.status === "ACTIVE") {
    if (c.subscription_status !== "ACTIVE" || !c.active || !c.reward_enabled) status = "CANCELLED";
    else if (iso(c.expires_at) <= time.now || iso(c.subscription_start) > time.now)
      status = "EXPIRED";
  }
  const vip = c && status === "ACTIVE";
  // Show the completed VIP schedule on its last claim day, then resolve Free the next day.
  const completedToday = c && status === "COMPLETED" && today?.vip_checkin_cycle_id === c.id;
  const useCycle = vip || completedToday;
  const rewards = (useCycle ? c.reward_schedule : basic.checkin_rewards) as number[];
  const count = Number(r.free_count);
  const freeDay = count % 7 === 0 && count > 0 && today?.reward_tier === "FREE" ? 7 : count % 7;
  const claimed = useCycle ? Number(c.current_day) : freeDay;
  return {
    tier: (useCycle ? c.tier : "FREE") as RewardTier,
    name: useCycle ? String(c.name) : String(basic.name),
    rewards,
    claimed,
    today,
    enabled: Boolean(useCycle || (basic.active && basic.reward_enabled)),
    cycle: c
      ? {
          id: String(c.id),
          tier: c.tier as RewardTier,
          current_day: Number(c.current_day),
          status: status as NonNullable<RewardsState["cycle"]>["status"],
        }
      : null,
    wallet: coinBalances((r.wallet as Row)?.balance ?? 0, (r.wallet as Row)?.reserved ?? 0),
    ledger: r.ledger as Row[],
    membership: membership
      ? { name: String(membership.name), expires_at: iso(membership.expires_at) }
      : null,
  };
}
function stateSnapshot(
  state: Awaited<ReturnType<typeof resolve>>,
  userId: string,
  time: Awaited<ReturnType<typeof clock>>,
): RewardsState {
  return {
    wallet: {
      id: userId,
      user_id: userId,
      asset: "COIN",
      ...state.wallet,
    },
    days: checkInDays(state.claimed, Boolean(state.today) || !state.enabled, state.rewards),
    ledger: state.ledger.map((r) => ({
      id: String(r.id),
      wallet_id: userId,
      amount: Number(r.amount),
      reason: r.type as CoinLedgerEntry["reason"],
      idempotency_key: String(r.reference_id),
      created_at: iso(r.created_at),
    })),
    calendar_date: time.day,
    timezone: CHECK_IN_TIMEZONE,
    membership: state.membership,
    reward_tier: state.tier,
    reward_name: state.name,
    cycle: state.cycle,
    total: state.rewards.reduce((sum, reward) => sum + reward, 0),
    enabled: state.enabled,
    claimed_today: Boolean(state.today),
    coin_value_vnd: COIN_VALUE_VND,
  };
}
async function snapshot(db: Executor, userId: string, time: Awaited<ReturnType<typeof clock>>) {
  return stateSnapshot(await resolve(db, userId, time), userId, time);
}
export async function rewardsSnapshot(userId: string): Promise<RewardsState> {
  // A coherent read-only snapshot; reading /rewards never activates or credits anything.
  return database().transaction(async (tx) => snapshot(tx, userId, await clock(tx)), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}
export async function claimDailyCheckIn(userId: string): Promise<RewardsState> {
  return database().transaction(async (tx) => {
    await lockWallet(tx, userId);
    const time = await clock(tx);
    const state = await resolve(tx, userId, time);
    if (state.today) return stateSnapshot(state, userId, time); // Date is the idempotency key, not a client token.
    if (!state.enabled) throw new ApiError(403, "Điểm danh đang tạm dừng.");
    if (state.cycle && ["EXPIRED", "CANCELLED"].includes(state.cycle.status))
      await tx.execute(
        sql`UPDATE cinevjet.vip_checkin_cycles SET status=${state.cycle.status} WHERE id=${state.cycle.id} AND status='ACTIVE'`,
      );
    const cycleId = state.tier === "FREE" ? null : state.cycle?.id;
    const day = state.claimed + 1;
    const reward = state.rewards[day - 1];
    if (!Number.isSafeInteger(reward) || reward <= 0 || day > 7)
      throw new ApiError(409, "Chu kỳ không hợp lệ.");
    const id = randomUUID();
    await tx.execute(
      sql`INSERT INTO cinevjet.daily_checkins(id,user_id,checkin_date,reward,cycle_day,reward_tier,vip_checkin_cycle_id,created_at) VALUES(${id},${userId},${time.day}::date,${reward},${day},${state.tier},${cycleId},${time.now}::timestamptz)`,
    );
    await tx.execute(
      sql`UPDATE cinevjet.coin_wallets SET balance=balance+${reward}::bigint WHERE user_id=${userId}`,
    );
    await tx.execute(
      sql`INSERT INTO cinevjet.coin_ledger(id,user_id,amount,type,reference_type,reference_id,created_at) VALUES(${randomUUID()},${userId},${reward},${"DAILY_CHECKIN_" + state.tier},'DAILY_CHECKIN',${id},${time.now}::timestamptz)`,
    );
    if (cycleId)
      await tx.execute(
        sql`UPDATE cinevjet.vip_checkin_cycles SET current_day=${day},status=${day === 7 ? "COMPLETED" : "ACTIVE"},completed_at=${day === 7 ? time.now : null}::timestamptz WHERE id=${cycleId}`,
      );
    return snapshot(tx, userId, time);
  });
}
// Internal integration hook for a verified purchase/renewal/upgrade. No HTTP endpoint exposes it.
export async function openVipCheckinCycle(
  subscriptionId: string,
  purchaseReference: string,
): Promise<string> {
  return database().transaction((tx) =>
    openVipCheckinCycleInTransaction(tx, subscriptionId, purchaseReference),
  );
}
export async function openVipCheckinCycleInTransaction(
  tx: Executor,
  subscriptionId: string,
  purchaseReference: string,
  contract?: { tier: string; rewards: number[]; price: number },
): Promise<string> {
  const result = await tx.execute(
    sql`SELECT s.*,p.reward_tier,p.checkin_rewards,p.price,p.active,p.reward_enabled FROM cinevjet.vip_subscriptions s JOIN cinevjet.vip_plans p ON p.id=s.plan_id WHERE s.id=${subscriptionId}`,
  );
  const s = result.rows[0];
  if (!s || !s.activation_verified_at || s.activation_reference !== purchaseReference)
    throw new ApiError(403, "Activation chưa được xác minh.");
  await lockWallet(tx, String(s.user_id));
  const existing = await tx.execute(
    sql`SELECT id FROM cinevjet.vip_checkin_cycles WHERE vip_subscription_id=${subscriptionId} AND purchase_reference=${purchaseReference}`,
  );
  if (existing.rows[0]) return String(existing.rows[0].id);
  const time = await clock(tx);
  if (
    s.status !== "ACTIVE" ||
    !s.active ||
    !s.reward_enabled ||
    !s.reward_tier ||
    s.reward_tier === "FREE" ||
    !s.checkin_rewards ||
    iso(s.started_at) > time.now ||
    iso(s.expires_at) <= time.now
  )
    throw new ApiError(403, "Gói VIP không còn hợp lệ.");
  await tx.execute(
    sql`UPDATE cinevjet.vip_checkin_cycles SET status='CANCELLED' WHERE user_id=${s.user_id} AND status='ACTIVE'`,
  );
  const id = randomUUID();
  await tx.execute(
    sql`INSERT INTO cinevjet.vip_checkin_cycles(id,user_id,vip_subscription_id,vip_plan_id,purchase_reference,tier,reward_schedule,plan_price,started_at,created_at) VALUES(${id},${s.user_id},${subscriptionId},${s.plan_id},${purchaseReference},${contract?.tier ?? s.reward_tier},ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(contract?.rewards ?? s.checkin_rewards)}::jsonb)::integer),${contract?.price ?? s.price},${time.now}::timestamptz,${time.now}::timestamptz)`,
  );
  return id;
}
export async function vipMembershipName(userId?: string): Promise<string> {
  if (!userId) return "Free";
  const r = await database().execute(
    sql`SELECT COALESCE(s.plan_snapshot->>'name',p.name) AS name FROM cinevjet.vip_subscriptions s JOIN cinevjet.vip_plans p ON p.id=s.plan_id WHERE s.user_id=${userId} AND s.status='ACTIVE' AND s.started_at<=cinevjet.reward_now() AND s.expires_at>cinevjet.reward_now() AND (s.plan_snapshot IS NOT NULL OR p.active) ORDER BY s.started_at DESC,s.expires_at DESC,s.id DESC LIMIT 1`,
  );
  return String(r.rows[0]?.name || "Free");
}
