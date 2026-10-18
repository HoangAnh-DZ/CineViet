"use client";
import Link from "next/link";
import { Check, Clapperboard, ArrowUpRight } from "lucide-react";
import { Coin } from "@/components/ui";
import type { DailyMissionsState } from "@/domain/models";
export function DailyMissions({
  data,
  pending,
  onClaim,
}: {
  data: DailyMissionsState;
  pending: string;
  onClaim: (id: string) => void;
}) {
  return (
    <section className="daily-missions section-block" aria-labelledby="daily-missions-title">
      <div className="section-heading">
        <h2 id="daily-missions-title">Nhiệm vụ mỗi ngày</h2>
      </div>
      <div className="daily-mission-list">
        {data.missions.map((m) => {
          const unit = "giây",
            targetLabel = m.target_seconds,
            progress = Math.floor(m.watched_seconds);
          const claimed = m.status === "CLAIMED",
            available = m.status === "AVAILABLE";
          return (
            <article className={`daily-mission ${m.status.toLowerCase()}`} key={m.id}>
              <span className="daily-mission-icon" aria-hidden="true">
                {claimed ? <Check size={20} /> : <Clapperboard size={20} />}
              </span>
              <div className="daily-mission-copy">
                <h3>Xem video {targetLabel} {unit}</h3>
                <p>
                  {claimed
                    ? "Đã nhận thưởng hôm nay"
                    : available
                      ? "Đủ điều kiện nhận thưởng"
                      : `${progress}/${targetLabel} ${unit} đã xem hợp lệ`}
                </p>
                <div
                  className="daily-mission-progress"
                  role="progressbar"
                  aria-label={`Tiến độ xem ${targetLabel} ${unit}`}
                  aria-valuemin={0}
                  aria-valuemax={m.target_seconds}
                  aria-valuenow={m.watched_seconds}
                >
                  <span style={{ width: `${(100 * m.watched_seconds) / m.target_seconds}%` }} />
                </div>
              </div>
              <strong className="daily-mission-reward">
                <Coin small /> +{m.reward.toLocaleString("vi-VN")} xu
              </strong>
              {claimed ? (
                <button className="button secondary daily-mission-action" disabled>
                  <Check size={14} /> Đã nhận
                </button>
              ) : available ? (
                <button
                  className="button primary daily-mission-action"
                  aria-busy={pending === m.id}
                  disabled={Boolean(pending)}
                  onClick={() => onClaim(m.id)}
                >
                  {pending === m.id ? "Đang nhận…" : `Nhận ${m.reward.toLocaleString("vi-VN")} xu`}
                </button>
              ) : (
                <Link className="button secondary daily-mission-action" href="/explore">
                  Tiếp tục xem <ArrowUpRight size={14} />
                </Link>
              )}
            </article>
          );
        })}
      </div>
      <small className="mission-tracking-note">
        Chỉ tính thời gian phim đang phát ở tốc độ bình thường. Tạm dừng, tua và thời gian xem
        Shorts không tính vào nhiệm vụ.
      </small>
    </section>
  );
}
