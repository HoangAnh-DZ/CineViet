"use client";
import { useState, type FormEvent } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { DashboardRefresh } from "./dashboard-refresh";
import { requestJson } from "@/services/client";
import { formatMoney } from "@/lib/format";
import type { DashboardData } from "@/server/dashboard";
import type { reportingCandidates } from "@/server/financial-reporting";
export function ReportMode({ mode }: { mode: "ALL" | "BUSINESS" }) {
  const router = useRouter(),
    path = usePathname(),
    params = useSearchParams();
  return (
    <div className="money-period-heading">
      <p>Phạm vi báo cáo</p>
      <div className="dashboard-segment">
        {[
          ["ALL", "Toàn bộ"],
          ["BUSINESS", "Kinh doanh"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={mode === key}
            onClick={() => {
              const q = new URLSearchParams(params);
              q.set("mode", key);
              router.push(path + "?" + q.toString());
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
export function CashReportNotes({ data }: { data: DashboardData }) {
  return (
    <>
      <DashboardRefresh revision={data.reportRevision} reportedAt={data.reportedAt} />
      <ReportMode mode={data.reportMode} />
      <p className="chart-footnote">
        {data.reportMode === "BUSINESS"
          ? "Chỉ loại các giao dịch có xác nhận phân loại."
          : "Bao gồm cả giao dịch được xác nhận là test."}{" "}
        {data.reportQuality.excluded} giao dịch có xác nhận loại trừ. Hoàn tiền/điều chỉnh chưa có
        nguồn dữ liệu cấu trúc; số liệu không phải lợi nhuận ròng.
      </p>
      {data.reportQuality.ledger_mismatches ? (
        <p role="alert" className="form-error">
          {data.reportQuality.ledger_mismatches} giao dịch chưa khớp ledger/quyền lợi. Cần đối soát;
          số tiền nguồn được giữ nguyên.
        </p>
      ) : null}
      {data.reportQuality.unverified ? (
        <p role="alert" className="form-error">
          {data.reportQuality.unverified} giao dịch thiếu thời điểm hoặc xác nhận thanh toán, chưa
          được tính.
        </p>
      ) : null}
    </>
  );
}
export function ReportingClassification() {
  const router = useRouter(),
    [items, setItems] = useState<Awaited<ReturnType<typeof reportingCandidates>> | null>(null),
    [selected, setSelected] = useState(""),
    [decision, setDecision] = useState("TEST"),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const row = items?.find((r) => r.kind + "/" + r.id === selected);
  async function load() {
    setBusy(true);
    setError("");
    try {
      setItems(await requestJson("/api/admin/reporting"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được dữ liệu.");
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!row || !confirmed) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestJson("/api/admin/reporting", {
        method: "POST",
        body: JSON.stringify({
          target_kind: row.kind,
          target_id: row.id,
          fingerprint: row.fingerprint,
          expected_revision: row.revision,
          excluded: decision === "TEST",
          reason,
          confirmation: "CONFIRM_REPORT_ONLY",
        }),
      });
      setItems(await requestJson("/api/admin/reporting"));
      setConfirmed(false);
      setReason("");
      setMessage("Đã ghi nhận quyết định báo cáo. Số dư và trạng thái thanh toán giữ nguyên.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được phân loại.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-heading">
        <div>
          <h2>Phân loại giao dịch test</h2>
          <p>Chỉ xác nhận từng giao dịch có bằng chứng. Có thể khôi phục vào báo cáo.</p>
        </div>
        <button className="button secondary" disabled={busy} onClick={() => void load()}>
          Tải giao dịch
        </button>
      </div>
      {items ? (
        <form className="referral-form-body" onSubmit={save}>
          <label className="admin-form-field">
            <span>Giao dịch (100 lệnh mới nhất)</span>
            <select
              className="field"
              required
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                const next = items.find((r) => r.kind + "/" + r.id === e.target.value);
                setDecision(next?.excluded ? "REAL" : "TEST");
                setReason("");
                setConfirmed(false);
              }}
            >
              <option value="">Chọn giao dịch</option>
              {items.map((r) => (
                <option key={r.kind + r.id} value={r.kind + "/" + r.id}>
                  {r.id.slice(0, 8)} · {r.kind} · {formatMoney(r.amount)} · {r.status} ·{" "}
                  {r.excluded ? "Đã loại khỏi kinh doanh" : "Chưa loại"}
                </option>
              ))}
            </select>
          </label>
          {row ? (
            <div className="report-candidate-details">
              <dl>
                <div>
                  <dt>Mã / phân loại</dt>
                  <dd>
                    {row.id.slice(0, 8)} · {row.classification}
                  </dd>
                </div>
                <div>
                  <dt>Tài khoản</dt>
                  <dd>{row.masked_user}</dd>
                </div>
                <div>
                  <dt>Nguồn / trạng thái</dt>
                  <dd>
                    {row.provider} · {row.source_asset} · {row.status}
                  </dd>
                </div>
                <div>
                  <dt>Tạo lúc</dt>
                  <dd>
                    {new Date(row.created_at).toLocaleString("vi-VN", {
                      timeZone: "Asia/Ho_Chi_Minh",
                    })}
                  </dd>
                </div>
                <div>
                  <dt>Hoàn tất</dt>
                  <dd>
                    {row.completed_at
                      ? new Date(row.completed_at).toLocaleString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                        })
                      : "Chưa hoàn tất"}
                  </dd>
                </div>
                <div>
                  <dt>Gốc / phí / thực nhận</dt>
                  <dd>
                    {formatMoney(row.amount)} / {formatMoney(row.fee)} / {formatMoney(row.net)}
                  </dd>
                </div>
              </dl>
              <p className="helper">
                {row.evidence}. Trạng thái thanh toán chưa xác định giao dịch là test hay kinh
                doanh.
              </p>
              {row.confirmed_at ? (
                <p className="helper">
                  Xác nhận gần nhất: {row.confirmed_by} ·{" "}
                  {new Date(row.confirmed_at).toLocaleString("vi-VN", {
                    timeZone: "Asia/Ho_Chi_Minh",
                  })}{" "}
                  · {row.reason}
                </p>
              ) : null}
            </div>
          ) : null}
          <label className="admin-form-field">
            <span>Quyết định phân loại</span>
            <select
              className="field"
              value={decision}
              onChange={(e) => {
                setDecision(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="TEST">TEST · Loại khỏi kinh doanh</option>
              <option value="REAL">REAL · Tính trong báo cáo</option>
            </select>
          </label>
          <label className="admin-form-field">
            <span>Bằng chứng / lý do</span>
            <input
              className="field"
              required
              minLength={10}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="referral-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Tôi xác nhận đúng giao dịch và chỉ thay đổi phạm vi báo cáo.
          </label>
          <button className="button primary" disabled={busy || !row || !confirmed}>
            {busy
              ? "Đang lưu…"
              : decision === "REAL"
                ? "Xác nhận đưa vào báo cáo"
                : "Xác nhận TEST"}
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="form-error chart-footnote" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="chart-footnote" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
