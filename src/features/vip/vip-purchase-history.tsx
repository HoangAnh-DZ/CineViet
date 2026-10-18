"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/services/client";
import { formatDate, formatMoney } from "@/lib/format";
import { moneyStatus, type MoneyRequest, type VipBankRequest } from "@/domain/money";
import { paymentStatus } from "@/domain/payos";
import { Modal } from "@/components/ui";
export function VipPurchaseHistory({
  requests,
  onRefresh,
}: {
  requests: MoneyRequest[];
  onRefresh: () => Promise<void>;
}) {
  const [now, setNow] = useState(0),
    [cancelling, setCancelling] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<VipBankRequest | null>(null);
  const expiryChecked = useRef(new Set<string>()),
    flight = useRef(false),
    refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const expired = requests.filter(
      (r) =>
        r.status === "PENDING" &&
        r.payment_expires_at &&
        Date.parse(r.payment_expires_at) <= now &&
        !expiryChecked.current.has(r.id),
    );
    if (!expired.length) return;
    expired.forEach((r) => expiryChecked.current.add(r.id));
    void refresh.current();
  }, [requests, now]);
  async function cancel(id: string) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/vip/purchases/" + id, {
        method: "POST",
        body: JSON.stringify({ action: "cancel", confirmed: true }),
      });
      setCancelling(null);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa xác nhận được việc hủy. Hãy tải lại lệnh.");
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function show(r: MoneyRequest) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const v = await requestJson<{ request: VipBankRequest }>("/api/vip/purchases?id=" + r.id);
      setDetail(v.request);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được lệnh.");
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="vip-order-history" id="vip-order-history">
      <div className="vip-order-history-heading">
        <div>
          <h2>Lệnh nâng cấp VIP</h2>
          <p>Xem trạng thái và tiếp tục các lệnh đang chờ.</p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => void onRefresh()}
        >
          Cập nhật trạng thái
        </button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {requests.length ? (
        <div className="vip-order-list">
          {requests.map((r) => {
            const active =
                r.status === "PENDING" &&
                ["CREATING", "PENDING", "UNDERPAID", "PROCESSING"].includes(
                  r.payos_status || "PENDING",
                ),
              seconds = r.payment_expires_at
                ? Math.max(0, Math.ceil((Date.parse(r.payment_expires_at) - now) / 1000))
                : null,
              expired = seconds === 0;
            const status = r.payos_status
              ? paymentStatus(r.payos_status)
              : r.review_note === "Người dùng đã hủy lệnh"
                ? "Đã hủy"
                : moneyStatus(r.kind, r.status);
            return (
              <article className="vip-order-card" key={r.id}>
                <div className="vip-order-card-heading">
                  <strong>{r.plan_name}</strong>
                  <span className={"money-status " + (r.payos_status || r.status).toLowerCase()}>
                    {status}
                  </span>
                </div>
                <strong className="vip-order-price">{formatMoney(r.amount)}</strong>
                <span className="vip-order-time">{formatDate(r.created_at)}</span>
                <small className="vip-order-reference">
                  Mã lệnh: {r.order_code || r.payment_reference || r.id}
                </small>
                {active && seconds !== null && now > 0 ? (
                  <p className="vip-order-countdown">
                    {expired ? (
                      "Hết thời gian thanh toán · Đang đối soát"
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
                {r.review_note ? <p className="vip-order-note">{r.review_note}</p> : null}
                <div className="vip-order-actions">
                  {r.provider === "PAYOS" ? (
                    <Link
                      href={"/payments/payos/" + r.id}
                      className={"button " + (active && !expired ? "primary" : "secondary")}
                    >
                      {active && !expired ? "Tiếp tục thanh toán" : "Xem lệnh"}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void show(r)}
                    >
                      Xem lệnh
                    </button>
                  )}
                  {active &&
                  !expired &&
                  (!r.payos_status || ["CREATING", "PENDING"].includes(r.payos_status)) ? (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setCancelling(r.id);
                      }}
                    >
                      Hủy lệnh
                    </button>
                  ) : null}
                </div>
                {cancelling === r.id ? (
                  <div className="vip-cancel-confirm" role="group" aria-label="Xác nhận hủy lệnh">
                    <strong>Hủy lệnh nâng cấp này?</strong>
                    <p>Chỉ hủy khi bạn chưa chuyển tiền. Lệnh đã thanh toán sẽ được đối soát.</p>
                    <div>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setCancelling(null)}
                      >
                        Giữ lệnh
                      </button>
                      <button
                        type="button"
                        className="button primary"
                        disabled={busy}
                        aria-busy={busy}
                        onClick={() => void cancel(r.id)}
                      >
                        Xác nhận hủy lệnh
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="vip-order-empty">Bạn chưa có lệnh nâng cấp VIP.</p>
      )}
      {detail ? (
        <Modal title="Thông tin lệnh nâng cấp" onClose={() => setDetail(null)}>
          <div className="vip-manual-detail">
            <strong>
              {detail.plan_name} · {formatMoney(detail.amount)}
            </strong>
            <span>{moneyStatus(detail.kind, detail.status)}</span>
            <dl>
              <div>
                <dt>Ngân hàng</dt>
                <dd>{detail.transfer_bank.bank_name}</dd>
              </div>
              <div>
                <dt>Chủ tài khoản</dt>
                <dd>{detail.transfer_bank.account_name}</dd>
              </div>
              <div>
                <dt>Số tài khoản</dt>
                <dd>{detail.transfer_bank.account_number}</dd>
              </div>
              <div>
                <dt>Nội dung</dt>
                <dd>{detail.payment_reference}</dd>
              </div>
            </dl>
            {detail.status !== "PENDING" ? (
              <p>Lệnh này đã kết thúc. Không chuyển tiền theo nội dung cũ.</p>
            ) : (
              <p>
                Đây là lệnh chuyển khoản cũ. Nếu đã chuyển tiền, liên hệ hỗ trợ để đối soát trước
                khi tạo lệnh mới.
              </p>
            )}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
