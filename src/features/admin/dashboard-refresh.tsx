"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
// A lightweight revision check, not a repeated aggregation of the full report.
export function DashboardRefresh({
  revision,
  reportedAt,
}: {
  revision: string;
  reportedAt: string;
}) {
  const router = useRouter(),
    [pending, startTransition] = useTransition(),
    [error, setError] = useState("");
  const etag = useRef('"' + revision + '"'),
    lastRefresh = useRef(Date.now()),
    pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    etag.current = '"' + revision + '"';
    lastRefresh.current = Date.now();
  }, [revision, reportedAt]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined,
      controller: AbortController | undefined,
      stopped = false,
      busy = false,
      lastCheck = 0,
      failures = 0;
    function schedule(delay = 30000) {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible" && navigator.onLine)
        timer = setTimeout(check, delay);
    }
    async function check() {
      if (
        stopped ||
        busy ||
        pendingRef.current ||
        document.visibilityState !== "visible" ||
        !navigator.onLine
      ) {
        schedule();
        return;
      }
      if (Date.now() - lastCheck < 5000) {
        schedule();
        return;
      }
      busy = true;
      lastCheck = Date.now();
      controller = new AbortController();
      let delay = 30000;
      try {
        const r = await fetch("/api/admin/reporting/revision", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "If-None-Match": etag.current },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        });
        if (r.status === 401 || r.status === 403) {
          stopped = true;
          throw new Error("Phiên quản trị cần được đăng nhập lại.");
        }
        if (r.status === 429)
          delay = Math.max(30000, Number(r.headers.get("Retry-After") || 60) * 1000);
        if (r.status !== 304 && !r.ok) throw new Error("Chưa cập nhật được dữ liệu mới.");
        const changed = r.status !== 304;
        if (changed) {
          const data = await r.json();
          if (typeof data.revision !== "string")
            throw new Error("Chưa xác minh được phiên bản dữ liệu.");
          etag.current = r.headers.get("etag") || '"' + data.revision + '"';
        }
        failures = 0;
        setError("");
        // Backstop also covers rare timestamp collisions and changes to display-only fields.
        if (changed || Date.now() - lastRefresh.current >= 300000) {
          lastRefresh.current = Date.now();
          startTransition(() => router.refresh());
        }
      } catch (e) {
        if (!controller?.signal.aborted) {
          failures++;
          delay = Math.max(delay, Math.min(300000, 30000 * 2 ** failures));
          setError(e instanceof Error ? e.message : "Chưa cập nhật được dữ liệu mới.");
        }
      } finally {
        busy = false;
        controller = undefined;
        schedule(delay);
      }
    }
    function activity() {
      clearTimeout(timer);
      if (document.visibilityState === "visible" && navigator.onLine) void check();
      else controller?.abort();
    }
    schedule();
    document.addEventListener("visibilitychange", activity);
    window.addEventListener("focus", activity);
    window.addEventListener("online", activity);
    window.addEventListener("offline", activity);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", activity);
      window.removeEventListener("focus", activity);
      window.removeEventListener("online", activity);
      window.removeEventListener("offline", activity);
    };
  }, [router]);
  return (
    <div className="report-refresh">
      <span role="status">
        {pending
          ? "Đang cập nhật…"
          : error ||
            `Tự cập nhật · ${new Date(reportedAt).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`}
      </span>
      <button
        className="button secondary"
        disabled={pending}
        onClick={() => {
          setError("");
          lastRefresh.current = Date.now();
          startTransition(() => router.refresh());
        }}
      >
        Cập nhật
      </button>
    </div>
  );
}
