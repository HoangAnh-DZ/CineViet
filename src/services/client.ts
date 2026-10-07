import type { User } from "@/domain/models";
export async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Không tải được dữ liệu.");
  return data as T;
}
export const authService = {
  async signUp(name: string, email: string, password: string) {
    return (
      await requestJson<{ user: User }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ display_name: name, email, password, remember: true }),
      })
    ).user;
  },
  async signIn(email: string, password: string, remember = true) {
    return (
      await requestJson<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, remember }),
      })
    ).user;
  },
  async signOut() {
    await requestJson("/api/auth/logout", { method: "POST" });
  },
  async resetPassword(_email: string) {
    throw new Error("Khôi phục mật khẩu đang hoàn thiện.");
  },
};
