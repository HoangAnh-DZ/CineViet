"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Landmark } from "lucide-react";
import { useApp } from "@/components/providers";
import type { VipRewardPlan, Entitlement } from "@/domain/models";
import { terminalPayment, type PayosOrder } from "@/domain/payos";
import { formatMoney } from "@/lib/format";
import { requestJson } from "@/services/client";
import { PayosPaymentPanel } from "@/features/wallet/payos-payment-panel";
import { usePayosPayment } from "@/features/wallet/use-payos-payment";
import { VipProductFacts } from "./vip-product-facts";

const benefits: Record<Entitlement, string> = {
  VIP_MOVIES: "Xem nội dung VIP",
  FULL_HD: "Chất lượng Full HD",
  NO_ADS: "Không quảng cáo",
  VIP_BADGE: "Huy hiệu VIP",
  EARLY_ACCESS: "Ưu tiên nội dung mới",
};
type Attempt = { key: string; orderId?: string };
export function VipPayosCheckout({
  plan,
  disabled,
  onBusy,
  onBack,
  onStageChange,
  onPaid,
}: {
  plan: VipRewardPlan;
  disabled: boolean;
  onBusy: (value: boolean) => void;
  onBack?: () => void;
  onStageChange?: (value: boolean) => void;
  onPaid?: () => void;
}) {
  const { user } = useApp();
  const storageKey = `cvj-vip-payment:v1:${user?.id}:${plan.id}`;
  const [initial, setInitial] = useState<PayosOrder | null>(null),
    [recovering, setRecovering] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [restoreRun, setRestoreRun] = useState(0);
  const flight = useRef(false),
    attempt = useRef<Attempt | null>(null);
  const payment = usePayosPayment(initial?.id || null, initial);
  const callbacks = useRef({ onBusy, onStageChange, onPaid });
  callbacks.current = { onBusy, onStageChange, onPaid };
  const paid = useRef<string | null>(null);
  useEffect(() => {
    if (payment.order?.status === "PAID" && paid.current !== payment.order.id) {
      paid.current = payment.order.id;
      callbacks.current.onPaid?.();
    }
  }, [payment.order]);
  function save(value: Attempt) {
    attempt.current = value;
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {}
  }
  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    setRecovering(true);
    setError("");
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (stored && /^[\da-f-]{36}$/i.test(stored.key)) attempt.current = stored;
    } catch {}
    void (async () => {
      try {
        const result = await requestJson<{ order: PayosOrder | null }>(
          `/api/payments/payos?plan_id=${encodeURIComponent(plan.id)}`,
          { signal: controller.signal },
        );
        let order = result.order;
        if (!order && attempt.current?.orderId)
          order = await requestJson<PayosOrder>(
            `/api/payments/payos/${encodeURIComponent(attempt.current.orderId)}`,
            { signal: controller.signal },
          );
        if (controller.signal.aborted) return;
        if (order) {
          setInitial(order);
          save({ key: attempt.current?.key || crypto.randomUUID(), orderId: order.id });
          callbacks.current.onStageChange?.(true);
        }
      } catch {
        if (!controller.signal.aborted || timedOut)
          setError("Chưa tải được đơn hiện có. Vui lòng thử lại trước khi thanh toán.");
      } finally {
        window.clearTimeout(timeout);
        if (!controller.signal.aborted || timedOut) setRecovering(false);
      }
    })();
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [plan.id, storageKey, restoreRun]);
  async function confirm() {
    if (flight.current || recovering || disabled || error) return;
    flight.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    // Persist before POST: a lost response must retry the same durable attempt.
    const value = attempt.current || { key: crypto.randomUUID() };
    save(value);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const order = await requestJson<PayosOrder>("/api/payments/payos", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          kind: "VIP_PURCHASE",
          plan_id: plan.id,
          idempotency_key: value.key,
        }),
      });
      save({ ...value, orderId: order.id });
      setInitial(order);
      onStageChange?.(true);
    } catch (e) {
      setError(
        (e instanceof Error ? e.message + " " : "") +
          "Kiểm tra đơn trước khi thử lại; hệ thống giữ nguyên yêu cầu cũ.",
      );
    } finally {
      window.clearTimeout(timeout);
      flight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  if (initial)
    return (
      <PayosPaymentPanel
        {...payment}
        onCheck={() => void payment.check()}
        onCancel={() => void payment.cancel()}
        onRetry={() => {
          if (
            !payment.order ||
            !terminalPayment(payment.order.status) ||
            payment.order.status === "PAID"
          )
            return;
          try {
            localStorage.removeItem(storageKey);
          } catch {}
          attempt.current = null;
          setInitial(null);
          setError("");
          onStageChange?.(false);
        }}
      />
    );
  return (
    <div className="vip-confirmation">
      <div className="vip-confirm-plan">
        <div>
          <h3>{plan.name}</h3>
          <span>{plan.duration_days} ngày</span>
        </div>
        <strong>{formatMoney(plan.price)}</strong>
      </div>
      <VipProductFacts plan={plan} />
      <p className="helper">1 xu = 1 VNĐ.</p>
      <ul className="vip-confirm-benefits">
        {plan.benefits
          .filter((benefit) => benefit !== "EARLY_ACCESS")
          .map((benefit) => (
            <li key={benefit}>
              <Check size={17} />
              {benefits[benefit]}
            </li>
          ))}
        {plan.mission_count > 0 ? (
          <li>
            <Check size={17} />
            {plan.mission_count} nhiệm vụ video/ngày
          </li>
        ) : null}
      </ul>
      <div className="vip-confirm-method">
        <Landmark size={25} />
        <div>
          <strong>Chuyển khoản ngân hàng</strong>
        </div>
      </div>
      <p className="helper">Mã thanh toán có hiệu lực 30 phút kể từ khi tạo lệnh.</p>
      {recovering ? <p role="status">Đang kiểm tra đơn hiện có…</p> : null}
      {error ? (
        <>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button className="button secondary" onClick={() => setRestoreRun((v) => v + 1)}>
            Kiểm tra đơn / thử lại
          </button>
        </>
      ) : null}
      {disabled ? <p className="form-error">Thanh toán đang bảo trì.</p> : null}
      <div className="vip-confirm-actions">
        <button
          className="button primary wide"
          disabled={busy || recovering || disabled || !!error}
          onClick={() => void confirm()}
        >
          {busy ? "Đang tạo thanh toán…" : "Xác nhận & thanh toán"}
        </button>
        <button className="button secondary wide" disabled={busy} onClick={onBack}>
          Quay lại
        </button>
      </div>
    </div>
  );
}
