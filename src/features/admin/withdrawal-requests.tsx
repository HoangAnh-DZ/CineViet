"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { WithdrawalPage } from "@/server/dashboard";
import type { MoneyKind } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { DashboardHeading, TransactionsTable } from "./dashboard-screen";
import { MoneyReview } from "./money-review";
import { PaymentOperations } from "./payment-operations";

export function WithdrawalRequests({
  data,
  initialReview,
}: {
  data: WithdrawalPage;
  initialReview?: { kind: MoneyKind; id: string } | null;
}) {
  const [review, setReview] = useState(initialReview || null);
  const router = useRouter();
  useEffect(() => {
    function refresh() {
      if (document.visibilityState === "visible") router.refresh();
    }
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  function pageUrl(page: number) {
    const query = new URLSearchParams({ view: "withdrawals", ...data.filters, page: String(page) });
    return `/admin?${query}`;
  }
  return (
    <>
      <DashboardHeading title="Rút tiền" description="Yêu cầu đổi xu và rút VND của người dùng." />
      <section className="finance-context-grid" aria-label="Thống kê yêu cầu rút tiền">
        <article>
          <span>Tổng lệnh</span>
          <strong>{data.total}</strong>
        </article>
        <article>
          <span>Chờ / đang xử lý</span>
          <strong>{data.waiting}</strong>
        </article>
        <article>
          <span>Hoàn thành</span>
          <strong>{data.completed}</strong>
        </article>
        <article>
          <span>Đã chuyển thực nhận</span>
          <strong>{formatMoney(data.outgoing)}</strong>
        </article>
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading">
          <h2>Lệnh rút tiền / đổi thưởng</h2>
        </div>
        <form
          className="admin-filters finance-filters"
          action="/admin"
          key={JSON.stringify(data.filters)}
        >
          <input type="hidden" name="view" value="withdrawals" />
          <label>
            Từ ngày
            <input type="date" name="from" defaultValue={data.filters.from} />
          </label>
          <label>
            Đến ngày
            <input type="date" name="to" defaultValue={data.filters.to} />
          </label>
          <select
            aria-label="Trạng thái giao dịch"
            name="status"
            defaultValue={data.filters.status}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="PENDING">Chờ xử lý</option>
            <option value="PROCESSING">Đang xử lý</option>
            <option value="COMPLETED">Hoàn thành</option>
            <option value="REJECTED">Từ chối</option>
            <option value="FAILED">Thất bại</option>
          </select>
          <input
            name="q"
            aria-label="Người giao dịch"
            placeholder="Tên, email hoặc mã yêu cầu"
            defaultValue={data.filters.q}
          />
          <button className="button secondary">Lọc</button>
          <Link className="button secondary" href="/admin?view=withdrawals">
            Đặt lại
          </Link>
        </form>
        <TransactionsTable items={data.items} onDetail={(kind, id) => setReview({ kind, id })} />
        <nav className="admin-pagination" aria-label="Phân trang lệnh rút tiền">
          {data.page > 1 ? (
            <Link className="button secondary" href={pageUrl(data.page - 1)}>
              Trang trước
            </Link>
          ) : null}
          <span>
            Trang {data.page}/{data.pages} · {data.total} lệnh
          </span>
          {data.page < data.pages ? (
            <Link className="button secondary" href={pageUrl(data.page + 1)}>
              Trang sau
            </Link>
          ) : null}
        </nav>
      </section>
      <details>
        <summary>Cấu hình hàng đợi chuyển khoản VND</summary>
        <PaymentOperations withdrawals />
      </details>
      {review ? (
        <MoneyReview
          key={review.kind + review.id}
          {...review}
          onClose={() => {
            setReview(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
