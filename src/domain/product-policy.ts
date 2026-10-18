export const WITHDRAWAL_PRESETS = [35000, 70000, 110000] as const;
export const WITHDRAWAL_FEE_BPS = 400;
export function validWithdrawalSelection(amount: number) {
  return (
    Number.isSafeInteger(amount) &&
    amount <= 100000000 &&
    (WITHDRAWAL_PRESETS.some((value) => value === amount) || amount > 110000)
  );
}
// Round upward to the nearest whole VND once; the requested amount includes fee.
export function withdrawalFee(amount: number, bps = WITHDRAWAL_FEE_BPS) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > 100000000 ||
    bps !== WITHDRAWAL_FEE_BPS
  )
    throw new Error("Số tiền hoặc phí chưa hợp lệ.");
  return Math.ceil((amount * bps) / 10000);
}
export function vipDescription(
  price: number,
  additional: number,
  dailyVideos: number,
  days: number,
) {
  return {
    additional_amount: additional,
    total_return: price + additional,
    total_videos: dailyVideos * days,
  };
}
