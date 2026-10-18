"use client";
import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeading } from "./dashboard-screen";
import { ReportMode } from "./reporting-controls";
import { requestJson } from "@/services/client";
import { formatMoney } from "@/lib/format";
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
    valid =
      rates.every((v) => v !== "" && /^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100) &&
      total <= policy.cap_bps;
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!confirmed || !valid) return;
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
      setMessage("Đã lưu. Chỉ áp dụng cho đơn VIP tạo sau thời điểm này.");
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
            <p>Giới hạn đã duyệt: {policy.cap_bps / 100}%. Đơn cũ giữ tỷ lệ khi tạo.</p>
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
                    max="100"
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
          {!policy.multilevel_approved ? (
            <p className="helper">F2/F3 cần phê duyệt ngân sách trước khi bật.</p>
          ) : null}
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
          <label className="referral-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Tôi xác nhận tỷ lệ mới chỉ áp dụng cho đơn tạo sau khi lưu. Đơn đang chờ thanh toán giữ
            tỷ lệ cũ.
          </label>
          {!valid ? (
            <p role="alert" className="form-error">
              Nhập tỷ lệ hợp lệ, tổng không vượt {policy.cap_bps / 100}%.
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
            <button className="button primary" disabled={!confirmed || !valid || busy}>
              {busy ? "Đang lưu…" : "Lưu thay đổi"}
            </button>
          </div>
        </fieldset>
      </form>
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
            <p>Ví đã ghi có; chưa thể phân bổ khoản rút bên ngoài riêng cho hoa hồng.</p>
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
            <p>100 bản ghi mới nhất trong kỳ; đã đối chiếu ledger.</p>
          </div>
        </div>
        <div className="referral-rankings">
          {data.history.map((r) => (
            <article className="referral-ranking" key={r.id}>
              <div>
                <strong>{r.beneficiary_name}</strong>
                <small>
                  Người mua: {r.buyer_name} ·{" "}
                  <a
                    href={`/admin/finance?kind=VIP_PURCHASE&id=${encodeURIComponent(r.source_id)}`}
                  >
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
