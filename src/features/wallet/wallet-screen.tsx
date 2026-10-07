"use client";
import { useState } from "react";
import Link from "next/link";
import { EmptyState, PageHeader, SectionHeader } from "@/components/ui";
import { WalletCard, CoinBalanceCard, TransactionItem } from "@/components/finance";

import type { WalletLedgerEntry } from "@/domain/models";
export function WalletScreen({
  history = false,
  balance,
  available,
  coins,
  transactions,
}: {
  history?: boolean;
  balance: number;
  available: number;
  coins: number;
  transactions: WalletLedgerEntry[];
}) {
  const [filter, setFilter] = useState("");
  const visible = transactions.filter((tx) => !filter || tx.kind === filter);
  const error = "";
  return (
    <>
      <PageHeader title={history ? "Lịch sử giao dịch" : "Ví"} back={history ? "/wallet" : "/"} />
      <div className="content wallet-content">
        {!history ? (
          <>
            <WalletCard balance={balance} />
            <CoinBalanceCard balance={coins} compact />
            <div className="wallet-actions">
              <button className="button primary" disabled>
                Nạp tiền
              </button>
              <button className="button secondary" disabled>
                Rút tiền
              </button>
            </div>
            <SectionHeader title="Giao dịch gần đây" href="/wallet/history" />
          </>
        ) : (
          <>
            <div className="mini-balance">
              <p>Số dư khả dụng</p>
              <strong>{available.toLocaleString("vi-VN")} đ</strong>
            </div>
            <div className="genres">
              {[
                ["", "Tất cả"],
                ["DEPOSIT", "Nạp tiền"],
                ["WITHDRAWAL", "Rút tiền"],
                ["VIP_PAYMENT", "VIP"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={`genre-chip ${filter === value ? "active" : ""}`}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="demo-note">Nạp/rút tiền đang hoàn thiện.</p>
        {!visible.length ? (
          <EmptyState title="Chưa có giao dịch" body="Lịch sử giao dịch sẽ xuất hiện tại đây." />
        ) : null}
        <div className="transaction-list">
          {visible.map((transaction) => (
            <TransactionItem key={transaction.id} transaction={transaction} />
          ))}
        </div>
      </div>
    </>
  );
}
