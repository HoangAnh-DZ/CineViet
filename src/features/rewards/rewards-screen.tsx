"use client";
import { useSearchParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Check, Crown, ArrowUpRight, ChevronRight, Gift } from "lucide-react";
import type { RewardsState, CheckInDay, DailyMissionsState } from "@/domain/models";
import { DailyMissions } from "./daily-missions";
import { useApp } from "@/components/providers";
import { Coin, PageHeader, SectionHeader, Skeleton, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requestJson } from "@/services/client";
import "@/features/wallet/manual-money.css";
export function DailyCheckIn({
  days,
  summary,
  calendarDate,
  pending,
  enabled,
  onClaim,
}: {
  days: CheckInDay[];
  summary?: React.ReactNode;
  calendarDate: string;
  pending: boolean;
  enabled: boolean;
  onClaim: () => void;
}) {
  const available = days.find((d) => d.status === "AVAILABLE");
  const date = calendarDate.split("-");
  return (
    <section className="panel check-in">
      <SectionHeader
        title="Điểm danh mỗi ngày"
        action={
          <small>
            Tháng {date[1]}/{date[0]} ›
          </small>
        }
      />
      {summary}
      <div className="days-grid">
        {days.map((day) => (
          <div
            key={day.day}
            className={`check-day ${day.status.toLowerCase()} ${day.day === 7 ? "milestone" : ""}`}
            aria-label={`Ngày ${day.day}, ${day.reward} xu, ${day.status === "CLAIMED" ? "đã nhận" : day.status === "AVAILABLE" ? "có thể nhận" : "chưa mở"}`}
          >
            <span>Ngày {day.day}</span>
            {day.status === "CLAIMED" ? (
              <Check size={15} className="check-icon" />
            ) : day.day === 7 ? (
              <img
                className="reward-chest"
                src="/images/reward-chest.svg"
                alt=""
                width={48}
                height={44}
              />
            ) : (
              <Coin />
            )}
            <strong>+{day.reward.toLocaleString("vi-VN")}</strong>
          </div>
        ))}
      </div>
      <button
        className="button primary wide"
        aria-busy={pending}
        disabled={pending || !available}
        onClick={onClaim}
      >
        {pending
          ? "Đang nhận xu…"
          : !enabled
            ? "Điểm danh tạm dừng"
            : available
              ? `Nhận +${available.reward.toLocaleString("vi-VN")} xu`
              : "Đã điểm danh hôm nay"}
      </button>
    </section>
  );
}
function RewardCodeRedeem({ onRedeemed }: { onRedeemed: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await requestJson<{ reward_coins: number }>("/api/rewards/codes", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      setMessage(`Đã nhận +${result.reward_coins.toLocaleString("vi-VN")} xu.`);
      setCode("");
      await onRedeemed();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Không đổi được mã.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel reward-code-panel">
      <SectionHeader title="Mã đổi thưởng" />
      <p className="helper">Nhập mã quà tặng do CineVjet phát hành.</p>
      <form onSubmit={redeem} className="reward-code-form">
        <input
          className="field"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="CVJ-XXXXXX"
          maxLength={32}
          required
        />
        <button className="button secondary" disabled={busy}>
          {busy ? "Đang đổi…" : "Đổi mã"}
        </button>
      </form>
      {message ? (
        <p className="helper" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
export function RewardsScreen({
  data: initial,
  missions: initialMissions,
}: {
  data: RewardsState;
  missions: DailyMissionsState;
}) {
  const params = useSearchParams();
  const history = params.get("view") === "history";
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [missions, setMissions] = useState(initialMissions);
  const [missionPending, setMissionPending] = useState("");
  const missionGeneration = useRef(0);
  const { refreshAccount } = useApp();
  useEffect(() => {
    setData(initial);
  }, [initial]);
  useEffect(() => {
    setMissions(initialMissions);
  }, [initialMissions]);
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      const generation = missionGeneration.current;
      try {
        const [rewards, state] = await Promise.all([
          requestJson<RewardsState>("/api/rewards"),
          history
            ? Promise.resolve(null)
            : requestJson<DailyMissionsState>("/api/rewards/missions"),
        ]);
        if (!disposed && generation === missionGeneration.current) {
          setData(rewards);
          if (state) setMissions(state);
        }
      } catch {
        /* Existing, real progress remains visible; a claim always revalidates server-side. */
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [history]);
  async function receiveMission(id: string) {
    if (missionPending) return;
    missionGeneration.current++;
    setMissionPending(id);
    setError("");
    try {
      setMissions(
        await requestJson<DailyMissionsState>("/api/rewards/missions", {
          method: "POST",
          body: JSON.stringify({ mission_id: id, calendar_date: missions.calendar_date }),
        }),
      );
      setData(await requestJson<RewardsState>("/api/rewards"));
      await refreshAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chưa nhận được xu. Vui lòng thử lại.");
      try {
        setMissions(await requestJson<DailyMissionsState>("/api/rewards/missions"));
      } catch {}
    } finally {
      missionGeneration.current++;
      setMissionPending("");
    }
  }
  async function request(method: "GET" | "POST") {
    if (pending) return;
    missionGeneration.current++;
    setPending(true);
    setError("");
    try {
      setData(await requestJson<RewardsState>("/api/rewards", { method }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Không nhận được xu.");
    } finally {
      missionGeneration.current++;
      setPending(false);
    }
  }
  return (
    <>
      {history ? (
        <PageHeader title="Lịch sử xu" back="/rewards" />
      ) : (
        <header className="rewards-heading">
          <div>
            <h1>Phần thưởng</h1>
          </div>
          <span className="rewards-heading-icon">
            <Gift size={25} />
          </span>
        </header>
      )}
      <div className="content rewards-content">
        {error ? (
          <div role="alert">
            <p className="form-error">{error}</p>
            <button className="button secondary" disabled={pending} onClick={() => request("GET")}>
              Thử lại
            </button>
          </div>
        ) : null}
        {data ? (
          <>
            <div className="reward-overview">
              <Link className="reward-history" href="/rewards?view=history">
                Lịch sử xu <ChevronRight size={14} />
              </Link>
              <Coin />
              <div className="reward-balance">
                <p>Xu khả dụng</p>
                <strong>
                  {data.wallet.available.toLocaleString("vi-VN")} <small>xu</small>
                </strong>
                {data.wallet.reserved > 0 ? (
                  <p>Đang chờ đổi: {data.wallet.reserved.toLocaleString("vi-VN")} xu</p>
                ) : null}
                <span className="reward-membership">
                  <Crown size={16} /> {data.membership?.name || "Free"}
                </span>
              </div>
              <div className="reward-actions">
                <Link className="button primary" href="/vip">
                  <Crown size={17} aria-hidden="true" />
                  Nâng cấp VIP
                </Link>
                <Link className="button secondary rewards-withdraw" href="/rewards/redeem">
                  <ArrowUpRight size={17} /> Đổi thưởng
                </Link>
              </div>
            </div>
            {history ? (
              <section className="section-block">
                <SectionHeader title="Giao dịch xu" />
                {data.ledger.length ? (
                  data.ledger.map((entry) => (
                    <div className="transaction" key={entry.id}>
                      <Coin small />
                      <div className="transaction-copy">
                        <h3>
                          {entry.reason === "EXCHANGE"
                            ? "Đổi thưởng"
                            : entry.reason.startsWith("DAILY_CHECKIN") ||
                                entry.reason === "CHECK_IN"
                              ? "Điểm danh hằng ngày"
                              : entry.reason === "MISSION"
                                ? "Nhiệm vụ xem phim"
                                : "Nhận xu"}
                        </h3>
                        <p>{formatDate(entry.created_at)}</p>
                      </div>
                      <strong className={entry.amount >= 0 ? "positive" : "negative"}>
                        {entry.amount >= 0 ? "+" : ""}
                        {entry.amount.toLocaleString("vi-VN")} xu
                      </strong>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="Chưa có giao dịch xu"
                    body="Điểm danh để bắt đầu tích lũy xu."
                  />
                )}
              </section>
            ) : (
              <>
                <DailyCheckIn
                  summary={
                    <div className="reward-cycle-summary" aria-live="polite">
                      <span className="cycle-label">CHU KỲ CỦA BẠN</span>
                      <p>
                        {data.reward_tier === "FREE"
                          ? "Điểm danh cơ bản"
                          : `Chu kỳ VIP: Ngày ${Math.max(1, Math.min(7, data.cycle!.current_day + (data.claimed_today ? 0 : 1)))}/7`}
                      </p>
                      <p>Tổng chu kỳ: {data.total.toLocaleString("vi-VN")} xu</p>
                    </div>
                  }
                  days={data.days}
                  calendarDate={data.calendar_date}
                  pending={pending}
                  enabled={data.enabled}
                  onClaim={() => request("POST")}
                />
                {missions.missions.length ? (
                  <DailyMissions
                    data={missions}
                    pending={missionPending}
                    onClaim={receiveMission}
                  />
                ) : null}
                <RewardCodeRedeem
                  onRedeemed={async () => {
                    missionGeneration.current++;
                    try {
                      setData(await requestJson<RewardsState>("/api/rewards"));
                      await refreshAccount();
                    } finally {
                      missionGeneration.current++;
                    }
                  }}
                />
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
