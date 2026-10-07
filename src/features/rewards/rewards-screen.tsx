"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, Clapperboard, MonitorPlay, Heart } from "lucide-react";
import type { RewardsSnapshot, CheckInDay } from "@/domain/models";
import { CoinBalanceCard } from "@/components/finance";
import { Coin, PageHeader, SectionHeader, Skeleton, EmptyState } from "@/components/ui";
import { useApp } from "@/components/providers";
import { formatDate } from "@/lib/format";
export function DailyCheckIn({
  days,
  calendarDate,
  pending,
  onClaim,
}: {
  days: CheckInDay[];
  calendarDate: string;
  pending: boolean;
  onClaim: () => void;
}) {
  const available = days.find((d) => d.status === "AVAILABLE");
  const date = calendarDate.split("-");
  return (
    <section className="panel check-in">
      <SectionHeader
        title="Điểm danh hằng ngày"
        action={
          <small>
            Tháng {date[1]}/{date[0]} ›
          </small>
        }
      />
      <div className="days-grid">
        {days.map((day) => (
          <div
            key={day.day}
            className={`check-day ${day.status.toLowerCase()}`}
            aria-label={`Ngày ${day.day}, ${day.reward} xu, ${day.status === "CLAIMED" ? "đã nhận" : day.status === "AVAILABLE" ? "có thể nhận" : "chưa mở"}`}
          >
            <span>Ngày {day.day}</span>
            {day.status === "CLAIMED" ? (
              <Check size={15} className="check-icon" />
            ) : (
              <Coin small={day.status === "LOCKED"} />
            )}
            <strong>+{day.reward}</strong>
          </div>
        ))}
      </div>
      <button className="button primary wide" disabled onClick={onClaim}>
        Đang hoàn thiện
      </button>
    </section>
  );
}
export function MissionCard({
  title,
  description,
  reward,
  icon,
  href,
}: {
  title: string;
  description: string;
  reward: number;
  icon: "watch" | "complete" | "favorite";
  href: string;
}) {
  const Icon = icon === "watch" ? Clapperboard : icon === "complete" ? MonitorPlay : Heart;
  return (
    <Link className="mission-card" href={href}>
      <span className="mission-icon">
        <Icon size={21} />
      </span>
      <span className="mission-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </span>
      <span className="mission-reward">
        <Coin small /> +{reward} xu
      </span>
    </Link>
  );
}
export function RewardsScreen({ data }: { data: RewardsSnapshot }) {
  const params = useSearchParams();
  const history = params.get("view") === "history";
  const pending = false;
  const error = "";
  const load = () => {};
  const claim = () => {};
  return (
    <>
      <PageHeader
        title={history ? "Lịch sử xu" : "Phần thưởng"}
        back={history ? "/rewards" : "/"}
      />
      <div className="content rewards-content">
        {error ? (
          <div role="alert">
            <p className="form-error">{error}</p>
            <button className="button secondary" onClick={load}>
              Thử lại
            </button>
          </div>
        ) : null}
        {data ? (
          <>
            <CoinBalanceCard balance={data.wallet.balance} />
            {history ? (
              <section className="section-block">
                <SectionHeader title="Giao dịch xu" />
                {data.ledger.length ? (
                  data.ledger.map((entry) => (
                    <div className="transaction" key={entry.id}>
                      <Coin small />
                      <div className="transaction-copy">
                        <h3>Điểm danh hằng ngày</h3>
                        <p>{formatDate(entry.created_at)}</p>
                      </div>
                      <strong className="positive">+{entry.amount} xu</strong>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="Chưa có giao dịch xu"
                    body="Phần thưởng đang hoàn thiện; chưa phát xu."
                  />
                )}
              </section>
            ) : (
              <>
                <DailyCheckIn
                  days={data.days}
                  calendarDate={data.calendar_date}
                  pending={pending}
                  onClaim={claim}
                />
                <section className="section-block">
                  <SectionHeader title="Nhiệm vụ" href="/rewards?view=missions" />
                  <MissionCard
                    title="Xem phim hôm nay"
                    description="Xem ít nhất 30 phút"
                    reward={20}
                    icon="watch"
                    href="/explore"
                  />
                  <MissionCard
                    title="Hoàn thành 1 tập phim"
                    description="Bất kỳ bộ phim nào"
                    reward={30}
                    icon="complete"
                    href="/explore?genre=Phim%20bộ"
                  />
                  <MissionCard
                    title="Thêm phim vào yêu thích"
                    description="Thêm 1 phim"
                    reward={10}
                    icon="favorite"
                    href="/explore"
                  />
                </section>
                <p className="demo-note">
                  Điểm danh và nhiệm vụ đang hoàn thiện. Mức thưởng dự kiến; chưa phát xu.
                </p>
              </>
            )}
          </>
        ) : !error ? (
          <>
            <Skeleton className="skeleton-hero" />
            <Skeleton className="skeleton-hero" />
          </>
        ) : null}
      </div>
    </>
  );
}
