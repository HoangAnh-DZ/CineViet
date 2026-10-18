"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/services/client";
import { formatMoney } from "@/lib/format";
import { queueStatus } from "@/domain/money";
import Link from "next/link";
type Snapshot = {
  control: {
    paused: boolean;
    interval_seconds: number;
    transaction_limit: number | null;
    daily_limit: number | null;
  };
  auto_enabled: boolean;
  jobs: {
    withdrawal_id: string;
    status: string;
    bank_account_number: string;
    display_name: string;
    amount: number;
    attempts: number;
    last_error_code: string | null;
    provider_id: string | null;
    bank_name: string;
    created_at: string;
  }[];
};
export function PaymentOperations({ withdrawals = false }: { withdrawals?: boolean }) {
  const [queue, setQueue] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [info, setInfo] = useState<{
      configured: boolean;
      collection_access: string;
      payout_access: string;
      auto_payout_enabled: boolean;
    } | null>(null);
  const flight = useRef(false),
    router = useRouter();
  useEffect(() => {
    let active = true;
    Promise.all([
      requestJson<typeof info>("/api/admin/payments/payos"),
      withdrawals ? requestJson<Snapshot>("/api/admin/withdrawal-queue") : Promise.resolve(null),
    ]).then(
      ([i, q]) => {
        if (active) {
          setInfo(i);
          setQueue(q);
        }
      },
      (e) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [withdrawals]);
  async function action(endpoint: string, body: unknown) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<Snapshot & { registered?: boolean }>(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (result.control) setQueue(result);
      if (result.registered) setError("Webhook đã đăng ký.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xử lý được.");
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="dashboard-panel payment-operations">
      <div className="dashboard-panel-heading">
        <div>
          <h2>{withdrawals ? "Hàng đợi rút VND" : "Thanh toán payOS"}</h2>
          <p>
            {withdrawals
              ? info?.auto_payout_enabled
                ? "API chuyển tiền tự động đã bật"
                : "Chưa cấu hình API chuyển tiền tự động · Chuyển khoản thủ công có bill xác nhận"
              : `Kênh nhận tiền: ${info?.collection_access || "Đang kiểm tra"}`}
          </p>
        </div>
      </div>
      {error ? <p role="status">{error}</p> : null}
      {withdrawals && queue ? (
        <>
          <form
            className="admin-filters"
            onSubmit={(e) => {
              e.preventDefault();
              void action("/api/admin/withdrawal-queue", {
                action: "CONTROL",
                control: queue.control,
              });
            }}
          >
            <label>
              Khoảng cách tối thiểu (giây)
              <input
                type="number"
                min={30}
                max={86400}
                value={queue.control.interval_seconds}
                onChange={(e) =>
                  setQueue({
                    ...queue,
                    control: { ...queue.control, interval_seconds: Number(e.target.value) },
                  })
                }
              />
            </label>
            <label>
              Hạn mức mỗi lệnh
              <input
                type="number"
                min={1}
                max={100000000}
                value={queue.control.transaction_limit || ""}
                placeholder="Chưa cấu hình"
                onChange={(e) =>
                  setQueue({
                    ...queue,
                    control: {
                      ...queue.control,
                      transaction_limit: e.target.value ? Number(e.target.value) : null,
                    },
                  })
                }
              />
            </label>
            <label>
              Hạn mức mỗi ngày
              <input
                type="number"
                min={1}
                value={queue.control.daily_limit || ""}
                placeholder="Chưa cấu hình"
                onChange={(e) =>
                  setQueue({
                    ...queue,
                    control: {
                      ...queue.control,
                      daily_limit: e.target.value ? Number(e.target.value) : null,
                    },
                  })
                }
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Lưu cấu hình
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy || info?.payout_access !== "AVAILABLE"}
              onClick={() => action("/api/admin/withdrawal-queue", { action: "RECONCILE" })}
            >
              Đối soát payout
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                action("/api/admin/withdrawal-queue", {
                  action: "CONTROL",
                  control: { ...queue.control, paused: !queue.control.paused },
                })
              }
            >
              {queue.control.paused ? "Tiếp tục hàng đợi" : "Tạm dừng hàng đợi"}
            </button>
          </form>
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Người dùng</th>
                  <th>Số tiền</th>
                  <th>Trạng thái</th>
                  <th>Lần thử</th>
                  <th>Provider / lỗi</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {queue.jobs.map((j) => (
                  <tr key={j.withdrawal_id}>
                    <td>
                      {j.display_name}
                      <small>
                        {j.bank_name} · {j.bank_account_number}
                      </small>
                      <small>
                        {new Date(j.created_at).toLocaleString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                        })}
                      </small>
                    </td>
                    <td>{formatMoney(Number(j.amount))}</td>
                    <td>{queueStatus(j.status)}</td>
                    <td>{j.attempts}</td>
                    <td>{j.provider_id || j.last_error_code || "—"}</td>
                    <td>
                      <Link
                        href={`/admin/finance?view=withdrawals&kind=WITHDRAWAL&id=${encodeURIComponent(j.withdrawal_id)}`}
                      >
                        Chi tiết
                      </Link>
                      {j.status === "RETRY_WAIT" ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            action("/api/admin/withdrawal-queue", {
                              action: "RETRY",
                              id: j.withdrawal_id,
                            })
                          }
                        >
                          Retry an toàn
                        </button>
                      ) : null}
                      {["QUEUED", "RETRY_WAIT"].includes(j.status) ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            action("/api/admin/withdrawal-queue", {
                              action: "MANUAL_REVIEW",
                              id: j.withdrawal_id,
                            })
                          }
                        >
                          Xử lý thủ công
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="dashboard-segment">
          <button
            disabled={busy || !info?.configured}
            onClick={() => action("/api/admin/payments/payos", { action: "REGISTER_WEBHOOK" })}
          >
            Đăng ký webhook
          </button>
          <button
            disabled={busy || !info?.configured}
            onClick={() => action("/api/admin/payments/payos", { action: "RECONCILE" })}
          >
            Đối soát payOS
          </button>
        </div>
      )}
    </section>
  );
}
