"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/providers";
import { terminalPayment, type PayosOrder } from "@/domain/payos";
import { requestJson } from "@/services/client";

export function usePayosPayment(id: string | null, initial: PayosOrder | null = null) {
  const [order, setOrder] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [paused, setPaused] = useState(false);
  const { refreshAccount } = useApp();
  const refreshRef = useRef(refreshAccount),
    current = useRef(initial),
    active = useRef(false),
    flight = useRef<AbortController | null>(null),
    refreshed = useRef<string | null>(null);
  refreshRef.current = refreshAccount;
  const check = useCallback(async () => {
    if (!id || !active.current || flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setError("");
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    try {
      const next = await requestJson<PayosOrder>(`/api/payments/payos/${encodeURIComponent(id)}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || !active.current) return;
      current.current = next;
      setOrder(next);
    } catch {
      if ((!controller.signal.aborted || timedOut) && active.current)
        setError("Chưa cập nhật được trạng thái. Đơn vẫn được giữ; vui lòng kiểm tra lại.");
    } finally {
      window.clearTimeout(timeout);
      if (flight.current === controller) {
        flight.current = null;
        if (active.current) setBusy(false);
      }
    }
  }, [id]);
  const cancel = useCallback(async () => {
    if (!id || !active.current || flight.current || current.current?.kind !== "VIP_PURCHASE")
      return;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setError("");
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const next = await requestJson<PayosOrder>(`/api/vip/purchases/${encodeURIComponent(id)}`, {
        method: "POST",
        body: JSON.stringify({ action: "cancel", confirmed: true }),
        signal: controller.signal,
      });
      if (active.current) {
        current.current = next;
        setOrder(next);
      }
    } catch (e) {
      if (active.current)
        setError(
          e instanceof Error
            ? e.message
            : "Chưa xác nhận được việc hủy. Hãy kiểm tra lại cùng lệnh.",
        );
    } finally {
      window.clearTimeout(timeout);
      if (flight.current === controller) {
        flight.current = null;
        if (active.current) setBusy(false);
      }
    }
  }, [id]);
  useEffect(() => {
    active.current = true;
    current.current = initial;
    setOrder(initial);
    setPaused(false);
    setError("");
    const deadline = Date.now() + 30 * 60 * 1000;
    let timer: number | undefined;
    const poll = () => {
      if (!active.current || !id || terminalPayment(current.current?.status || "")) {
        window.clearInterval(timer);
        return;
      }
      const expires = current.current ? Date.parse(current.current.expires_at) + 60000 : deadline;
      if (Date.now() > Math.min(deadline, expires)) {
        setPaused(true);
        window.clearInterval(timer);
        return;
      }
      if (document.visibilityState === "visible") void check();
    };
    if (id && !terminalPayment(initial?.status || "") && document.visibilityState === "visible")
      void check();
    if (id && !terminalPayment(initial?.status || "")) timer = window.setInterval(poll, 10000);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      active.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", poll);
      flight.current?.abort();
      flight.current = null;
    };
  }, [id, initial, check]);
  useEffect(() => {
    if (!id || !order || terminalPayment(order.status)) return;
    const remaining = Date.parse(order.expires_at) - Date.now();
    // One server reconciliation at the original 30-minute deadline. The server
    // confirms provider cancellation or settles a payment already received.
    const timer = window.setTimeout(
      () => void check(),
      Math.max(0, Math.min(remaining + 50, 2147483647)),
    );
    return () => window.clearTimeout(timer);
  }, [id, order?.expires_at, order?.status, check]);
  useEffect(() => {
    if (order?.status === "PAID" && refreshed.current !== order.id) {
      refreshed.current = order.id;
      void refreshRef.current();
    }
  }, [order]);
  return { order, error, busy, paused, check, cancel };
}
