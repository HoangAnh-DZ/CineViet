import { moneyStatus, type MoneyRequest } from "@/domain/money";
import { formatMoney, formatDate } from "@/lib/format";
import Link from "next/link";
import { paymentStatus } from "@/domain/payos";
export function RequestHistory({
  requests,
  title,
  neutralLegacyLabels = false,
}: {
  requests: MoneyRequest[];
  title: string;
  neutralLegacyLabels?: boolean;
}) {
  return (
    <section className="money-history" id="request-history">
      <h2>{title}</h2>
      {requests.length ? (
        requests.map((r) => (
          <article className="money-history-row" key={r.id}>
            <div>
              <strong>
                {r.source_asset === "COIN"
                  ? `${r.coins_amount?.toLocaleString("vi-VN")} xu`
                  : r.plan_name || formatMoney(r.amount)}
              </strong>
              <span className={"money-status " + r.status.toLowerCase()}>
                {r.payos_status ? paymentStatus(r.payos_status) : moneyStatus(r.kind, r.status)}
              </span>
            </div>
            <p>{formatDate(r.created_at)}</p>
            {r.provider === "PAYOS" ? (
              <Link href={`/payments/payos/${r.id}`} className="money-text-link">
                {neutralLegacyLabels
                  ? "Chuyển khoản ngân hàng · Xem trạng thái"
                  : "payOS · Xem thanh toán"}
              </Link>
            ) : null}
            {r.payment_reference ? (
              <p>
                Nội dung chuyển khoản: <code>{r.payment_reference}</code>
              </p>
            ) : null}
            {r.source_asset === "COIN" ? (
              <p>
                Phí {formatMoney(r.fee)}
                <br />
                Thực nhận {formatMoney(r.amount - r.fee)}
                <br />
                {r.bank_name} · {r.bank_account_number}
                {r.bank_account_name ? ` · ${r.bank_account_name}` : ""}
              </p>
            ) : (
              <p>{formatMoney(r.amount)}</p>
            )}
            {r.completed_at ? <p>Hoàn tất: {formatDate(r.completed_at)}</p> : null}
            {r.rejected_at ? (
              <p>
                Đã xử lý: {formatDate(r.rejected_at)}
                {r.source_asset === "COIN" ? " · Xu giữ đã được trả lại." : ""}
              </p>
            ) : null}
            {r.review_note ? <p>Lý do: {r.review_note}</p> : null}
          </article>
        ))
      ) : (
        <p className="money-history-empty">Chưa có yêu cầu.</p>
      )}
    </section>
  );
}
