// Server-owned denomination; redemption applies separate limits, fees and approval.
export const COIN_VALUE_VND = 1 as const;
// Total includes reservations until settlement. Never debit an open hold twice.
export function coinBalances(balance: unknown, reserved: unknown) {
  const total = Number(balance),
    held = Number(reserved);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(held) || held < 0 || total < held)
    throw new Error("Số dư xu không hợp lệ.");
  return { balance: total, reserved: held, available: total - held };
}
export function coinsToVnd(coins: number): number {
  if (!Number.isSafeInteger(coins) || coins < 0) throw new Error("Số xu không hợp lệ.");
  const value = coins * COIN_VALUE_VND;
  if (!Number.isSafeInteger(value)) throw new Error("Giá trị xu vượt giới hạn.");
  return value;
}
