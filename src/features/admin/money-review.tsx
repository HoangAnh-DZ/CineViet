"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui";
import { requestJson } from "@/services/client";
import { formatMoney, formatDate } from "@/lib/format";
import { moneyStatus, type MoneyKind } from "@/domain/money";
import type { AdminMoneyDetail } from "@/server/manual-money";
import "./money-review.css";
export function MoneyReview({
  kind,
  id,
  onClose,
}: {
  kind: MoneyKind;
  id: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AdminMoneyDetail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [reject, setReject] = useState(false),
    [failed, setFailed] = useState(false),
    [note, setNote] = useState(""),
    [reason, setReason] = useState(""),
    [large, setLarge] = useState(false);
  const [evidence, setEvidence] = useState(""),
    [proof, setProof] = useState<File | null>(null);
  const router = useRouter(),
    inFlight = useRef(false),
    endpoint = `/api/admin/money/${kind}/${encodeURIComponent(id)}`;
  useEffect(() => {
    let live = true;
    requestJson<AdminMoneyDetail>(endpoint).then(
      (d) => {
        if (live) setDetail(d);
      },
      (e) => {
        if (live) setError(e.message);
      },
    );
    return () => {
      live = false;
    };
  }, [endpoint]);
  async function accept() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await requestJson(endpoint, { method: "POST", body: JSON.stringify({ action: "PROCESS" }) });
      setDetail(await requestJson<AdminMoneyDetail>(endpoint));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tiếp nhận được yêu cầu.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      let proofId: string | undefined;
      if (kind === "WITHDRAWAL" && !reject) {
        if (!proof || !evidence.trim())
          throw new Error("Cần mã giao dịch ngân hàng và bill chuyển tiền.");
        const body = new FormData();
        body.append("bill", proof);
        const response = await fetch("/api/money/bills", { method: "POST", body });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Không tải được bill.");
        proofId = result.id;
      }
      await requestJson(endpoint, {
        method: "POST",
        body: JSON.stringify({
          action: failed
            ? "FAIL"
            : reject
              ? "REJECT"
              : kind !== "WITHDRAWAL"
                ? "APPROVE"
                : "COMPLETE",
          confirmed,
          note,
          reason,
          ...(proofId ? { evidence_reference: evidence.trim(), proof_bill_id: proofId } : {}),
          ...(kind === "VIP_PURCHASE" && !reject && evidence.trim()
            ? { evidence_reference: evidence.trim() }
            : {}),
        }),
      });
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xử lý được yêu cầu.");
      router.refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="admin-money-review">
      <Modal
        title={
          kind === "VIP_PURCHASE"
            ? "Duyệt mua VIP"
            : kind === "DEPOSIT"
              ? "Chi tiết yêu cầu nạp"
              : detail?.source_asset === "COIN"
                ? "Chi tiết đổi thưởng"
                : "Chi tiết yêu cầu rút"
        }
        onClose={() => {
          if (!busy) onClose();
        }}
      >
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {!detail ? (
          <p role="status">Đang tải yêu cầu…</p>
        ) : (
          <>
            <p className="money-review-person">
              <strong>{detail.display_name}</strong>
              <br />
              {detail.email}
              <small>
                User ID: {detail.user_id}
                <br />
                Yêu cầu: {detail.id}
              </small>
            </p>
            <dl className="admin-user-details">
              {detail.plan_name ? (
                <>
                  <dt>Gói VIP</dt>
                  <dd>{detail.plan_name}</dd>
                </>
              ) : null}
              {detail.source_asset === "COIN" ? (
                <>
                  <dt>Xu đổi</dt>
                  <dd>{detail.coins_amount?.toLocaleString("vi-VN")} xu</dd>
                  <dt>Tỷ lệ</dt>
                  <dd>1 xu = {formatMoney(detail.coin_value_vnd!)}</dd>
                </>
              ) : null}
              <dt>Số tiền</dt>
              <dd>{formatMoney(detail.amount)}</dd>
              <dt>Trạng thái</dt>
              <dd>{moneyStatus(kind, detail.status)}</dd>
              {detail.payment_reference ? (
                <>
                  <dt>Nội dung chuyển khoản</dt>
                  <dd>{detail.payment_reference}</dd>
                </>
              ) : null}
              {detail.bank_evidence_reference ? (
                <>
                  <dt>Mã giao dịch đã đối soát</dt>
                  <dd>{detail.bank_evidence_reference}</dd>
                </>
              ) : null}
              <dt>Ngày tạo</dt>
              <dd>{formatDate(detail.created_at)}</dd>
              <dt>Ngân hàng</dt>
              <dd>{detail.bank_name || "Chưa có"}</dd>
              <dt>Tài khoản</dt>
              <dd>{detail.bank_account_number || "Chưa có"}</dd>
              <dt>Chủ tài khoản</dt>
              <dd>{detail.bank_account_name || "Chưa có"}</dd>
              {kind === "WITHDRAWAL" ? (
                <>
                  <dt>Phí</dt>
                  <dd>{formatMoney(detail.fee)}</dd>
                  <dt>Cần chuyển</dt>
                  <dd>{formatMoney(detail.amount - detail.fee)}</dd>
                </>
              ) : null}
              {detail.completed_at ? (
                <>
                  <dt>Hoàn tất</dt>
                  <dd>{formatDate(detail.completed_at)}</dd>
                </>
              ) : null}
              {detail.rejected_at ? (
                <>
                  <dt>{detail.status === "FAILED" ? "Thất bại" : "Từ chối"}</dt>
                  <dd>{formatDate(detail.rejected_at)}</dd>
                </>
              ) : null}
            </dl>
            {detail.user_note ? <p>Ghi chú của người dùng: {detail.user_note}</p> : null}
            {detail.review_note ? <p>Lý do xử lý: {detail.review_note}</p> : null}
            {detail.bill_url ? (
              <button
                className={"money-bill-view " + (large ? "expanded" : "")}
                onClick={() => setLarge((v) => !v)}
                aria-label={large ? "Thu nhỏ bill" : "Xem bill lớn"}
              >
                <img src={detail.bill_url} alt="Bill chuyển khoản" />
                <span>{large ? "Thu nhỏ ảnh" : "Bấm để xem ảnh lớn"}</span>
              </button>
            ) : null}
            {detail.transfer_evidence ? (
              <p>
                Mã chuyển tiền: {detail.transfer_evidence.evidence_reference} ·{" "}
                <a href={detail.transfer_evidence.evidence_url} target="_blank" rel="noreferrer">
                  Xem bill chuyển tiền
                </a>
              </p>
            ) : null}
            {detail.audit ? (
              <p className="money-audit-stamp">
                {detail.audit.action} · {detail.audit.admin_email}
                <br />
                {formatDate(detail.audit.created_at)}
                {detail.audit.note ? (
                  <>
                    <br />
                    Ghi chú nội bộ: {detail.audit.note}
                  </>
                ) : null}
              </p>
            ) : null}
            {detail.provider === "PAYOS" ? (
              <p>
                payOS · Mã đơn: {detail.order_code} · {detail.payos_status}
              </p>
            ) : null}
            {detail.queue_status ? (
              <p>
                Hàng đợi: {detail.queue_status} · Số lần xử lý: {detail.queue_attempts}{" "}
                {detail.queue_error ? `· ${detail.queue_error}` : ""}
              </p>
            ) : null}
            {detail.events?.length ? (
              <details>
                <summary>Nhật ký xử lý</summary>
                {detail.events.map((e, i) => (
                  <p key={i}>
                    {formatDate(e.created_at)} · {e.action} {e.note}
                  </p>
                ))}
              </details>
            ) : null}
            {kind === "WITHDRAWAL" &&
            detail.status === "PENDING" &&
            (!detail.queue_status ||
              ["MANUAL_REVIEW", "QUEUED", "RETRY_WAIT"].includes(detail.queue_status)) ? (
              <button className="button secondary" disabled={busy} onClick={accept}>
                {busy ? "Đang tiếp nhận…" : "Tiếp nhận xử lý"}
              </button>
            ) : null}
            {["PENDING", ...(kind === "WITHDRAWAL" ? ["PROCESSING"] : [])].includes(
              detail.status,
            ) &&
            detail.provider !== "PAYOS" &&
            (!detail.queue_status ||
              ["MANUAL_REVIEW", "QUEUED", "RETRY_WAIT"].includes(detail.queue_status)) ? (
              <form className="money-review-form" onSubmit={submit}>
                <div className="dashboard-segment">
                  <button
                    type="button"
                    aria-pressed={!reject}
                    disabled={busy}
                    onClick={() => {
                      setReject(false);
                      setFailed(false);
                    }}
                  >
                    {kind === "VIP_PURCHASE"
                      ? "Duyệt VIP"
                      : kind === "DEPOSIT"
                        ? "Duyệt nạp"
                        : "Đã chuyển tiền"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={reject && !failed}
                    disabled={busy}
                    onClick={() => {
                      setReject(true);
                      setFailed(false);
                    }}
                  >
                    Từ chối
                  </button>
                  {detail.source_asset === "COIN" ? (
                    <button
                      type="button"
                      aria-pressed={failed}
                      disabled={busy}
                      onClick={() => {
                        setReject(true);
                        setFailed(true);
                      }}
                    >
                      Thất bại
                    </button>
                  ) : null}
                </div>
                <p className="money-review-warning">
                  {reject
                    ? kind === "VIP_PURCHASE"
                      ? "Không cấp VIP. Nếu đã nhận tiền, xử lý hoàn tiền ngân hàng thủ công."
                      : detail.source_asset === "COIN"
                        ? "Xu đang giữ sẽ được trả lại đúng một lần."
                        : kind === "DEPOSIT"
                          ? "Từ chối yêu cầu này sẽ không cộng tiền vào ví."
                          : "Từ chối sẽ giải phóng khoản tiền đang giữ về số dư khả dụng."
                    : kind !== "WITHDRAWAL"
                      ? "Chỉ duyệt sau khi đã kiểm tra tiền thực nhận trong tài khoản ngân hàng. Bill không tự chứng minh giao dịch đã thành công."
                      : `Chuyển thủ công ${formatMoney(detail.amount - detail.fee)} tới đúng tài khoản trên trước khi xác nhận. Hệ thống không tự chuyển khoản.`}
                </p>
                {!reject ? (
                  <label className="money-review-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    {kind !== "WITHDRAWAL"
                      ? "Tôi xác nhận đã kiểm tra tiền thực nhận"
                      : "Tôi xác nhận đã chuyển tiền"}
                  </label>
                ) : (
                  <label>
                    Lý do gửi người dùng
                    <textarea
                      maxLength={300}
                      required={kind === "VIP_PURCHASE" || detail.source_asset === "COIN"}
                      value={reason}
                      disabled={busy}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  Ghi chú nội bộ (không hiển thị cho người dùng)
                  <textarea
                    maxLength={500}
                    value={note}
                    disabled={busy}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                {kind === "WITHDRAWAL" && !reject ? (
                  <>
                    <label>
                      Mã giao dịch ngân hàng
                      <input
                        className="field"
                        required
                        maxLength={120}
                        value={evidence}
                        onChange={(e) => setEvidence(e.target.value)}
                      />
                    </label>
                    <label>
                      Bill chuyển tiền
                      <input
                        type="file"
                        required
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => setProof(e.target.files?.[0] || null)}
                      />
                    </label>
                  </>
                ) : null}
                {kind === "VIP_PURCHASE" && detail.payment_reference && !reject ? (
                  <label>
                    Mã giao dịch ngân hàng đã đối soát
                    <input
                      className="field"
                      required
                      minLength={4}
                      maxLength={120}
                      value={evidence}
                      onChange={(e) => setEvidence(e.target.value)}
                    />
                  </label>
                ) : null}
                <button className="button primary wide" disabled={busy || (!reject && !confirmed)}>
                  {busy
                    ? "Đang xử lý…"
                    : reject
                      ? failed
                        ? "Xác nhận thất bại"
                        : "Xác nhận từ chối"
                      : kind === "VIP_PURCHASE"
                        ? "Xác nhận duyệt VIP"
                        : kind === "DEPOSIT"
                          ? "Xác nhận duyệt nạp"
                          : "Xác nhận đã chuyển tiền"}
                </button>
              </form>
            ) : null}
          </>
        )}
      </Modal>
    </div>
  );
}
