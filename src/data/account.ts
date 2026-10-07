import type {
  CashWallet,
  PaymentMethod,
  User,
  VipPlan,
  WalletLedgerEntry,
  WatchProgress,
} from "@/domain/models";
export const demoUser: User = {
  id: "demo-user",
  username: "nguyenvana",
  email: "nguyenvana@gmail.com",
};
export const cashWallet: CashWallet = {
  id: "cash-demo",
  user_id: demoUser.id,
  asset: "CASH",
  currency: "VND",
  balance: 1_250_000,
  available_balance: 1_250_000,
};
export const transactions: WalletLedgerEntry[] = [
  {
    id: "tx-1",
    wallet_id: "cash-demo",
    kind: "DEPOSIT",
    amount: 200_000,
    status: "COMPLETED",
    created_at: "2024-10-10T13:15:00Z",
  },
  {
    id: "tx-2",
    wallet_id: "cash-demo",
    kind: "WITHDRAWAL",
    amount: -500_000,
    status: "PROCESSING",
    created_at: "2024-10-08T07:22:00Z",
  },
  {
    id: "tx-3",
    wallet_id: "cash-demo",
    kind: "VIP_PAYMENT",
    amount: -299_000,
    status: "COMPLETED",
    created_at: "2024-10-05T03:30:00Z",
  },
  {
    id: "tx-4",
    wallet_id: "cash-demo",
    kind: "COIN_EXCHANGE",
    amount: -100_000,
    status: "COMPLETED",
    created_at: "2024-10-02T14:18:00Z",
  },
];
export const paymentMethods: PaymentMethod[] = [
  { id: "momo-demo", name: "Momo", kind: "E_WALLET" },
  { id: "vcb-demo", name: "Vietcombank", kind: "BANK" },
  { id: "tcb-demo", name: "Techcombank", kind: "BANK" },
  { id: "card-demo", name: "Thẻ ngân hàng", kind: "CARD" },
];
export const vipPlans: VipPlan[] = [
  { id: "FREE", name: "Free", price: 0, duration_days: 0, benefits: [], active: true, discount: 0 },
  {
    id: "VIP_MONTHLY",
    name: "1 Tháng",
    price: 99_000,
    duration_days: 30,
    benefits: ["VIP_MOVIES", "FULL_HD", "NO_ADS", "VIP_BADGE"],
    active: true,
    discount: 0,
  },
  {
    id: "VIP_QUARTERLY",
    name: "3 Tháng",
    price: 249_000,
    duration_days: 90,
    benefits: ["VIP_MOVIES", "FULL_HD", "NO_ADS", "VIP_BADGE"],
    active: true,
    discount: 16,
  },
  {
    id: "VIP_YEARLY",
    name: "12 Tháng",
    price: 499_000,
    duration_days: 365,
    benefits: ["VIP_MOVIES", "FULL_HD", "NO_ADS", "VIP_BADGE", "EARLY_ACCESS"],
    active: true,
    discount: 33,
  },
];
export const initialProgress: WatchProgress[] = [
  {
    user_id: "demo-user",
    movie_id: "golden-horizon",
    episode_id: "golden-horizon-ep-6",
    position_seconds: 1832,
    duration_seconds: 2900,
    updated_at: "2024-10-10T08:00:00Z",
  },
  {
    user_id: "demo-user",
    movie_id: "last-forest",
    episode_id: "last-forest-ep-3",
    position_seconds: 2200,
    duration_seconds: 3380,
    updated_at: "2024-10-09T08:00:00Z",
  },
];
export function formatMoney(amount: number) {
  return `${amount.toLocaleString("vi-VN")} đ`;
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
