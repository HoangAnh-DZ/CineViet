"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/services/client";
import type { PayosOrder } from "@/domain/payos";
import { formatMoney } from "@/lib/format";
export function PayosCheckout({
  kind,
  amount,
  planId,
  disabled,
  onBusy,
}: {
  kind: "DEPOSIT" | "VIP_PURCHASE";
  amount: number;
  planId?: string;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const flight = useRef(false),
    attempt = useRef<{ payload: string; key: string } | null>(null),
    router = useRouter();
  async function create() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    onBusy?.(true);
    setError("");
    const payload = kind === "DEPOSIT" ? { kind, amount } : { kind, plan_id: planId },
      serialized = JSON.stringify(payload);
    if (attempt.current?.payload !== serialized)
      attempt.current = { payload: serialized, key: crypto.randomUUID() };
    try {
      const o = await requestJson<PayosOrder>("/api/payments/payos", {
        method: "POST",
        body: JSON.stringify({ ...payload, idempotency_key: attempt.current.key }),
      });
      router.push(`/payments/payos/${o.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được thanh toán.");
    } finally {
      flight.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <section className="payos-checkout">
      <p>Chuyển khoản ngân hàng · {formatMoney(amount)}</p>
      <button
        type="button"
        className="button primary wide"
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={create}
      >
        {busy ? "Đang tạo thanh toán…" : "Chuyển khoản ngân hàng"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
