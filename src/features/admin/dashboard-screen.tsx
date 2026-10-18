"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Users,
  TrendingUp,
  ArrowRight,
  Clapperboard,
  Gift,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import type { DashboardData } from "@/server/dashboard";
import { formatMoney } from "@/lib/format";
import { MoneyReview } from "./money-review";
import type { MoneyKind } from "@/domain/money";
import { PaymentOperations } from "./payment-operations";
import { paymentStatus } from "@/domain/payos";
export function DashboardHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="dashboard-heading">
      <div>
        <p>QUẢN TRỊ</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {action}
    </header>
  );
}
export function MetricCards({
  data,
  periods,
}: {
  data: DashboardData["metrics"];
  periods?: DashboardData["moneyPeriods"];
}) {
  const [period, setPeriod] = useState("ALL");
  const names: Record<string, string> = {
    TODAY: "Hôm nay",
    WEEK: "7 ngày",
    MONTH: "Tháng này",
    ALL: "Toàn thời gian",
  };
  const totals = periods?.find((p) => p.period === period) || data;
  return (
    <>
      {periods ? (
        <div className="money-period-heading">
          <p>Tổng tiền từ giao dịch đã hoàn tất</p>
          <div className="dashboard-segment">
            {Object.entries(names).map(([id, label]) => (
              <button key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="dashboard-metrics">
        {[
          {
            label: "Tiền vào",
            value: formatMoney(totals.income),
            Icon: ArrowDownLeft,
            tone: "mint",
            note: "Nạp tiền và mua VIP đã duyệt",
          },
          {
            label: "Tiền ra",
            value: formatMoney(totals.outgoing),
            Icon: ArrowUpRight,
            tone: "rose",
            note: "Rút tiền thực nhận",
          },
          {
            label: "Tổng lãi",
            value: formatMoney(totals.profit),
            Icon: TrendingUp,
            tone: "gold",
            note: "Thu − chi, trước chi phí vận hành",
          },
          {
            label: "Tổng người dùng",
            value: data.users.toLocaleString("vi-VN"),
            Icon: Users,
            tone: "blue",
            note: "Tài khoản đã đăng ký",
          },
        ].map(({ label, value, Icon, tone, note }) => (
          <article key={label} className="dashboard-metric">
            <div>
              <span>{label}</span>
              <i className={`metric-icon ${tone}`}>
                <Icon size={20} />
              </i>
            </div>
            <strong>{value}</strong>
            <small>
              {note} · {label === "Tổng người dùng" ? "Toàn thời gian" : names[period]}
            </small>
          </article>
        ))}
      </div>
    </>
  );
}
export function MoneyChart({
  data,
  monthlyData,
}: {
  data: DashboardData["chart"];
  monthlyData: DashboardData["monthlyChart"];
}) {
  const [mode, setMode] = useState("30");
  const daily = mode === "7" || mode === "30";
  const period =
    mode === "7" ? "7 ngày" : mode === "30" ? "30 ngày" : mode === "3" ? "3 tháng" : "1 năm";
  const points = daily
      ? data.slice(mode === "7" ? -7 : -30)
      : monthlyData.slice(mode === "3" ? -3 : -12),
    values = points.flatMap((r) => [r.income, r.outgoing, r.profit]);
  const lo = Math.min(0, ...values),
    hi = Math.max(1, ...values),
    range = hi - lo;
  const path = (key: "income" | "outgoing" | "profit") =>
    points
      .map(
        (r, i) =>
          `${72 + (i * 660) / Math.max(1, points.length - 1)},${210 - ((r[key] - lo) * 160) / range}`,
      )
      .join(" ");
  const total = values.some((v) => v !== 0);
  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-heading">
        <div>
          <h2>Biến động dòng tiền</h2>
          <p>{period} gần nhất · Giao dịch đã hoàn tất</p>
        </div>
        <div className="dashboard-segment">
          {[
            ["7", "7 ngày"],
            ["30", "30 ngày"],
            ["3", "3 tháng"],
            ["12", "1 năm"],
          ].map(([id, label]) => (
            <button key={id} aria-pressed={mode === id} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-legend">
        <span className="mint">● Tiền vào</span>
        <span className="rose">● Tiền ra</span>
        <span className="gold">● Chênh lệch thu − chi</span>
      </div>
      <svg
        className="money-chart"
        viewBox="0 0 770 250"
        role="img"
        aria-label="Biểu đồ tiền vào, tiền ra và chênh lệch thu chi từ giao dịch thật"
      >
        <title>{`Dòng tiền ${period} gần nhất`}</title>
        {[50, 90, 130, 170, 210].map((y) => (
          <g key={y}>
            <line x1="72" x2="740" y1={y} y2={y} stroke="currentColor" strokeOpacity=".1" />
            <text x="60" y={y + 4} textAnchor="end" fill="#92a2b4" fontSize="11">
              {new Intl.NumberFormat("vi-VN", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(hi - ((y - 50) / 160) * range)}
            </text>
          </g>
        ))}
        <polyline
          className="mint"
          points={path("income")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <polyline
          className="rose"
          points={path("outgoing")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <polyline
          className="gold"
          points={path("profit")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        {points.map((r, i) => (
          <circle
            key={r.day}
            cx={72 + (i * 660) / Math.max(1, points.length - 1)}
            cy={210 - ((r.income - lo) * 160) / range}
            r="9"
            fill="transparent"
          >
            <title>{`${r.day}: Tiền vào ${formatMoney(r.income)}, tiền ra ${formatMoney(r.outgoing)}, chênh lệch ${formatMoney(r.profit)}`}</title>
          </circle>
        ))}
        {points
          .filter(
            (_, i) => i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2),
          )
          .map((r) => (
            <text
              key={r.day}
              x={72 + (points.indexOf(r) * 660) / Math.max(1, points.length - 1)}
              y="240"
              textAnchor={
                points.indexOf(r) === 0
                  ? "start"
                  : points.indexOf(r) === points.length - 1
                    ? "end"
                    : "middle"
              }
              fill="#92a2b4"
              fontSize="12"
            >
              {r.day.slice(daily ? 5 : 0)}
            </text>
          ))}
      </svg>
      {!total ? (
        <p className="chart-zero">
          <CheckCircle2 size={15} />
          Chưa có giao dịch thu/chi hoàn tất trong giai đoạn này.
        </p>
      ) : null}
      <p className="chart-footnote">
        Chênh lệch thu − chi chưa bao gồm chi phí vận hành và không thay thế báo cáo kế toán.
      </p>
    </section>
  );
}
export function TransactionsTable({
  items,
  onDetail,
}: {
  items: DashboardData["transactions"];
  onDetail?: (kind: MoneyKind, id: string) => void;
}) {
  const names: Record<string, string> = {
    COMPLETED: "Hoàn tất",
    PENDING: "Chờ xử lý",
    PROCESSING: "Đang xử lý",
    FAILED: "Thất bại",
    REJECTED: "Từ chối",
  };
  return (
    <div className="dashboard-table-wrap">
      <table className="dashboard-table">
        <thead>
          <tr>
            <th>Giao dịch</th>
            <th>Người dùng</th>
            <th>Số tiền</th>
            <th>Trạng thái</th>
            <th>Thời gian</th>
            <th>Bill / Ngân hàng</th>
            <th>Chi tiết</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={String(t.kind) + String(t.id)}>
              <td>
                <span className={`transaction-mark ${t.kind !== "WITHDRAWAL" ? "mint" : "rose"}`}>
                  {t.kind !== "WITHDRAWAL" ? (
                    <ArrowDownLeft size={17} />
                  ) : (
                    <ArrowUpRight size={17} />
                  )}
                </span>
                {t.kind === "VIP_PURCHASE"
                  ? "Mua VIP"
                  : t.kind === "DEPOSIT"
                    ? "Nạp tiền"
                    : t.source_asset === "COIN"
                      ? "Đổi thưởng"
                      : "Rút VND"}
                {t.plan_name ? <small>{t.plan_name}</small> : null}
                {t.kind === "WITHDRAWAL" ? <small>Mã: {t.id}</small> : null}
                {t.order_code ? <small>payOS · {t.order_code}</small> : null}
                {t.provider_reference ? <small>{t.provider_reference}</small> : null}
              </td>
              <td className="money-table-person">
                {t.display_name}
                <small>{t.email}</small>
                <small>{t.user_id}</small>
              </td>
              <td className={t.kind !== "WITHDRAWAL" ? "mint" : "rose"}>
                {t.kind !== "WITHDRAWAL" ? "+" : "−"}
                {formatMoney(t.amount)}
                {t.source_asset === "COIN" ? (
                  <small className="transaction-fee">
                    {t.coins_amount?.toLocaleString("vi-VN")} xu · 1 xu ={" "}
                    {formatMoney(t.coin_value_vnd!)}
                  </small>
                ) : null}
                {t.kind === "WITHDRAWAL" && t.fee > 0 ? (
                  <small className="transaction-fee">
                    Phí {formatMoney(t.fee)} · Thực nhận {formatMoney(t.amount - t.fee)}
                  </small>
                ) : null}
              </td>
              <td>
                <span className={`admin-badge ${t.status === "COMPLETED" ? "good" : "neutral"}`}>
                  {t.payos_status
                    ? paymentStatus(t.payos_status)
                    : names[String(t.status)] || String(t.status)}
                </span>
              </td>
              <td>
                {new Date(t.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}
              </td>
              <td className="money-table-person">
                {t.bill_url ? (
                  <button
                    className="money-table-bill money-table-detail"
                    aria-label="Xem bill"
                    onClick={() => onDetail?.(t.kind, t.id)}
                  >
                    <img src={t.bill_url} alt="Bill" />
                  </button>
                ) : null}
                <small>{t.bank_name}</small>
                <small>
                  {t.bank_account_number ? "••••" + String(t.bank_account_number).slice(-4) : ""}
                </small>
              </td>
              <td>
                {onDetail ? (
                  <button className="money-table-detail" onClick={() => onDetail(t.kind, t.id)}>
                    {t.status === "PENDING" ? "Xem / Duyệt" : "Xem chi tiết"}
                  </button>
                ) : (
                  <Link
                    className="money-table-detail"
                    href={`/admin/finance?kind=${t.kind}&id=${encodeURIComponent(t.id)}`}
                  >
                    Xem chi tiết
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length ? (
        <div className="dashboard-empty">
          <Wallet size={26} />
          <p>Chưa có giao dịch</p>
          <span>Giao dịch thực tế sẽ xuất hiện tại đây.</span>
        </div>
      ) : null}
    </div>
  );
}
export function OverviewScreen({ data }: { data: DashboardData }) {
  return (
    <>
      <DashboardHeading
        title="Tổng quan"
        description="Tình hình nền tảng, nội dung và dòng tiền tại một nơi."
        action={
          <Link className="button primary" href="/admin/videos">
            <Clapperboard size={17} />
            Quản lý video
          </Link>
        }
      />
      <MetricCards data={data.metrics} periods={data.moneyPeriods} />
      <div className="dashboard-overview-grid">
        <MoneyChart data={data.chart} monthlyData={data.monthlyChart} />
        <section className="dashboard-panel">
          <div className="dashboard-panel-heading">
            <div>
              <h2>Người dùng mới</h2>
              <p>Thành viên tham gia gần đây</p>
            </div>
            <Link href="/admin/users">
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="new-users">
            {data.users.map((u) => (
              <div key={String(u.id)}>
                <span className="user-monogram">
                  {String(u.display_name).slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{String(u.display_name)}</strong>
                  <small>{String(u.email)}</small>
                </div>
                <span>{String(u.created_at).slice(5, 10)}</span>
              </div>
            ))}
          </div>
          <div className="dashboard-content-count">
            <Clapperboard size={19} />
            <span>Phim đang phát hành</span>
            <strong>{data.metrics.movies}</strong>
          </div>
          <Link href="/admin/rewards" className="dashboard-reward-link">
            <Gift size={18} />
            Theo dõi phần thưởng
            <ArrowRight size={16} />
          </Link>
        </section>
      </div>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading">
          <div>
            <h2>Giao dịch gần đây</h2>
            <p>Theo dõi trạng thái thu và chi</p>
          </div>
          <Link href="/admin/finance">
            Xem tất cả
            <ArrowRight size={15} />
          </Link>
        </div>
        <TransactionsTable items={data.transactions} />
      </section>
    </>
  );
}
export function FinanceScreen({
  data,
  transactions,
  initialReview,
  initialFilter,
}: {
  data: DashboardData;
  transactions: DashboardData["transactions"];
  initialReview?: { kind: MoneyKind; id: string } | null;
  initialFilter?: string;
}) {
  const [review, setReview] = useState(initialReview || null);
  const [filter, setFilter] = useState(initialFilter || "ALL"),
    [status, setStatus] = useState(""),
    [user, setUser] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const scopedFilter =
    initialFilter === "INCOMING"
      ? "INCOMING"
      : initialFilter === "WITHDRAWAL"
        ? "WITHDRAWAL"
        : null;
  useEffect(() => {
    setFilter(scopedFilter || initialFilter || "ALL");
    setStatus("");
    setUser("");
    setFrom("");
    setTo("");
  }, [initialFilter, scopedFilter]);
  const activeFilter = scopedFilter || filter;
  const visible = transactions.filter(
    (t) =>
      (activeFilter === "ALL" ||
        (activeFilter === "INCOMING"
          ? t.kind === "DEPOSIT" || t.kind === "VIP_PURCHASE"
          : activeFilter === "REDEMPTION"
            ? t.kind === "WITHDRAWAL" && t.source_asset === "COIN"
            : activeFilter === "WITHDRAWAL"
              ? t.kind === "WITHDRAWAL"
              : t.kind === activeFilter)) &&
      (!status || t.status === status) &&
      (!user || `${t.display_name} ${t.email}`.toLowerCase().includes(user.toLowerCase())) &&
      (!from || t.created_at.slice(0, 10) >= from) &&
      (!to || t.created_at.slice(0, 10) <= to),
  );
  const income = visible
      .filter((t) => t.kind !== "WITHDRAWAL" && t.status === "COMPLETED")
      .reduce((n, t) => n + t.amount, 0),
    outgoing = visible
      .filter((t) => t.kind === "WITHDRAWAL" && t.status === "COMPLETED")
      .reduce((n, t) => n + t.amount - t.fee, 0);
  const isDepositView =
      activeFilter === "INCOMING" || activeFilter === "DEPOSIT" || activeFilter === "VIP_PURCHASE",
    isWithdrawalView = activeFilter === "WITHDRAWAL",
    contextTitle = isDepositView ? "Nạp tiền" : isWithdrawalView ? "Rút tiền" : "Kinh tế",
    contextDescription = isDepositView
      ? "Quản lý lệnh nạp tiền và theo dõi dòng tiền vào."
      : isWithdrawalView
        ? "Quản lý lệnh rút tiền và theo dõi dòng tiền ra."
        : "Tổng hợp doanh thu, chi phí và lợi nhuận của nền tảng.",
    completed = visible.filter((t) => t.status === "COMPLETED"),
    waiting = visible.filter((t) => ["PENDING", "PROCESSING"].includes(t.status)),
    scopedTotal = completed.reduce(
      (sum, t) => sum + (t.kind === "WITHDRAWAL" ? t.amount - t.fee : t.amount),
      0,
    );
  return (
    <>
      <DashboardHeading title={contextTitle} description={contextDescription} />
      {scopedFilter ? <PaymentOperations withdrawals={isWithdrawalView} /> : null}
      {activeFilter === "ALL" ? (
        <MetricCards data={data.metrics} periods={data.moneyPeriods} />
      ) : (
        <section className="finance-context-grid" aria-label={`Thống kê ${contextTitle}`}>
          <article>
            <span>Tổng lệnh</span>
            <strong>{visible.length}</strong>
            <small>Trong 100 giao dịch mới nhất</small>
          </article>
          <article>
            <span>Chờ xử lý</span>
            <strong>{waiting.length}</strong>
            <small>Cần kiểm tra hoặc duyệt</small>
          </article>
          <article>
            <span>Đã hoàn tất</span>
            <strong>{completed.length}</strong>
            <small>Giao dịch thành công</small>
          </article>
          <article>
            <span>{isDepositView ? "Tiền vào" : "Tiền ra thực nhận"}</span>
            <strong>{formatMoney(scopedTotal)}</strong>
            <small>Tổng lệnh đã hoàn tất</small>
          </article>
        </section>
      )}
      {activeFilter === "ALL" ? (
        <MoneyChart data={data.chart} monthlyData={data.monthlyChart} />
      ) : null}
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading">
          <div>
            <h2>
              {isDepositView
                ? "Lệnh nạp VND / mua VIP"
                : isWithdrawalView
                  ? "Lệnh rút tiền"
                  : "Lịch sử giao dịch"}
            </h2>
            <p>
              {isDepositView
                ? "payOS tự xác nhận. Bill cũ vẫn được kiểm tra riêng."
                : isWithdrawalView
                  ? "Kiểm tra người nhận, phí và trạng thái chi tiền."
                  : "Theo dõi toàn bộ giao dịch thu và chi."}
            </p>
          </div>
          {scopedFilter ? (
            <span className="finance-scope-label">
              {isDepositView ? "Chỉ nạp VND và mua VIP" : "Rút VND và đổi xu"}
            </span>
          ) : (
            <div className="dashboard-segment">
              {[
                ["ALL", "Tất cả"],
                ["DEPOSIT", "Nạp"],
                ["VIP_PURCHASE", "VIP"],
                ["WITHDRAWAL", "Rút tiền"],
                ["REDEMPTION", "Đổi thưởng"],
              ].map(([id, label]) => (
                <button key={id} aria-pressed={activeFilter === id} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="admin-filters finance-filters">
          <label>
            Từ ngày
            <input
              type="date"
              aria-label="Từ ngày"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Đến ngày
            <input
              type="date"
              aria-label="Đến ngày"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <select
            aria-label="Trạng thái giao dịch"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            {[
              ["COMPLETED", "Hoàn tất"],
              ["PENDING", "Chờ xử lý"],
              ["PROCESSING", "Đang xử lý"],
              ["FAILED", "Thất bại"],
              ["REJECTED", "Từ chối"],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            aria-label="Người giao dịch"
            placeholder="Tên hoặc email người dùng"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
          <button
            className="button secondary"
            onClick={() => {
              setFilter(scopedFilter || "ALL");
              setStatus("");
              setUser("");
              setFrom("");
              setTo("");
            }}
          >
            Đặt lại
          </button>
        </div>
        <div className="finance-summary">
          {isDepositView ? (
            <span>
              Tiền vào <strong>{formatMoney(income)}</strong>
            </span>
          ) : isWithdrawalView ? (
            <span>
              Tiền ra thực nhận <strong>{formatMoney(outgoing)}</strong>
            </span>
          ) : (
            <>
              <span>
                Tiền vào <strong>{formatMoney(income)}</strong>
              </span>
              <span>
                Tiền ra <strong>{formatMoney(outgoing)}</strong>
              </span>
              <span>
                Thu − chi <strong>{formatMoney(income - outgoing)}</strong>
              </span>
            </>
          )}
        </div>
        <p className="chart-footnote">
          {visible.length} lệnh trong tối đa 100 giao dịch mới nhất · Tổng chỉ tính lệnh hoàn tất.
        </p>
        <TransactionsTable items={visible} onDetail={(kind, id) => setReview({ kind, id })} />
      </section>
      {review ? (
        <MoneyReview key={review.kind + review.id} {...review} onClose={() => setReview(null)} />
      ) : null}
    </>
  );
}
