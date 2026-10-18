"use client";
import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeading } from "./dashboard-screen";
import { ReportMode } from "./reporting-controls";
import { requestJson } from "@/services/client";
import { formatMoney } from "@/lib/format";
import { Modal } from "@/components/ui";
import { MAX_REFERRAL_BPS } from "@/domain/referral-policy";
import type { ReferralAdminData } from "@/server/referral-reporting";
export function ReferralsScreen({ data }: { data: ReferralAdminData }) {
  const router = useRouter(),
    [policy, setPolicy] = useState(data.policy),
    [rates, setRates] = useState(data.policy.rates_bps.map((v) => String(v / 100))),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    setPolicy(data.policy);
    setRates(data.policy.rates_bps.map((v) => String(v / 100)));
  }, [data.policy]);
  const bps = rates.map((v) => Math.round(Number(v) * 100));
  const total = bps.reduce((a, b) => a + b, 0),
    valid = rates.every(
      (v, i) =>
        /^\d+(\.\d{1,2})?$/.test(v) && Number.isSafeInteger(bps[i]) && bps[i] <= MAX_REFERRAL_BPS,
    );
  function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (valid) setConfirmed(true);
  }
  async function apply() {
    if (!confirmed || !valid || busy) return;
    setBusy(true);
    try {
      const p = await requestJson<typeof policy>("/api/admin/referrals", {
        method: "PATCH",
        body: JSON.stringify({
          expected_version: policy.version,
          rates_bps: bps,
          reason,
          confirmation: "CONFIRM_FUTURE_ORDERS",
        }),
      });
      setPolicy(p);
      setConfirmed(false);
      setReason("");
      setMessage("Đã lưu tỷ lệ hoa hồng.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được cấu hình.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DashboardHeading
        title="Giới thiệu / hoa hồng"
        description="F1/F2/F3 là khoảng cách từ người mua VIP đến từng tuyến trên."
      />
      <ReportMode mode={data.mode} />
      <form className="dashboard-panel referral-config" onSubmit={save} aria-busy={busy}>
        <div className="dashboard-panel-heading">
          <div>
            <h2>Cấu hình hoa hồng</h2>
          </div>
          <strong>Tổng: {total / 100}%</strong>
        </div>
        <fieldset disabled={busy} className="referral-form-body">
          <div className="admin-form-grid">
            {rates.map((value, i) => (
              <label key={i} className="admin-form-field">
                <span>
                  Hoa hồng F{i + 1} · {Number(value) > 0 ? "Bật" : "Chưa kích hoạt"}
                </span>
                <div className="referral-rate-input">
                  <input
                    aria-label={`Hoa hồng F${i + 1} (%)`}
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={value}
                    onChange={(e) => {
                      setRates(rates.map((v, n) => (n === i ? e.target.value : v)));
                      setConfirmed(false);
                    }}
                  />
                  <span>%</span>
                </div>
              </label>
            ))}
          </div>
          <label className="admin-form-field">
            <span>Lý do thay đổi</span>
            <input
              className="field"
              required
              minLength={10}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {!valid ? (
            <p role="alert" className="form-error">
              Nhập tỷ lệ không âm, tối đa hai chữ số thập phân và trong phạm vi lưu trữ.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          {message ? <p role="status">{message}</p> : null}
          <div className="referral-save">
            <small>
              Cập nhật: {policy.editor || "Khởi tạo hệ thống"} ·{" "}
              {new Date(policy.updated_at).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
              })}
            </small>
            <button className="button primary" disabled={!valid || busy}>
              {busy ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </div>
        </fieldset>
      </form>
      {confirmed ? (
        <Modal title="Xác nhận tỷ lệ hoa hồng" onClose={() => !busy && setConfirmed(false)}>
          <p>
            F1 {rates[0]}% · F2 {rates[1]}% · F3 {rates[2]}%
          </p>
          <p>
            <strong>
              Tổng {total / 100}%{total > 10000 ? " — vượt 100%" : ""}
            </strong>
          </p>
          <p>Áp dụng cho đơn VIP mới. Đơn đã tạo giữ tỷ lệ cũ.</p>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          <button className="button primary wide" disabled={busy} onClick={() => void apply()}>
            {busy ? "Đang lưu…" : "Xác nhận"}
          </button>
        </Modal>
      ) : null}
      <div className="dashboard-segment referral-periods">
        {[
          ["TODAY", "Hôm nay"],
          ["WEEK", "7 ngày"],
          ["MONTH", "Tháng này"],
          ["ALL", "Toàn thời gian"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={data.period === key}
            onClick={() => router.push(`/admin/referrals?mode=${data.mode}&period=${key}`)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="dashboard-metrics">
        {[
          ["Đăng ký trực tiếp", data.stats.direct],
          ["Người trong mạng lưới", data.stats.network],
          ["Lượt mua VIP có hoa hồng", data.stats.vip_events],
          ["Bản ghi hoa hồng", data.stats.records],
        ].map(([label, value]) => (
          <article className="dashboard-metric" key={label}>
            <span>{label}</span>
            <strong>{Number(value).toLocaleString("vi-VN")}</strong>
          </article>
        ))}
      </div>
      <div className="dashboard-metrics">
        {[
          ["Tổng ghi có", data.stats.total],
          ["F1", data.stats.level1],
          ["F2", data.stats.level2],
          ["F3", data.stats.level3],
        ].map(([label, value]) => (
          <article className="dashboard-metric" key={label}>
            <span>{label}</span>
            <strong>{formatMoney(Number(value))}</strong>
          </article>
        ))}
      </div>
      <p className="chart-footnote">
        Người theo khoảng cách: F1 {data.stats.f1} · F2 {data.stats.f2} · F3 {data.stats.f3}. Tổng
        mạng lưới đếm mỗi người một lần.
      </p>
      {data.stats.ledger_mismatches ? (
        <p role="alert" className="form-error">
          Có {data.stats.ledger_mismatches} bản ghi chưa khớp ledger, chưa tính là ghi có.
        </p>
      ) : null}
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading">
          <div>
            <h2>Xếp hạng người giới thiệu</h2>
          </div>
        </div>
        <div className="referral-rankings">
          {data.ranking.map((r) => (
            <article className="referral-ranking" key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <small>
                  {r.direct} đăng ký trực tiếp · {r.network} trong mạng lưới · {r.vip_events} lượt
                  VIP / {r.records} bản ghi
                </small>
              </div>
              <dl>
                {r.levels.map((v, i) => (
                  <div key={i}>
                    <dt>F{i + 1}</dt>
                    <dd>{formatMoney(v)}</dd>
                  </div>
                ))}
                <div>
                  <dt>Tổng ghi có</dt>
                  <dd>{formatMoney(r.total)}</dd>
                </div>
              </dl>
            </article>
          ))}
          {!data.ranking.length ? (
            <div className="dashboard-empty">Chưa có dữ liệu trong kỳ này.</div>
          ) : null}
        </div>
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading">
          <div>
            <h2>Lịch sử ghi có</h2>
            <p>30 bản ghi gần nhất.</p>
          </div>
        </div>
        <div className="referral-rankings">
          {data.history.map((r) => (
            <article className="referral-ranking" key={r.id}>
              <div>
                <strong>{r.beneficiary_name}</strong>
                <small>
                  Người mua: {r.buyer_name} ·{" "}
                  <a href={`/admin?kind=VIP_PURCHASE&id=${encodeURIComponent(r.source_id)}`}>
                    {r.source_id.slice(0, 8)}
                  </a>{" "}
                  ·{" "}
                  {new Date(r.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
                </small>
              </div>
              <dl>
                <div>
                  <dt>Tuyến trên</dt>
                  <dd>F{r.level}</dd>
                </div>
                <div>
                  <dt>Tỷ lệ snapshot</dt>
                  <dd>{r.bps / 100}%</dd>
                </div>
                <div>
                  <dt>Đã ghi có VND</dt>
                  <dd>{formatMoney(r.amount)}</dd>
                </div>
              </dl>
            </article>
          ))}
          {!data.history.length ? (
            <div className="dashboard-empty">Chưa có hoa hồng trong kỳ này.</div>
          ) : null}
        </div>
      </section>
    </>
  );
}
