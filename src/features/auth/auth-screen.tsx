"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Apple } from "lucide-react";
import { Brand } from "@/components/navigation";
import { IconButton, Modal } from "@/components/ui";
import { useApp } from "@/components/providers";
import { authService } from "@/services/client";
export function AuthScreen({ register = false }: { register?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [reset, setReset] = useState(false);
  const { setUser, toast } = useApp();
  const router = useRouter();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const user = register
        ? await authService.signUp(name, email, password)
        : await authService.signIn(email, password, remember);
      setUser(user, register || remember);
      toast(register ? "Đã tạo tài khoản" : "Đã đăng nhập");
      router.push("/profile");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <Brand vertical />
      </div>
      <h1>{register ? "Tạo tài khoản" : "Chào mừng trở lại"}</h1>
      <p className="auth-intro">
        {register
          ? "Khám phá thế giới phim và lưu những câu chuyện bạn yêu thích."
          : "Đăng nhập để tiếp tục xem phim yêu thích của bạn."}
      </p>
      <form onSubmit={submit}>
        {register ? (
          <div className="auth-field">
            <label htmlFor="username">Tên hiển thị</label>
            <input
              id="username"
              className="field"
              placeholder="Nhập tên của bạn"
              autoComplete="nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              required
            />
          </div>
        ) : null}
        <div className="auth-field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className="field"
            type="email"
            placeholder="Nhập email của bạn"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="auth-field">
          <label htmlFor="password">Mật khẩu</label>
          <div className="password-field">
            <input
              id="password"
              className="field"
              type={visible ? "text" : "password"}
              placeholder="Nhập mật khẩu"
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
            <IconButton
              label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </IconButton>
          </div>
        </div>
        <div className="auth-options">
          <label>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {register ? "Đồng ý điều khoản" : "Ghi nhớ đăng nhập"}
          </label>
          {!register ? (
            <button type="button" onClick={() => setReset(true)}>
              Quên mật khẩu?
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="button primary wide"
          type="submit"
          disabled={pending || (register && !remember)}
        >
          {pending ? "Đang xử lý..." : register ? "Đăng ký" : "Đăng nhập"}
        </button>
      </form>
      <div className="divider">Hoặc đăng nhập với</div>
      <div className="social-options">
        <button
          aria-label="Đăng nhập Google"
          onClick={() => toast("Google sẽ khả dụng khi kết nối dịch vụ đăng nhập.")}
        >
          <span className="google-letter">G</span>
        </button>
        <button
          aria-label="Đăng nhập Facebook"
          onClick={() => toast("Facebook sẽ khả dụng khi kết nối dịch vụ đăng nhập.")}
        >
          <span className="facebook-letter">f</span>
        </button>
        <button
          aria-label="Đăng nhập Apple"
          onClick={() => toast("Apple sẽ khả dụng khi kết nối dịch vụ đăng nhập.")}
        >
          <Apple size={23} fill="currentColor" />
        </button>
      </div>
      <p className="auth-switch">
        {register ? "Đã có tài khoản? " : "Chưa có tài khoản? "}
        <Link href={register ? "/login" : "/register"}>{register ? "Đăng nhập" : "Đăng ký"}</Link>
      </p>
      <p className="demo-note">
        Mật khẩu tối thiểu 8 ký tự. Tài khoản và thư viện được lưu an toàn.
      </p>
      {reset ? (
        <Modal title="Quên mật khẩu" onClose={() => setReset(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await authService.resetPassword(email);
                setReset(false);
                toast("Bản demo: chức năng gửi email sẽ được kết nối sau.");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label htmlFor="reset-email" className="field-label">
              Email tài khoản
            </label>
            <input
              id="reset-email"
              className="field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className="helper">Nhập email để xem luồng khôi phục mật khẩu.</p>
            <button className="button primary wide">Tiếp tục</button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
