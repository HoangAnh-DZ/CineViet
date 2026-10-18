"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Upload, CheckCircle2, Clock3 } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/format";
import { useApp } from "@/components/providers";
import { requestJson } from "@/services/client";
import {
  validBillFile,
  moneyStatus,
  moneyReturnTo,
  queueStatus,
  type MoneyRequest,
} from "@/domain/money";
import { paymentStatus } from "@/domain/payos";
import {
  validWithdrawalSelection,
  withdrawalFee,
  WITHDRAWAL_PRESETS,
} from "@/domain/product-policy";
import type { MoneyConfig } from "@/server/money-config";
import { PayosCheckout } from "./payos-checkout";
import "./manual-money.css";
export function PaymentScreen({
  withdraw = false,
  config,
  available,
  initialRequests,
  reserved = 0,
}: {
  withdraw?: boolean;
  config: MoneyConfig;
  available: number;
  initialRequests: MoneyRequest[];
  reserved?: number;
}) {
  const [amount, setAmount] = useState(withdraw ? "" : "200000"),
    [bank, setBank] = useState(""),
    [account, setAccount] = useState(""),
    [name, setName] = useState(""),
    [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [uploaded, setUploaded] = useState<{ id: string; url: string } | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(false),
    [requests, setRequests] = useState(initialRequests),
    [cash, setCash] = useState(available);
  const [held, setHeld] = useState(reserved);
  const [customAmount, setCustomAmount] = useState(false);
  const [bankOptions, setBankOptions] = useState<{ code: string; name: string; label: string }[]>(
      [],
    ),
    [bankCode, setBankCode] = useState("");
  useEffect(() => {
    if (!withdraw) return;
    let live = true;
    requestJson<typeof bankOptions>("/api/money/banks").then(
      (v) => {
        if (live) setBankOptions(v);
      },
      (e) => {
        if (live) setError(e.message);
      },
    );
    return () => {
      live = false;
    };
  }, [withdraw]);
  const { toast, refreshAccount } = useApp(),
    inFlight = useRef(false),
    attempt = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast("Đã sao chép");
    } catch {
      toast("Không sao chép được. Vui lòng chọn và sao chép thông tin.");
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const value = Number(amount);
      if (
        !/^\d+$/.test(amount) ||
        !Number.isSafeInteger(value) ||
        (withdraw
          ? !validWithdrawalSelection(value) || value < config.min_withdrawal || value > cash
          : value < 50000) ||
        value > config.max_amount
      )
        throw new Error(
          withdraw
            ? "Chọn mốc rút hoặc nhập số tiền trên 110.000đ, trong số dư và hạn mức hiện có."
            : "Số tiền ngoài hạn mức nạp.",
        );
      let bill = uploaded;
      if (!withdraw && !bill) {
        if (!file) throw new Error("Vui lòng chọn ảnh bill chuyển khoản.");
        const body = new FormData();
        body.append("bill", file);
        const response = await fetch("/api/money/bills", { method: "POST", body });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Không tải được bill.");
        bill = result;
        setUploaded(bill);
      }
      const payload = withdraw
        ? {
            amount: value,
            bank_name: bank,
            account_number: account,
            account_name: name,
            note,
            ...(bankCode ? { bank_code: bankCode } : {}),
          }
        : { amount: value, bill_id: bill!.id, note };
      const serialized = JSON.stringify(payload);
      if (attempt.current?.payload !== serialized)
        attempt.current = { payload: serialized, key: crypto.randomUUID() };
      const result = await requestJson<MoneyRequest>(
        withdraw ? "/api/money/withdrawals" : "/api/money/deposits",
        {
          method: "POST",
          body: JSON.stringify({ ...payload, idempotency_key: attempt.current!.key }),
        },
      );
      setRequests((v) => [result, ...v.filter((r) => r.id !== result.id)]);
      if (withdraw) {
        setCash((v) => v - result.amount);
        setHeld((v) => v + result.amount);
      }
      setSuccess(true);
      await refreshAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được yêu cầu.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  const value = Number(amount) || 0,
    fee =
      withdraw && Number.isSafeInteger(value) && value >= 0 && value <= 100000000
        ? withdrawalFee(value, config.withdrawal_fee_bps)
        : 0;
  const withdrawalValid =
    validWithdrawalSelection(value) &&
    value >= config.min_withdrawal &&
    value <= config.max_amount &&
    value <= cash;
  return (
    <>
      <PageHeader
        title={withdraw ? "Rút tiền" : "Nạp tiền"}
        back={moneyReturnTo}
        action={
          <Link href={moneyReturnTo} className="money-close" aria-label="Đóng">
            Đóng
          </Link>
        }
      />
      <div className="content manual-money-content">
        <div className="cash-balance">
          <span>{withdraw ? "Số dư có thể rút" : "VND khả dụng"}</span>
          <strong>{formatMoney(cash)}</strong>
          <p>Ví tiền mặt · Tách biệt với xu thưởng</p>
          {withdraw ? <p>Đang chờ rút: {formatMoney(held)}</p> : null}
        </div>
        {success ? (
          <section className="money-success" role="status">
            <CheckCircle2 size={30} />
            <h2>Đã gửi yêu cầu {withdraw ? "rút" : "nạp"} tiền</h2>
            <p>
              {withdraw
                ? "Tiền đã được giữ và lệnh đã vào hàng đợi. Chưa hoàn tất chuyển tiền."
                : "Bill đang chờ kiểm tra. Số dư chỉ tăng sau khi quản trị viên duyệt."}
            </p>
            <Link href={moneyReturnTo} className="button primary">
              Về Phần thưởng
            </Link>
            <a href="#money-request-history" className="money-text-link">
              Xem trạng thái yêu cầu
            </a>
          </section>
        ) : !withdraw ? (
          <section className="manual-money-form">
            <label className="field-label" htmlFor="payos-amount">
              Số tiền nạp · VND
            </label>
            <div className="money-presets">
              {[100000, 200000, 500000, 1000000].map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={amount === String(v)}
                  onClick={() => setAmount(String(v))}
                >
                  {formatMoney(v)}
                </button>
              ))}
            </div>
            <input
              id="payos-amount"
              className="field"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            />
            <p className="helper">
              Từ {formatMoney(Math.max(config.min_deposit, 50000))} đến{" "}
              {formatMoney(Math.min(config.max_amount, 100000000))}
            </p>
            <PayosCheckout
              kind="DEPOSIT"
              amount={Number(amount)}
              disabled={
                !config.deposit_enabled ||
                !Number.isSafeInteger(Number(amount)) ||
                Number(amount) < Math.max(config.min_deposit, 50000) ||
                Number(amount) > Math.min(config.max_amount, 100000000)
              }
            />
          </section>
        ) : (
          <form
            onSubmit={submit}
            className={`manual-money-form ${withdraw ? "withdrawal-form product-panel" : ""}`}
          >
            <label className="field-label" htmlFor="money-amount">
              Số tiền {withdraw ? "rút" : "nạp"} · VND
            </label>
            {withdraw ? (
              <>
                <div className="withdrawal-presets">
                  {WITHDRAWAL_PRESETS.map((v) => (
                    <div key={v}>
                      <button
                        type="button"
                        disabled={
                          pending || v > cash || v < config.min_withdrawal || v > config.max_amount
                        }
                        aria-pressed={!customAmount && amount === String(v)}
                        onClick={() => {
                          setCustomAmount(false);
                          setAmount(String(v));
                        }}
                      >
                        {formatMoney(v)}
                      </button>
                      {v > cash ? (
                        <small>Chưa đủ số dư</small>
                      ) : v < config.min_withdrawal || v > config.max_amount ? (
                        <small>Ngoài hạn mức</small>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="withdrawal-custom"
                  disabled={pending}
                  aria-pressed={customAmount}
                  onClick={() => {
                    setCustomAmount(true);
                    setAmount("");
                  }}
                >
                  Nhập số tiền khác
                </button>
              </>
            ) : (
              <div className="money-presets">
                {[100000, 200000, 500000, 1000000].map((v) => (
                  <button
                    type="button"
                    key={v}
                    aria-pressed={amount === String(v)}
                    onClick={() => setAmount(String(v))}
                  >
                    {formatMoney(v)}
                  </button>
                ))}
              </div>
            )}
            {!withdraw || customAmount ? (
              <input
                id="money-amount"
                className="field"
                required
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                placeholder={withdraw ? "Lớn hơn 110.000đ" : "Tối thiểu 50.000đ"}
              />
            ) : null}
            <p className="helper">
              {withdraw
                ? `Tối đa ${formatMoney(Math.min(cash, config.max_amount))}.`
                : `Tối thiểu ${formatMoney(config.min_deposit)} · Tối đa ${formatMoney(config.max_amount)}`}
            </p>
            {withdraw ? (
              <>
                <label className="field-label" htmlFor="receiving-bank">
                  Ngân hàng nhận tiền
                </label>
                {bankOptions.length ? (
                  <select
                    id="receiving-bank"
                    className="field"
                    required
                    value={bankCode}
                    onChange={(e) => {
                      setBankCode(e.target.value);
                      setBank(bankOptions.find((b) => b.code === e.target.value)?.name || "");
                    }}
                  >
                    <option value="">Chọn ngân hàng</option>
                    {bankOptions.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name} — {b.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="receiving-bank"
                    className="field"
                    required
                    maxLength={100}
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    placeholder="Ví dụ: TPBank"
                  />
                )}
                <label className="field-label" htmlFor="receiving-account">
                  Số tài khoản
                </label>
                <input
                  id="receiving-account"
                  className="field"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6,30}"
                  maxLength={30}
                  value={account}
                  onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))}
                />
                <label className="field-label" htmlFor="receiving-name">
                  Tên chủ tài khoản
                </label>
                <input
                  id="receiving-name"
                  className="field"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <div className="quote">
                  <div>
                    <span>Số tiền rút</span>
                    <strong>{formatMoney(value)}</strong>
                  </div>
                  <div>
                    <span>Phí rút 4%</span>
                    <strong>{formatMoney(fee)}</strong>
                  </div>
                  <div>
                    <span>Số tiền thực nhận</span>
                    <strong>{formatMoney(Math.max(0, value - fee))}</strong>
                  </div>
                </div>
                <p className="money-warning">
                  Số tiền rút sẽ được giữ ngay khi gửi yêu cầu. Nếu bị từ chối, tiền giữ được trả
                  lại số dư khả dụng.
                </p>
              </>
            ) : (
              <>
                <section className="deposit-bank" aria-label="Tài khoản nhận tiền">
                  <h2>Chuyển khoản ngân hàng</h2>
                  <dl>
                    <div>
                      <dt>Ngân hàng</dt>
                      <dd>{config.bank_name}</dd>
                    </div>
                    <div>
                      <dt>Số tài khoản</dt>
                      <dd>
                        {config.account_number}
                        <button
                          type="button"
                          aria-label="Copy số tài khoản"
                          onClick={() => copy(config.account_number)}
                        >
                          <Copy size={18} />
                        </button>
                      </dd>
                    </div>
                    <div>
                      <dt>Chủ tài khoản</dt>
                      <dd>{config.account_name}</dd>
                    </div>
                    <div>
                      <dt>Số tiền chuyển</dt>
                      <dd>
                        {formatMoney(value)}
                        <button
                          type="button"
                          aria-label="Copy số tiền"
                          onClick={() => copy(amount)}
                        >
                          <Copy size={18} />
                        </button>
                      </dd>
                    </div>
                  </dl>
                </section>
                <label className="bill-upload" htmlFor="deposit-bill">
                  <Upload size={24} />
                  <strong>{file ? file.name : "Tải ảnh bill chuyển khoản"}</strong>
                  <span>JPG, PNG, WebP · Tối đa 3 MB</span>
                </label>
                <input
                  id="deposit-bill"
                  className="bill-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setError("");
                    if (!f) return;
                    if (!validBillFile(f.name, f.type, f.size)) {
                      setError("Bill phải là JPG, PNG hoặc WebP, tối đa 3 MB.");
                      e.target.value = "";
                      setFile(null);
                      setUploaded(null);
                      return;
                    }
                    setFile(f);
                    setUploaded(null);
                  }}
                />
                {preview ? (
                  <img className="bill-preview" src={preview} alt="Preview bill chuyển khoản" />
                ) : null}
                <p className="money-warning">
                  Vui lòng chuyển đúng số tiền trước khi gửi yêu cầu. Số dư chỉ được cộng sau khi
                  quản trị viên xác nhận.
                </p>
              </>
            )}
            <label className="field-label" htmlFor="money-note">
              Ghi chú (không bắt buộc)
            </label>
            <textarea
              id="money-note"
              className="field"
              maxLength={500}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}
            {!withdraw || config.withdrawal_enabled ? null : (
              <p className="form-error">Rút tiền đang bảo trì.</p>
            )}
            <button
              className="button primary wide"
              type="submit"
              disabled={pending || (withdraw && (!withdrawalValid || !config.withdrawal_enabled))}
            >
              {pending ? "Đang gửi…" : withdraw ? "Xác nhận rút tiền" : "Gửi yêu cầu nạp tiền"}
            </button>
          </form>
        )}
        <section id="money-request-history" className="money-history">
          <h2>Lịch sử yêu cầu {withdraw ? "rút" : "nạp"}</h2>
          {requests.filter(
            (r) => r.kind === (withdraw ? "WITHDRAWAL" : "DEPOSIT") && r.source_asset === "VND",
          ).length ? (
            requests
              .filter(
                (r) => r.kind === (withdraw ? "WITHDRAWAL" : "DEPOSIT") && r.source_asset === "VND",
              )
              .map((r) => (
                <article key={r.id} className="money-history-row">
                  <div>
                    <strong>{formatMoney(r.amount)}</strong>
                    <span className={"money-status " + r.status.toLowerCase()}>
                      {r.payos_status
                        ? paymentStatus(r.payos_status)
                        : r.queue_status
                          ? queueStatus(r.queue_status)
                          : moneyStatus(r.kind, r.status)}
                    </span>
                  </div>
                  <p>{formatDate(r.created_at)}</p>
                  {r.provider === "PAYOS" ? (
                    <>
                      <p>payOS · Mã đơn {r.order_code}</p>
                      <Link className="money-text-link" href={`/payments/payos/${r.id}`}>
                        Xem thanh toán / đối soát
                      </Link>
                    </>
                  ) : null}
                  {r.kind === "WITHDRAWAL" ? (
                    <p>
                      Phí {formatMoney(r.fee)} · Thực nhận {formatMoney(r.amount - r.fee)}
                      <br />
                      {r.bank_name} · {r.bank_account_number} · {r.bank_account_name}
                    </p>
                  ) : null}
                  {r.completed_at ? (
                    <p>
                      {withdraw ? "Đã chuyển" : "Đã duyệt"}: {formatDate(r.completed_at)}
                    </p>
                  ) : null}
                  {r.rejected_at ? <p>Từ chối: {formatDate(r.rejected_at)}</p> : null}
                  {r.review_note ? <p>Lý do: {r.review_note}</p> : null}
                </article>
              ))
          ) : (
            <div className="money-history-empty">
              <Clock3 size={20} />
              <p>Chưa có yêu cầu {withdraw ? "rút" : "nạp"} tiền.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
