import "server-only";
import { sql } from "drizzle-orm";
import { database } from "./db";
import { digest } from "./auth-core";
import { assertAdmin } from "./admin-core";

const signals = [
  "session_start",
  "source_switch",
  "session_conflict",
  "invalid_nonce",
  "replay_mismatch",
  "session_expired",
  "progress_anomaly",
  "retry",
  "mission_claim",
] as const;
export type RewardRiskSignal = (typeof signals)[number];
function keys(userId: string) {
  const actor = digest(`reward-risk:v1:${userId}`);
  return signals.map((signal) => `risk:v1:${actor}:${signal}`);
}
// Nine reusable counters per account, never a per-heartbeat/event log. No IP,
// fingerprint, source, position, bank data or session/nonce is retained here.
// Counts expire after 24h; the existing cron also scrubs expired values/times.
export async function recordRewardRisk(userId: string, events: RewardRiskSignal[]) {
  if (!events.length) return;
  try {
    const allKeys = keys(userId);
    const selected = [...new Set(events)].map((event) => allKeys[signals.indexOf(event)]);
    if (selected.some((key) => !key)) return;
    const result = await database()
      .execute(sql`INSERT INTO cinevjet.auth_limits(key,attempts,window_start)
      SELECT key,1,now() FROM jsonb_array_elements_text(${JSON.stringify(selected)}::jsonb) AS t(key) ORDER BY key
      ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN cinevjet.auth_limits.window_start<=now()-interval '24 hours' THEN 1 ELSE LEAST(65535,cinevjet.auth_limits.attempts+1) END,
      window_start=CASE WHEN cinevjet.auth_limits.window_start<=now()-interval '24 hours' THEN now() ELSE cinevjet.auth_limits.window_start END
      RETURNING key,attempts`);
    for (const row of result.rows) {
      const signal = signals[allKeys.indexOf(String(row.key))];
      const count = Number(row.attempts);
      if (
        !["session_start", "source_switch", "retry", "mission_claim"].includes(signal) &&
        (count & (count - 1)) === 0
      )
        console.warn("Reward risk signal", { signal, count });
    }
  } catch {
    // Observability must never revoke earned rewards or change a committed reply.
    console.error("Reward risk counters unavailable.");
  }
}
export async function rewardRiskSummary(actor: string, userId: string) {
  await assertAdmin(actor);
  const allKeys = keys(userId);
  const result = await database().execute(sql`SELECT key,attempts FROM cinevjet.auth_limits
    WHERE key IN (SELECT jsonb_array_elements_text(${JSON.stringify(allKeys)}::jsonb))
    AND window_start>now()-interval '24 hours'`);
  const counts = Object.fromEntries(
    signals.map((signal, i) => [
      signal,
      Number(result.rows.find((row) => row.key === allKeys[i])?.attempts || 0),
    ]),
  );
  const invalid = counts.invalid_nonce + counts.replay_mismatch;
  const unusual = counts.progress_anomaly + counts.session_conflict;
  // Signals warrant review, never automatic suspension/confiscation.
  const level =
    invalid >= 30 && unusual >= 10
      ? "HIGH_RISK"
      : invalid >= 10 || unusual >= 10 || counts.session_start >= 120 || counts.source_switch >= 60
        ? "SUSPICIOUS"
        : "NORMAL";
  return { level, window_hours: 24, counts, automated_penalty: false };
}
export async function scrubRewardRiskCounters() {
  // Bounded work using existing UPDATE rights; leaves only inert pseudonymous
  // keys, not old counts/timestamps. Never touches auth/registration limits.
  const result = await database().execute(sql`WITH expired AS (
    SELECT key FROM cinevjet.auth_limits WHERE key>='risk:v1:' AND key<'risk:v1;' AND attempts>0
    AND window_start<=now()-interval '24 hours' ORDER BY key LIMIT 500
  ) UPDATE cinevjet.auth_limits a SET attempts=0,window_start='epoch'::timestamptz
    FROM expired e WHERE a.key=e.key AND a.window_start<=now()-interval '24 hours' RETURNING a.key`);
  return result.rows.length;
}
