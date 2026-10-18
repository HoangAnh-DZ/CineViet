"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Brand } from "@/components/navigation";
import { IconButton, Modal, Skeleton } from "@/components/ui";
import { useApp } from "@/components/providers";
import { authService } from "@/services/client";
import { credentialsSchema, registrationFormSchema } from "@/server/validation";
function FieldError({ name, errors }: { name: string; errors: Record<string, string> }) {
  return errors[name] ? (
    <p id={`${name}-error`} className="field-error" role="alert">
      {errors[name]}
    </p>
  ) : null;
}
export function AuthScreen({ register = false }: { register?: boolean }) {
  const [interactive, setInteractive] = useState(false);
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement | null>(null);
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [reset, setReset] = useState(false);
  const [resetError, setResetError] = useState("");
  const [registrationReady, setRegistrationReady] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const [challengeId, setChallengeId] = useState("");
  const [challengeImage, setChallengeImage] = useState("");
  const [challengeInput, setChallengeInput] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const { setUser, toast } = useApp();
  const router = useRouter();
  useEffect(() => setInteractive(true), []);
  function clearField(name: string) {
    setFieldErrors((previous) => {
      const next = { ...previous };
      delete next[name];
      return next;
    });
    setError("");
  }
  function validateConfirmation(value: string, original = password) {
    setFieldErrors((previous) => {
      const next = { ...previous };
      if (!value) next.confirm_password = "Vui lòng nhập lại mật khẩu.";
      else if (value !== original) next.confirm_password = "Mật khẩu nhập lại không khớp";
      else delete next.confirm_password;
      return next;
    });
  }
  useEffect(() => {
    if (!register) return;
    const code = new URLSearchParams(window.location.search).get("ref")?.trim().toUpperCase();
    if (code && /^CVJ-[A-Z0-9]{8,20}$/.test(code)) setReferralCode(code);
  }, [register]);
  useEffect(() => {
    if (!register) return;
    const controller = new AbortController();
    setRegistrationReady(false);
    setVerificationError("");
    authService.checkRegistration(controller.signal).then(
      async () => {
        if (controller.signal.aborted) return;
        try {
          const challenge = await authService.registrationCode();
          if (!controller.signal.aborted) {
            setChallengeId(challenge.id);
            setChallengeImage(challenge.image);
            setChallengeInput("");
            setRegistrationReady(true);
          }
        } catch (e) {
          if (!controller.signal.aborted) setVerificationError((e as Error).message);
        }
      },
      (e: Error) => {
        if (!controller.signal.aborted) setVerificationError(e.message);
      },
    );
    return () => controller.abort();
  }, [register, verificationAttempt]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || (register && (!registrationReady || !remember))) return;
    const credentials = { email, password, remember };
    const fields = {
      ...credentials,
      display_name: name,
      verification_challenge: challengeId,
      verification_code: challengeInput.toUpperCase(),
      referral_code: referralCode,
    };
    const validation = register
      ? registrationFormSchema.safeParse({ ...fields, confirm_password: confirmation })
      : credentialsSchema.safeParse(credentials);
    if (!validation.success) {
      const errors: Record<string, string> = {};
      for (const issue of validation.error.issues) {
        if (!issue.path.length) {
          setError("Thông tin chưa hợp lệ. Vui lòng kiểm tra và thử lại.");
          continue;
        }
        const key = String(issue.path[0]);
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      if (register) setConfirmationTouched(true);
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    submitting.current = true;
    setFieldErrors({});
    setPending(true);
    setError("");
    try {
      const user = register
        ? await authService.signUp(
            name,
            email,
            password,
            challengeId,
            challengeInput.toUpperCase(),
            referralCode,
          )
        : await authService.signIn(email, password, remember);
      setUser(user, register || remember);
      toast(register ? "Đã tạo tài khoản" : "Đã đăng nhập");
      router.push("/profile");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return (
    <div className="auth-layout">
      <aside className="auth-cinema" aria-label="Thế giới điện ảnh CineVjet">
        <img
          src="/images/films/spring.webp"
          alt="Cảnh phim Spring"
          width={960}
          height={540}
          loading="lazy"
        />
        <div className="auth-cinema-copy">
          <span className="eyebrow">CINEVJET / ĐIỆN ẢNH</span>
          <h2>
            Câu chuyện hay,
            <br />
            luôn ở đây.
          </h2>
          <p>Phim lẻ · Phim bộ · Phim ngắn</p>
        </div>
        <a
          className="auth-art-credit"
          href="https://studio.blender.org/projects/spring/pages/about/"
          target="_blank"
          rel="noreferrer"
        >
          Spring · Blender Studio · CC BY 4.0
        </a>
      </aside>
      <div className="auth-page cinematic-auth">
        <div className="auth-brand">
          <Brand vertical />
        </div>
        <h1>{register ? "Tạo tài khoản" : "Chào mừng trở lại"}</h1>
        <p className="auth-intro">
          {register
            ? "Khám phá thế giới phim và lưu những câu chuyện bạn yêu thích."
            : "Đăng nhập để tiếp tục xem phim yêu thích của bạn."}
        </p>
        {register ? <p className="helper">Đăng ký miễn phí.</p> : null}
        <form method="post" onSubmit={submit} ref={form} noValidate>
          <fieldset disabled={pending} className="auth-fields">
            {register ? (
              <div className="auth-field">
                <label htmlFor="username">Tên hiển thị</label>
                <input
                  id="username"
                  className="field"
                  placeholder="Nhập tên của bạn"
                  autoComplete="nickname"
                  name="display_name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clearField("display_name");
                  }}
                  aria-invalid={!!fieldErrors.display_name}
                  aria-describedby={fieldErrors.display_name ? "display_name-error" : undefined}
                  minLength={2}
                  required
                />
                <FieldError name="display_name" errors={fieldErrors} />
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
                name="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearField("email");
                }}
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? "email-error" : undefined}
                required
              />
              <FieldError name="email" errors={fieldErrors} />
            </div>
            {register ? (
              <div className="auth-field">
                <label htmlFor="referral-code">Mã giới thiệu (nếu có)</label>
                <input
                  id="referral-code"
                  name="referral_code"
                  className="field"
                  placeholder="CVJ-..."
                  value={referralCode}
                  onChange={(e) => {
                    setReferralCode(e.target.value.toUpperCase());
                    clearField("referral_code");
                  }}
                  maxLength={24}
                  autoComplete="off"
                  aria-invalid={!!fieldErrors.referral_code}
                  aria-describedby={fieldErrors.referral_code ? "referral_code-error" : undefined}
                />
                <FieldError name="referral_code" errors={fieldErrors} />
              </div>
            ) : null}
            {register && registrationReady ? (
              <div className="auth-field registration-code-slot">
                <label htmlFor="verification-code">Mã xác minh 4 ký tự</label>
                <div
                  className="verification-code-box"
                  aria-label="Mã xác minh hình ảnh, gồm 4 ký tự"
                >
                  <img
                    src={challengeImage}
                    width={480}
                    height={144}
                    alt="Mã xác minh đăng ký gồm 4 ký tự"
                  />
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => setVerificationAttempt((value) => value + 1)}
                  >
                    Mã mới
                  </button>
                </div>
                <input
                  id="verification-code"
                  name="verification_code"
                  className="field"
                  placeholder="Nhập lại 4 ký tự"
                  value={challengeInput}
                  onChange={(e) => {
                    clearField("verification_code");
                    setChallengeInput(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, "")
                        .slice(0, 4),
                    );
                  }}
                  aria-invalid={!!fieldErrors.verification_code}
                  aria-describedby={
                    fieldErrors.verification_code ? "verification_code-error" : undefined
                  }
                  maxLength={4}
                  inputMode="text"
                  autoComplete="off"
                  required
                  pattern="[A-Z0-9]{4}"
                />
                <FieldError name="verification_code" errors={fieldErrors} />
                <p className="helper">Mã có hiệu lực 5 phút và chỉ dùng một lần.</p>
              </div>
            ) : register ? (
              <div
                className="auth-field registration-code-slot verification-placeholder"
                aria-hidden="true"
              >
                <div className="verification-label">Mã xác minh 4 ký tự</div>
                <div className="verification-code-box">
                  <Skeleton className="verification-canvas-skeleton" />
                </div>
                <Skeleton className="verification-input-skeleton" />
                <p className="helper">Đang chuẩn bị mã xác minh…</p>
              </div>
            ) : null}
            <div className="auth-field">
              <label htmlFor="password">Mật khẩu</label>
              <div className="password-field">
                <input
                  id="password"
                  className="field"
                  type={visible ? "text" : "password"}
                  placeholder="Nhập mật khẩu"
                  autoComplete={register ? "new-password" : "current-password"}
                  name="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearField("password");
                    if (register && confirmationTouched)
                      validateConfirmation(confirmation, e.target.value);
                  }}
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? "password-error" : undefined}
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
              <FieldError name="password" errors={fieldErrors} />
            </div>
            {register ? (
              <div className="auth-field">
                <label htmlFor="confirm-password">Nhập lại mật khẩu</label>
                <div className="password-field">
                  <input
                    id="confirm-password"
                    name="confirm_password"
                    className="field"
                    type={confirmationVisible ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Nhập lại mật khẩu"
                    value={confirmation}
                    onChange={(event) => {
                      setConfirmation(event.target.value);
                      if (confirmationTouched || fieldErrors.confirm_password)
                        validateConfirmation(event.target.value);
                    }}
                    onBlur={() => {
                      setConfirmationTouched(true);
                      validateConfirmation(confirmation);
                    }}
                    required
                    aria-invalid={!!fieldErrors.confirm_password}
                    aria-describedby={
                      fieldErrors.confirm_password ? "confirm_password-error" : undefined
                    }
                  />
                  <IconButton
                    label={confirmationVisible ? "Ẩn mật khẩu nhập lại" : "Hiện mật khẩu nhập lại"}
                    onClick={() => setConfirmationVisible(!confirmationVisible)}
                  >
                    {confirmationVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </IconButton>
                </div>
                <div className="confirmation-feedback">
                  <FieldError name="confirm_password" errors={fieldErrors} />
                </div>
              </div>
            ) : null}
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
                <button
                  type="button"
                  onClick={() => {
                    setResetError("");
                    setReset(true);
                  }}
                >
                  Quên mật khẩu?
                </button>
              ) : null}
            </div>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            {register && !registrationReady ? (
              verificationError ? (
                <div>
                  <p className="form-error" role="alert">
                    {verificationError}
                  </p>
                  <button
                    className="button ghost wide"
                    type="button"
                    onClick={() => setVerificationAttempt((value) => value + 1)}
                  >
                    Thử lại kiểm tra bảo mật
                  </button>
                </div>
              ) : (
                <p className="helper" role="status">
                  Đang kiểm tra bảo mật...
                </p>
              )
            ) : null}
            <button
              className="button primary wide"
              type="submit"
              disabled={!interactive || pending || (register && (!remember || !registrationReady))}
            >
              {pending ? "Đang xử lý..." : register ? "Đăng ký" : "Đăng nhập"}
            </button>
          </fieldset>
        </form>
        <p className="auth-switch">
          {register ? "Đã có tài khoản? " : "Chưa có tài khoản? "}
          <Link href={register ? "/login" : "/register"}>{register ? "Đăng nhập" : "Đăng ký"}</Link>
        </p>
        <p className="demo-note">Mật khẩu tối thiểu 8 ký tự.</p>
        {reset ? (
          <Modal title="Quên mật khẩu" onClose={() => setReset(false)}>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await authService.resetPassword(email);
                  setReset(false);
                  toast("Đã gửi yêu cầu khôi phục mật khẩu.");
                } catch (e) {
                  setResetError((e as Error).message);
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
              <p className="helper">Khôi phục mật khẩu qua email hiện chưa được bật.</p>
              {resetError ? (
                <p className="form-error" role="alert">
                  {resetError}
                </p>
              ) : null}
              <button className="button primary wide">Tiếp tục</button>
            </form>
          </Modal>
        ) : null}
      </div>
    </div>
  );
}
