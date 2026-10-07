import type {
  CoinLedgerEntry,
  Favorite,
  RewardsSnapshot,
  User,
  VipSubscription,
  WatchProgress,
} from "@/domain/models";
export interface CatalogRepository {
  findBySlug(slug: string): Promise<import("@/domain/models").Movie | undefined>;
}
export interface WatchHistoryService {
  list(userId: string): Promise<WatchProgress[]>;
  save(progress: WatchProgress): Promise<void>;
}
export interface FavoritesService {
  list(userId: string): Promise<Favorite[]>;
  toggle(userId: string, movieId: string): Promise<boolean>;
}
export interface RewardsService {
  snapshot(): Promise<RewardsSnapshot>;
  claimCheckIn(idempotencyKey: string): Promise<RewardsSnapshot>;
  claimMission(missionId: string, idempotencyKey: string): Promise<RewardsSnapshot>;
  ledger(): Promise<CoinLedgerEntry[]>;
}
export interface AuthService {
  signIn(email: string, password: string): Promise<User>;
  signUp(username: string, email: string, password: string): Promise<User>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
}
export interface EntitlementService {
  subscription(userId: string): Promise<VipSubscription | null>;
}
export interface PaymentRequest {
  kind: "DEPOSIT" | "WITHDRAWAL" | "VIP";
  amount?: string;
  method_id: string;
  destination?: string;
  plan_id?: string;
  idempotency_key: string;
}
export interface PaymentReceipt {
  id: string;
  status: "PENDING";
  amount: number;
  fee: number;
  net_amount: number;
  kind: "DEPOSIT" | "WITHDRAWAL" | "VIP";
  created_at: string;
  demo: true;
}
export interface PaymentService {
  submit(request: PaymentRequest): Promise<PaymentReceipt>;
}
