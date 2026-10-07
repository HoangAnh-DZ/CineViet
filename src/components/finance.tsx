"use client";
import Link from "next/link";
import {
  Wallet,
  ChevronRight,
  Banknote,
  Crown,
  ArrowDownToLine,
  ArrowUpFromLine,
  Gem,
  CreditCard,
  ShieldCheck,
} from "lucide-react";
import type { WalletLedgerEntry, PaymentMethod } from "@/domain/models";
import { formatMoney, formatDate } from "@/lib/format";
import { Coin } from "./ui";
export function WalletCard({ balance }: { balance: number }) {
  return (
    <div className="balance-card">
      <p>Số dư</p>
      <strong>{formatMoney(balance)}</strong>
      <Wallet className="balance-watermark" size={80} fill="currentColor" />
    </div>
  );
}
export function CoinBalanceCard({
  balance,
  compact = false,
}: {
  balance: number;
  compact?: boolean;
}) {
  return compact ? (
    <Link href="/rewards" className="coin-wallet-row">
      <Coin />
      <div>
        <p>Xu của bạn</p>
        <strong>{balance.toLocaleString("vi-VN")} xu</strong>
      </div>
      <ChevronRight size={17} />
    </Link>
  ) : (
    <div className="balance-card coin-balance-card">
      <Coin />
      <div className="coin-copy">
        <p>Xu của bạn</p>
        <strong>{balance.toLocaleString("vi-VN")} xu</strong>
      </div>
      <Link href="/rewards?view=history">Lịch sử xu ›</Link>
    </div>
  );
}
const transactionConfig = {
  DEPOSIT: { title: "Nạp tiền", icon: ArrowDownToLine, tone: "green" },
  WITHDRAWAL: { title: "Rút tiền", icon: ArrowUpFromLine, tone: "red" },
  VIP_PAYMENT: { title: "Nâng cấp VIP", icon: Crown, tone: "gold" },
  COIN_EXCHANGE: { title: "Đổi xu", icon: Gem, tone: "blue" },
};
const statuses = {
  PENDING: "Đang chờ",
  PROCESSING: "Đang xử lý",
  COMPLETED: "Thành công",
  FAILED: "Thất bại",
  REJECTED: "Từ chối",
};
export function TransactionItem({ transaction }: { transaction: WalletLedgerEntry }) {
  const config = transactionConfig[transaction.kind];
  const Icon = config.icon;
  return (
    <div className="transaction">
      <span className={`transaction-icon ${config.tone}`}>
        <Icon size={18} />
      </span>
      <div className="transaction-copy">
        <h3>{config.title}</h3>
        <p>{formatDate(transaction.created_at)}</p>
      </div>
      <div className="transaction-amount">
        <strong className={transaction.amount > 0 ? "positive" : "negative"}>
          {transaction.amount > 0 ? "+" : ""}
          {formatMoney(transaction.amount)}
        </strong>
        <p className={transaction.status === "COMPLETED" ? "success" : ""}>
          {statuses[transaction.status]}
        </p>
      </div>
    </div>
  );
}
export function PaymentMethodIcon({ method }: { method: PaymentMethod }) {
  return (
    <span className={`method-icon ${method.id}`}>
      {method.id === "momo-demo" ? (
        "mo"
      ) : method.kind === "BANK" ? (
        <ShieldCheck size={19} />
      ) : (
        <CreditCard size={19} />
      )}
    </span>
  );
}
export function MethodPicker({
  methods,
  selected,
  onChange,
}: {
  methods: PaymentMethod[];
  selected: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="method-list" role="group" aria-label="Phương thức thanh toán">
      {methods.map((method) => (
        <button
          type="button"
          className="payment-method"
          key={method.id}
          aria-pressed={method.id === selected}
          onClick={() => onChange(method.id)}
        >
          <PaymentMethodIcon method={method} />
          <span>{method.name}</span>
          {selected === method.id ? (
            <span className="radio-dot selected" />
          ) : (
            <ChevronRight size={15} />
          )}
        </button>
      ))}
    </div>
  );
}
export function BankIcon() {
  return (
    <span className="method-icon bank">
      <Banknote size={20} />
    </span>
  );
}
