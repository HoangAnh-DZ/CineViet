import type { RewardsService, AuthService, PaymentService } from "./contracts";
import type { RewardsSnapshot } from "@/domain/models";
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Không thể kết nối. Vui lòng thử lại.");
  return data as T;
}
export const rewardsService: RewardsService = {
  snapshot: () => api("/api/demo/rewards"),
  claimCheckIn: (idempotencyKey) =>
    api("/api/demo/rewards", {
      method: "POST",
      body: JSON.stringify({ kind: "CHECK_IN", idempotency_key: idempotencyKey }),
    }),
  claimMission: (missionId, idempotencyKey) =>
    api("/api/demo/rewards", {
      method: "POST",
      body: JSON.stringify({
        kind: "MISSION",
        mission_id: missionId,
        idempotency_key: idempotencyKey,
      }),
    }),
  ledger: async () => (await api<RewardsSnapshot>("/api/demo/rewards")).ledger,
};
export const paymentService: PaymentService = {
  submit: (request) => api("/api/demo/payments", { method: "POST", body: JSON.stringify(request) }),
};
export const authService: AuthService = {
  async signIn(email, password) {
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 6)
      throw new Error("Email hợp lệ và mật khẩu tối thiểu 6 ký tự.");
    return { id: "demo-user", username: email.split("@")[0], email };
  },
  async signUp(username, email, password) {
    if (username.trim().length < 2) throw new Error("Tên hiển thị cần ít nhất 2 ký tự.");
    return { ...(await this.signIn(email, password)), username };
  },
  async signOut() {},
  async resetPassword(email) {
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Vui lòng nhập email hợp lệ.");
  },
};
