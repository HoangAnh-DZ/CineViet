"use client";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { usePayosPayment } from "./use-payos-payment";
import { PayosPaymentPanel } from "./payos-payment-panel";
import "./manual-money.css";
export function PayosStatusScreen({ id }: { id: string }) {
  const payment = usePayosPayment(id);
  const back = payment.order?.kind === "VIP_PURCHASE" ? "/vip" : "/wallet/deposit";
  return (
    <>
      <PageHeader title="Thông tin thanh toán" back={back} />
      <div className="content manual-money-content">
        <section className="payos-page-panel">
          <PayosPaymentPanel
            {...payment}
            onCheck={() => void payment.check()}
            onCancel={() => void payment.cancel()}
          />
        </section>
        <Link className="button secondary wide" href={back}>
          Lịch sử giao dịch
        </Link>
      </div>
    </>
  );
}
