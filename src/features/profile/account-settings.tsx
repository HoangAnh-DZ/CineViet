"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { User } from "@/domain/models";
import { requestJson } from "@/services/client";
export function AccountSettings({
  initialUser,
  onUser,
}: {
  initialUser: User;
  onUser: (u: User) => void;
}) {
  const router = useRouter(),
    params = useSearchParams();
  const [name, setName] = useState(initialUser.username),
    [email, setEmail] = useState(""),
    [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [confirm, setConfirm] = useState(""),
    [available, setAvailable] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const token = params.get("email_token");
  useEffect(() => {
    const c = new AbortController();
    requestJson<{ available: boolean }>("/api/account/security/email", { signal: c.signal })
      .then((v) => setAvailable(v.available))
      .catch(() => {});
    return () => c.abort();
  }, []);
  async function perform(path: string, body: unknown, success: string, method = "POST") {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await requestJson<{ user?: User; message?: string }>(path, {
        method,
        body: JSON.stringify(body),
      });
      if (result.user) onUser(result.user);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage(result.message || success);
      if (token && result.user) router.replace("/profile?panel=account");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được thay đổi.");
    } finally {
      setBusy(false);
    }
  }
  function passwordSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError("Mật khẩu nhập lại không khớp.");
      return;
    }
    void perform(
      "/api/account/security/password",
      { current_password: current, new_password: next, confirm_password: confirm },
      "Đã đổi mật khẩu và đăng xuất các phiên khác.",
    );
  }
  return (
    <div className="account-settings">
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="account-success">
          {message}
        </p>
      ) : null}
      {token ? (
        <section className="account-section">
          <h3>Xác minh email mới</h3>
          <button
            type="button"
            className="button primary wide"
            disabled={busy}
            onClick={() =>
              void perform(
                "/api/account/security/confirm-email",
                { token },
                "Đã xác minh và đổi email.",
              )
            }
          >
            Xác nhận email mới
          </button>
        </section>
      ) : null}
      <form
        method="post"
        className="account-section"
        onSubmit={(e) => {
          e.preventDefault();
          void perform("/api/account", { display_name: name }, "Đã lưu tên hiển thị.", "PATCH");
        }}
      >
        <h3>Thông tin cá nhân</h3>
        <label>
          Tên hiển thị
          <input
            className="field"
            required
            minLength={2}
            maxLength={80}
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Email hiện tại
          <input className="field" readOnly value={initialUser.email} />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Đang lưu…" : "Lưu tên"}
        </button>
      </form>
      <form
        method="post"
        className="account-section"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(
            "/api/account/security/email",
            { email, current_password: current },
            "Đã gửi liên kết xác minh.",
          );
        }}
      >
        <h3>Đổi email</h3>
        {available ? (
          <>
            <label>
              Email mới
              <input
                className="field"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Mật khẩu hiện tại
              <input
                className="field"
                type="password"
                required
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Gửi xác minh
            </button>
          </>
        ) : (
          <p className="helper">
            Đổi email chưa khả dụng.{" "}
            <a href="https://t.me/JameCine" target="_blank" rel="noopener noreferrer">
              Liên hệ hỗ trợ
            </a>
          </p>
        )}
      </form>
      <form method="post" className="account-section" onSubmit={passwordSubmit}>
        <h3>Đổi mật khẩu</h3>
        <label>
          Mật khẩu hiện tại
          <input
            className="field"
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          Mật khẩu mới
          <input
            className="field"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label>
          Nhập lại mật khẩu mới
          <input
            className="field"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Đang lưu…" : "Đổi mật khẩu"}
        </button>
      </form>
    </div>
  );
}
