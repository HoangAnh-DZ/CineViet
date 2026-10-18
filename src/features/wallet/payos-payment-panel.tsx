"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Copy, ShieldCheck } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { paymentStatus, terminalPayment, type PayosOrder } from "@/domain/payos";
import { payosQrDetails } from "@/domain/payos-qr";
import "./payos-payment.css";
import "@/features/vip/vip-orders.css";

export function PayosPaymentPanel({
  order,
  error,
  busy,
  paused,
  onCheck,
  onRetry,
  onCancel,
}: {
  order: PayosOrder | null;
  error: string;
  busy: boolean;
  paused: boolean;
  onCheck: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  const [qr, setQr] = useState(""),
    [qrFailed, setQrFailed] = useState(false),
    [copied, setCopied] = useState(""),
    [now, setNow] = useState(0);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const details = useMemo(
    () => payosQrDetails(order?.qr_code, order?.amount || 0),
    [order?.qr_code, order?.amount],
  );
  const terminal = order ? terminalPayment(order.status) : false;
  useEffect(() => {
    setNow(Date.now());
    if (terminal) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [terminal]);
  useEffect(() => {
    let active = true;
    setQr("");
    setQrFailed(false);
    if (details && order?.qr_code && !terminal) {
      void import("qrcode")
        .then(({ default: QRCode }) =>
          QRCode.toDataURL(order.qr_code!, {
            width: 320,
            margin: 4,
            errorCorrectionLevel: "M",
            color: { dark: "#000000", light: "#ffffff" },
          }),
        )
        .then((url) => {
          if (active) setQr(url);
        })
        .catch(() => {
          if (active) setQrFailed(true);
        });
    }
    return () => {
      active = false;
    };
  }, [details, order?.qr_code, terminal]);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`Đã sao chép ${label}`);
    } catch {
      setCopied("Vui lòng chọn và sao chép thông tin.");
    }
  }
  if (!order)
    return (
      <div className="payos-payment">
        <p role="status">{error || "Đang kiểm tra thanh toán…"}</p>
        <button className="button secondary" disabled={busy} onClick={onCheck}>
          Kiểm tra lại
        </button>
      </div>
    );
  const expiredLocally = now > 0 && now >= Date.parse(order.expires_at);
  const seconds = Math.max(0, Math.floor((Date.parse(order.expires_at) - now) / 1000));
  const checkout =
    order.checkout_url && /^https:\/\/pay\.payos\.vn\//.test(order.checkout_url)
      ? order.checkout_url
      : null;
  const rows = [
    ["Mã đơn", String(order.order_code)],
    ["Ngân hàng (BIN)", order.bank_code || details?.bankCode],
    ["Chủ tài khoản", order.account_name],
    ["Số tài khoản", order.account_number || details?.accountNumber],
    ["Nội dung chuyển khoản", details?.description],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <div className="payos-payment">
      {order.status === "PAID" ? (
        <div className="payos-result" role="status">
          <CheckCircle2 size={48} />
          <h3>Thanh toán thành công</h3>
          <strong>{formatMoney(order.amount)}</strong>
          <p>
            {order.kind === "VIP_PURCHASE"
              ? `${order.plan_name || "VIP"} đã được kích hoạt.`
              : "Tiền đã được cộng vào ví VND."}
          </p>
          {order.duration_days ? (
            <p>
              {order.duration_days} ngày
              {order.vip_expires_at
                ? ` · Đến ${new Date(order.vip_expires_at).toLocaleDateString("vi-VN")}`
                : ""}
            </p>
          ) : null}
          <Link
            className="button primary"
            href={order.kind === "VIP_PURCHASE" ? "/rewards" : "/wallet"}
          >
            Tiếp tục
          </Link>
        </div>
      ) : terminal ? (
        <div className="payos-result">
          <h3>{paymentStatus(order.status)}</h3>
          <p>Đơn này đã kết thúc.</p>
          {onRetry ? (
            <button className="button primary" onClick={onRetry}>
              Chọn lại gói
            </button>
          ) : (
            <Link
              className="button primary"
              href={order.kind === "VIP_PURCHASE" ? "/vip" : "/wallet/deposit"}
            >
              Quay lại
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="payos-payment-grid">
            <div className="payos-qr-column">
              {!expiredLocally && qr ? (
                <img
                  className="payos-qr"
                  src={qr}
                  width={320}
                  height={320}
                  alt="Mã QR chuyển khoản ngân hàng"
                />
              ) : !expiredLocally && details && !qrFailed ? (
                <div className="payos-qr-loading" role="status">
                  Đang hiển thị QR…
                </div>
              ) : (
                <div className="payos-qr-unavailable">
                  {expiredLocally
                    ? "QR đã đến thời gian hết hạn. Kiểm tra trạng thái đơn."
                    : "QR chưa sẵn sàng. Vui lòng kiểm tra lại hoặc mở trang thanh toán bên ngoài."}
                </div>
              )}
              {!expiredLocally && qr ? <p>Mở ứng dụng ngân hàng để quét QR</p> : null}
              <span className="payos-state" role="status">
                {paymentStatus(order.status)}
              </span>
            </div>
            <div className="payos-details">
              <span className="payos-eyebrow">
                {order.plan_name || (order.kind === "VIP_PURCHASE" ? "Nâng cấp VIP" : "Nạp ví VND")}
                {order.duration_days ? ` · ${order.duration_days} ngày` : ""}
              </span>
              <div className="payos-amount-row">
                <strong className="payos-amount">{formatMoney(order.amount)}</strong>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Sao chép số tiền"
                  onClick={() => copy(String(order.amount), "số tiền")}
                >
                  <Copy size={18} />
                </button>
              </div>
              <dl>
                {rows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <span>{value}</span>
                      {["Mã đơn", "Số tài khoản", "Nội dung chuyển khoản"].includes(label) ? (
                        <button
                          type="button"
                          aria-label={`Sao chép ${label.toLowerCase()}`}
                          onClick={() => copy(value, label.toLowerCase())}
                        >
                          <Copy size={16} />
                        </button>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
              {now ? (
                <p className="payos-expiry">
                  {expiredLocally ? (
                    "Hết thời gian thanh toán · Đang đối soát lệnh"
                  ) : (
                    <>
                      Còn{" "}
                      <strong>
                        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
                      </strong>{" "}
                      để thanh toán
                    </>
                  )}
                </p>
              ) : null}
              <p className="payos-security">
                <ShieldCheck size={16} /> Chuyển đúng số tiền và nội dung của đơn.
              </p>
              <span className="payos-copy-status" role="status">
                {copied}
              </span>
            </div>
          </div>
          {paused ? (
            <p className="payos-note">
              Đã tạm dừng tự kiểm tra. Bấm kiểm tra trạng thái để đối soát đơn.
            </p>
          ) : null}
          <div className="payos-actions">
            <button className="button secondary" disabled={busy} onClick={onCheck}>
              {busy ? "Đang kiểm tra…" : "Kiểm tra trạng thái"}
            </button>
            {onCancel &&
            order.kind === "VIP_PURCHASE" &&
            ["CREATING", "PENDING"].includes(order.status) &&
            !expiredLocally ? (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setCancelConfirm(true)}
              >
                Hủy lệnh nâng cấp
              </button>
            ) : null}
            {checkout && !expiredLocally && (!details || qrFailed) ? (
              <a
                className={!details || qrFailed ? "button primary" : "payos-official-link"}
                href={checkout}
                target="_blank"
                rel="noopener noreferrer"
              >
                Mở trang thanh toán payOS (bên ngoài)
              </a>
            ) : null}
          </div>
          {cancelConfirm && onCancel ? (
            <div className="vip-cancel-confirm" role="group" aria-label="Xác nhận hủy lệnh">
              <strong>Hủy lệnh nâng cấp này?</strong>
              <p>
                Chỉ hủy khi bạn chưa chuyển tiền. Hệ thống sẽ kiểm tra trạng thái thanh toán trước
                khi hủy.
              </p>
              <div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setCancelConfirm(false)}
                >
                  Giữ lệnh
                </button>
                <button type="button" className="button primary" disabled={busy} onClick={onCancel}>
                  {busy ? "Đang kiểm tra…" : "Xác nhận hủy lệnh"}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
