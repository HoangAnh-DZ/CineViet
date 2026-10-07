export type ID = string;
export type MoneyVnd = number; // Integer minor units (VND). Validate at every service boundary.
export type MovieType = "MOVIE" | "SERIES";
export type Entitlement = "VIP_MOVIES" | "FULL_HD" | "NO_ADS" | "VIP_BADGE" | "EARLY_ACCESS";
export interface User {
  id: ID;
  username: string;
  email: string;
  avatar?: string;
}
export interface Genre {
  id: ID;
  name: string;
}
export interface Movie {
  id: ID;
  title: string;
  original_title: string;
  slug: string;
  description: string;
  poster: string;
  backdrop: string;
  release_year: number;
  country: string;
  duration: number;
  rating: number;
  type: MovieType;
  vip_required: boolean;
  status: "PUBLISHED" | "DRAFT" | "HIDDEN";
  genres: string[];
  episode_count?: number;
}
export interface Season {
  id: ID;
  movie_id: ID;
  season_number: number;
  title: string;
}
export interface Episode {
  id: ID;
  movie_id: ID;
  season: number;
  episode_number: number;
  title: string;
  duration: number;
  thumbnail: string;
  release_date: string;
}
export interface VideoSource {
  id: ID;
  movie_id: ID;
  episode_id?: ID;
  protocol: "MP4" | "HLS" | "DASH";
  url: string;
  quality: "720p" | "1080p" | "AUTO";
  mime_type: string;
  required_entitlement?: Entitlement;
}
export interface Subtitle {
  id: ID;
  video_source_id: ID;
  language: string;
  label: string;
  url: string;
  format: "VTT";
}
export interface WatchProgress {
  user_id: ID;
  movie_id: ID;
  episode_id?: ID;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
  movie?: Movie;
  episode_number?: number;
  completed?: boolean;
}
export interface Favorite {
  user_id: ID;
  movie_id: ID;
  created_at: string;
}
export interface CoinWallet {
  id: ID;
  user_id: ID;
  asset: "COIN";
  balance: number;
}
export interface CoinLedgerEntry {
  id: ID;
  wallet_id: ID;
  amount: number;
  reason: "CHECK_IN" | "MISSION" | "EXCHANGE";
  idempotency_key: string;
  created_at: string;
}
export type CheckInStatus = "AVAILABLE" | "CLAIMED" | "LOCKED";
export interface CheckInDay {
  day: number;
  reward: number;
  status: CheckInStatus;
}
export interface DailyCheckInRecord {
  id: ID;
  user_id: ID;
  calendar_date: string;
  timezone: string;
  cycle_day: number;
  ledger_id: ID;
}
export interface CashWallet {
  id: ID;
  user_id: ID;
  asset: "CASH";
  currency: "VND";
  balance: MoneyVnd;
  available_balance: MoneyVnd;
}
export type DepositStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type WithdrawalStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED";
export interface PaymentMethod {
  id: ID;
  name: string;
  kind: "BANK" | "E_WALLET" | "CARD";
  provider_code?: string;
}
export interface Deposit {
  id: ID;
  user_id: ID;
  amount: MoneyVnd;
  method_id: ID;
  status: DepositStatus;
  idempotency_key: string;
  created_at: string;
}
export interface Withdrawal {
  id: ID;
  user_id: ID;
  amount: MoneyVnd;
  fee: MoneyVnd;
  net_amount: MoneyVnd;
  method_id: ID;
  destination: string;
  status: WithdrawalStatus;
  idempotency_key: string;
  created_at: string;
}
export interface WalletLedgerEntry {
  id: ID;
  wallet_id: ID;
  amount: MoneyVnd;
  kind: "DEPOSIT" | "WITHDRAWAL" | "VIP_PAYMENT" | "COIN_EXCHANGE";
  status: DepositStatus | WithdrawalStatus;
  created_at: string;
}
export interface VipPlan {
  id: "FREE" | "VIP_MONTHLY" | "VIP_QUARTERLY" | "VIP_YEARLY";
  name: string;
  price: MoneyVnd;
  duration_days: number;
  benefits: Entitlement[];
  active: boolean;
  discount: number;
}
export interface VipSubscription {
  id: ID;
  user_id: ID;
  plan_id: VipPlan["id"];
  started_at: string;
  expires_at: string;
  status: "ACTIVE" | "EXPIRED" | "CANCELLED";
}
export interface Notification {
  id: ID;
  user_id: ID;
  title: string;
  body: string;
  read_at?: string;
  created_at: string;
}
export interface RewardsSnapshot {
  wallet: CoinWallet;
  days: CheckInDay[];
  ledger: CoinLedgerEntry[];
  calendar_date: string;
  timezone: string;
}
