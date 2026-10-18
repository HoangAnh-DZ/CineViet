import { calendarDay, checkInDays } from "../domain/rules";
import type { CoinLedgerEntry, RewardsSnapshot } from "../domain/models";
// Process-local repository for UI demonstrations only. Replace with a transactional DB repository.
interface DemoRewards {
  balance: number;
  claimed: number;
  lastDate: string | null;
  ledger: CoinLedgerEntry[];
  missionKeys: Set<string>;
}
const globalDemo = globalThis as typeof globalThis & {
  cineRewards?: DemoRewards;
  cineRequests?: Map<string, unknown>;
};
export const demoRewards = (globalDemo.cineRewards ??= {
  balance: 2450,
  claimed: 3,
  lastDate: null,
  ledger: [],
  missionKeys: new Set(),
});
export const demoRequests = (globalDemo.cineRequests ??= new Map());
export function rewardsSnapshot(now = new Date()): RewardsSnapshot {
  const date = calendarDay(now);
  // A complete cycle restarts on the next calendar day.
  const claimed =
    demoRewards.claimed === 7 && demoRewards.lastDate !== date ? 0 : demoRewards.claimed;
  return {
    wallet: {
      id: "coin-demo",
      user_id: "demo-user",
      asset: "COIN",
      balance: demoRewards.balance,
      reserved: 0,
      available: demoRewards.balance,
    },
    days: checkInDays(claimed, demoRewards.lastDate === date),
    ledger: [...demoRewards.ledger],
    calendar_date: date,
    timezone: "Asia/Ho_Chi_Minh",
  };
}
export function claimDemoCheckIn(now = new Date()): RewardsSnapshot {
  const snapshot = rewardsSnapshot(now);
  const available = snapshot.days.find((d) => d.status === "AVAILABLE");
  if (!available) return snapshot;
  const key = `demo-user:check-in:${snapshot.calendar_date}`;
  if (demoRewards.ledger.some((l) => l.idempotency_key === key)) return snapshot;
  // Synchronous check + append is indivisible in this single-process demo; not a distributed DB guarantee.
  demoRewards.ledger.unshift({
    id: crypto.randomUUID(),
    wallet_id: "coin-demo",
    amount: available.reward,
    reason: "CHECK_IN",
    idempotency_key: key,
    created_at: now.toISOString(),
  });
  demoRewards.balance += available.reward;
  demoRewards.claimed = available.day;
  demoRewards.lastDate = snapshot.calendar_date;
  return rewardsSnapshot(now);
}
