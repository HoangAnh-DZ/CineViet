"use client";
import { useState } from "react";
import { CreditCard } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { BankIcon, MethodPicker } from "@/components/finance";
import { formatMoney } from "@/lib/format";
import { useApp } from "@/components/providers";
import type { PaymentMethod } from "@/domain/models";
const paymentMethods: PaymentMethod[] = [
  { id: "momo-demo", name: "Momo", kind: "E_WALLET" },
  { id: "vcb-demo", name: "Vietcombank", kind: "BANK" },
  { id: "tcb-demo", name: "Techcombank", kind: "BANK" },
  { id: "card-demo", name: "Thẻ ngân hàng", kind: "CARD" },
];

export function PaymentScreen({ withdraw = false }: { withdraw?: boolean }) {
  const [amount, setAmount] = useState(withdraw ? "" : "200000");
  const [custom, setCustom] = useState(false);
  const [method, setMethod] = useState(withdraw ? "vcb-demo" : "momo-demo");
  const [destination, setDestination] = useState("");
  const { balance } = useApp();
  const error = "";
  const quote = { fee: 0, net_amount: 0 };
  const prepare = (event: React.FormEvent) => event.preventDefault();
  return (
    <>
      <PageHeader title={withdraw ? "Rút tiền" : "Nạp tiền"} back="/wallet" />
      <div className="content finance-content">
        <div className="mini-balance">
          <p>{withdraw ? "Số dư có thể rút" : "Số dư hiện tại"}</p>
          <strong>{formatMoney(balance.available)}</strong>
        </div>
        <form onSubmit={prepare}>
          {withdraw ? (
            <>
              <label className="field-label" htmlFor="amount">
                Số tiền rút
              </label>
              <div className="amount-input">
                <input
                  id="amount"
                  className="field"
                  placeholder="Nhập số tiền rút"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                />
                <span>đ</span>
              </div>
              <p className="helper">Tối thiểu 50.000 đ</p>
            </>
          ) : (
            <>
              <label className="field-label">Chọn số tiền nạp</label>
              <div className="amount-presets">
                {[100000, 200000, 500000, 1000000, 2000000].map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={!custom && amount === String(value) ? "selected" : ""}
                    onClick={() => {
                      setAmount(String(value));
                      setCustom(false);
                    }}
                  >
                    {formatMoney(value)}
                  </button>
                ))}
                <button
                  type="button"
                  className={custom ? "selected" : ""}
                  onClick={() => {
                    setCustom(true);
                    setAmount("");
                  }}
                >
                  Khác
                </button>
              </div>
              {custom ? (
                <div className="finance-section">
                  <label className="field-label" htmlFor="amount">
                    Số tiền nạp
                  </label>
                  <input
                    id="amount"
                    className="field"
                    placeholder="Tối thiểu 50.000 đ"
                    inputMode="numeric"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              ) : null}
            </>
          )}
          <section className="finance-section">
            <label className="field-label">
              {withdraw ? "Phương thức nhận tiền" : "Phương thức thanh toán"}
            </label>
            {withdraw ? (
              <>
                <button
                  type="button"
                  className={`payment-method outlined ${method !== "momo-demo" ? "selected" : ""}`}
                  aria-pressed={method !== "momo-demo"}
                  onClick={() => setMethod("vcb-demo")}
                >
                  <BankIcon />
                  <span>
                    Ngân hàng<small>Nhận tiền qua tài khoản ngân hàng</small>
                  </span>
                  <span className={`radio-dot ${method !== "momo-demo" ? "selected" : ""}`} />
                </button>
                <button
                  type="button"
                  className={`payment-method outlined ${method === "momo-demo" ? "selected" : ""}`}
                  aria-pressed={method === "momo-demo"}
                  onClick={() => setMethod("momo-demo")}
                >
                  <span className="method-icon">
                    <CreditCard size={19} />
                  </span>
                  <span>
                    Ví điện tử<small>Nhận qua Momo / ZaloPay</small>
                  </span>
                  <span className={`radio-dot ${method === "momo-demo" ? "selected" : ""}`} />
                </button>
                <div className="finance-section">
                  <label htmlFor="destination" className="field-label">
                    {method === "momo-demo" ? "Số điện thoại ví" : "Số tài khoản nhận tiền"}
                  </label>
                  <input
                    id="destination"
                    className="field"
                    inputMode="numeric"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder={
                      method === "momo-demo" ? "Nhập số điện thoại" : "Nhập số tài khoản"
                    }
                    autoComplete="off"
                  />
                </div>
              </>
            ) : (
              <MethodPicker methods={paymentMethods} selected={method} onChange={setMethod} />
            )}
          </section>
          {withdraw ? (
            <div className="quote">
              <div>
                <span>Phí rút tiền</span>
                <strong>{formatMoney(quote.fee)}</strong>
              </div>
              <div>
                <span>Số tiền thực nhận</span>
                <strong>{formatMoney(quote.net_amount)}</strong>
              </div>
            </div>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="button primary wide finance-submit" type="submit" disabled>
            Đang hoàn thiện
          </button>
          <p className="demo-note">
            Nạp/rút tiền đang hoàn thiện. Chưa tiếp nhận yêu cầu giao dịch.
          </p>
        </form>
      </div>
    </>
  );
}
