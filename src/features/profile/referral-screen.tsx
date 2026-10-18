"use client";
import { useRef, useState } from "react";
import { Copy, Share2, Users } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requestJson } from "@/services/client";
import type { ReferralDashboard } from "@/server/referrals";
export function ReferralScreen({
  initial,
  origin,
}: {
  initial: ReferralDashboard;
  origin: string;
}) {
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState("");
  const flight = useRef(false);
  const link = `${origin}/register?ref=${encodeURIComponent(data.code)}`;
  async function load(level: number, page = 1) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      setData(await requestJson<ReferralDashboard>(`/api/referrals?level=${level}&page=${page}`));
    } catch {
      setError("Chưa tải được danh sách thành viên. Vui lòng thử lại.");
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setFeedback("Đã sao chép link giới thiệu");
    } catch {
      setFeedback("Vui lòng chọn và sao chép link.");
    }
  }
  async function share() {
    if (!navigator.share) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: "CineVjet", url: link });
    } catch {
      setFeedback("Chưa chia sẻ link.");
    }
  }
  return (
    <>
      <PageHeader title="Giới thiệu bạn bè" back="/profile" />
      <div className="content referral-content">
        <section className="referral-share product-panel">
          <h2>
            <Users size={22} /> Mời bạn cùng CineVjet
          </h2>
          <span className="helper">Mã giới thiệu</span>
          <strong className="referral-code">{data.code}</strong>
          <label className="field-label" htmlFor="referral-link">
            Link giới thiệu
          </label>
          <input id="referral-link" className="field" readOnly value={link} />
          <div className="referral-actions">
            <button className="button primary" onClick={copy}>
              <Copy size={17} />
              Copy link
            </button>
            <button className="button secondary" onClick={share}>
              <Share2 size={17} />
              Chia sẻ
            </button>
          </div>
          <span role="status" className="helper">
            {feedback}
          </span>
        </section>
        <section className="referral-statistics" aria-label="Thống kê giới thiệu">
          {[
            ["Tổng thành viên", data.stats.total],
            ["Đã nạp ví", data.stats.funded],
            ["Cấp 1", data.stats.level1],
            ["Cấp 2", data.stats.level2],
            ["Cấp 3", data.stats.level3],
          ].map(([label, value]) => (
            <div className="product-panel" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
        <section className="product-panel referral-policy">
          <div className="section-heading">
            <h2>Chính sách dự kiến</h2>
            <span className="policy-draft">Chưa áp dụng</span>
          </div>
          <div className="referral-rates">
            {data.policy.percentages.map((value, i) => (
              <div key={i}>
                <span>Cấp {i + 1}</span>
                <strong>{value}%</strong>
              </div>
            ))}
          </div>
          <p className="helper">
            Các tỷ lệ đang chờ phê duyệt chính sách. Không tự động phát sinh hoa hồng từ nạp tiền,
            mua VIP hoặc mời thành viên.
          </p>
        </section>
        <section className="product-panel referral-members">
          <h2>Thành viên</h2>
          <div className="referral-tabs" role="group" aria-label="Lọc cấp thành viên">
            {[0, 1, 2, 3].map((level) => (
              <button
                key={level}
                disabled={busy}
                aria-pressed={data.pagination.level === level}
                onClick={() => void load(level)}
              >
                {level === 0 ? "Tất cả" : `Cấp ${level}`}
              </button>
            ))}
          </div>
          {error ? (
            <p role="alert" className="form-error">
              {error}
              <button
                className="button secondary small"
                onClick={() => void load(data.pagination.level, data.pagination.page)}
              >
                Thử lại
              </button>
            </p>
          ) : null}
          <div aria-busy={busy}>
            {data.members.length ? (
              <ul className="referral-member-list">
                {data.members.map((member) => (
                  <li key={member.member_code + member.joined_at}>
                    <div>
                      <strong>{member.nickname}</strong>
                      <span>
                        #{member.member_code} · Cấp {member.level}
                      </span>
                    </div>
                    <div>
                      <span>{new Date(member.joined_at).toLocaleDateString("vi-VN")}</span>
                      <span>
                        {member.active ? "Đang hoạt động" : "Tạm ngừng"} ·{" "}
                        {member.funded ? "Đã nạp ví" : "Chưa nạp ví"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="referral-empty">
                Chưa có thành viên{data.pagination.level ? ` cấp ${data.pagination.level}` : ""}.
              </p>
            )}
          </div>
          <div className="referral-pagination">
            <button
              className="button secondary small"
              disabled={busy || data.pagination.page <= 1}
              onClick={() => void load(data.pagination.level, data.pagination.page - 1)}
            >
              Trước
            </button>
            <span>
              {data.pagination.page}/{data.pagination.pages}
            </span>
            <button
              className="button secondary small"
              disabled={busy || data.pagination.page >= data.pagination.pages}
              onClick={() => void load(data.pagination.level, data.pagination.page + 1)}
            >
              Sau
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
