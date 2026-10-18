import type { User } from "@/domain/models";
export async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const readOnly = ["GET", "HEAD"].includes((options.method || "GET").toUpperCase());
  const signal = readOnly
    ? AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(15000)])
    : options.signal;
  const unavailable = readOnly
    ? "Dịch vụ tạm thời gián đoạn. Vui lòng tải lại sau."
    : "Chưa nhận được trạng thái xử lý. Kiểm tra trạng thái trước khi thử lại.";
  try {
    const response = await fetch(url, {
      ...options,
      signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    if (
      (response.status === 401 &&
        !new URL(url, "https://same-origin.invalid").pathname.startsWith("/api/auth/")) ||
      (response.redirected && /\/login\/?$/.test(new URL(response.url).pathname))
    )
      throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    let data;
    try {
      if (!/\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get("Content-Type") || ""))
        throw new Error("Unexpected response type");
      const text = await response.text();
      if (!text.trim()) throw new Error("Empty response");
      data = JSON.parse(text);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new Error(unavailable);
    }
    if (!response.ok)
      throw new Error(
        typeof data?.error === "string" && data.error.length <= 240 && !/[<>]/.test(data.error)
          ? data.error
          : unavailable,
      );
    return data as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof Error && error.name === "TimeoutError")
      throw new Error("Tải dữ liệu quá lâu. Vui lòng thử lại.");
    if (error instanceof TypeError) throw new Error(unavailable);
    throw error;
  }
}
export const authService = {
  async checkRegistration(signal: AbortSignal) {
    await requestJson<{ ready: true }>("/api/auth/register-check", {
      method: "POST",
      body: "{}",
      signal,
    });
  },
  async registrationCode() {
    return requestJson<{ id: string; image: string; expires_at: string }>(
      "/api/auth/register-code",
      {
        method: "POST",
        body: "{}",
      },
    );
  },
  async signUp(
    name: string,
    email: string,
    password: string,
    verification_challenge: string,
    verification_code: string,
    referral_code: string,
  ) {
    return (
      await requestJson<{ user: User }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          display_name: name,
          email,
          password,
          remember: true,
          verification_challenge,
          verification_code,
          referral_code,
        }),
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
