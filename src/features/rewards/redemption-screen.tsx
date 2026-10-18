"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldCheck, RefreshCw, ArrowRight } from "lucide-react";
import { useApp } from "@/components/providers";
import Link from "next/link";
import { PageHeader, Coin, Modal } from "@/components/ui";
import { requestJson } from "@/services/client";
import { formatMoney } from "@/lib/format";
import {
  validWithdrawalSelection,
  withdrawalFee,
  WITHDRAWAL_PRESETS,
} from "@/domain/product-policy";
import { moneyStatus, type MoneyRequest } from "@/domain/money";
import { savedRedemptionInput, type SavedBankAccount } from "@/domain/bank-accounts";
import type { redemptionSnapshot } from "@/server/redemption";
import { RequestHistory } from "@/features/wallet/request-history";
import { BankAccountManager, BankCard } from "./bank-account-manager";
import "@/features/wallet/manual-money.css";
import "./redemption.css";

type Snapshot = Awaited<ReturnType<typeof redemptionSnapshot>>;
export function RedemptionScreen({
  snapshot: initial,
  initialRequests,
  initialAccounts,
}: {
  snapshot: Snapshot;
  initialRequests: MoneyRequest[];
  initialAccounts: SavedBankAccount[];
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [requests, setRequests] = useState(initialRequests);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [bankId, setBankId] = useState(
    initialAccounts.find((a) => a.is_default)?.id || initialAccounts[0]?.id || "",
  );
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [review, setReview] = useState<{
    coins: number;
    value: number;
    fee: number;
    bank: SavedBankAccount;
  } | null>(null);
  const [success, setSuccess] = useState<MoneyRequest | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const generation = useRef(0);
  const router = useRouter();
  const { refreshAccount } = useApp();
  const bank = accounts.find((a) => a.id === bankId);
  const availableVnd = snapshot.available * snapshot.coin_value_vnd;
  const value = customAmount
    ? /^\d+$/.test(amountInput.trim())
      ? Number(amountInput)
      : 0
    : selectedAmount || 0;
  const coins =
    Number.isSafeInteger(value) && value > 0 && value % snapshot.coin_value_vnd === 0
      ? value / snapshot.coin_value_vnd
      : 0;
  const fee =
    Number.isSafeInteger(value) && value > 0 && value <= snapshot.max_vnd
      ? withdrawalFee(value, snapshot.fee_bps)
      : 0;
  const validAmount =
    coins > 0 &&
    Number.isSafeInteger(coins) &&
    validWithdrawalSelection(value) &&
    (!customAmount || value > 110000) &&
    value >= snapshot.min_vnd &&
    value <= snapshot.max_vnd &&
    coins <= snapshot.available;
  const canSubmit = validAmount && !!bank && !busy;
  const updateAccounts = useCallback((next: SavedBankAccount[], preferredId?: string) => {
    setAccounts(next);
    setBankId((current) =>
      next.some((a) => a.id === (preferredId || current))
        ? preferredId || current
        : next.find((a) => a.is_default)?.id || next[0]?.id || "",
    );
  }, []);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    const d = await requestJson<{
      snapshot: Snapshot;
      requests: MoneyRequest[];
      accounts: SavedBankAccount[];
    }>("/api/rewards/redemptions");
    if (generation.current === current) {
      setSnapshot(d.snapshot);
      setRequests(d.requests);
      updateAccounts(d.accounts);
    }
  }, [updateAccounts]);
  useEffect(() => {
    async function revalidate() {
      if (inFlight.current || document.visibilityState !== "visible") return;
      try {
        await reload();
      } catch {
        /* Keep real values; submission always revalidates. */
      }
    }
    void revalidate();
    const timer = window.setInterval(revalidate, 30000);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      generation.current++;
      clearInterval(timer);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [reload]);
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được trạng thái.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function submit() {
    if (inFlight.current) return;
    if (
      !review ||
      review.coins > snapshot.available ||
      review.value < snapshot.min_vnd ||
      review.value > snapshot.max_vnd
    ) {
      setError("Chọn số tiền và tài khoản ngân hàng hợp lệ.");
      return;
    }
    inFlight.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      const payload = { coins: review.coins, bank_account_id: review.bank.id };
      const serialized = JSON.stringify(payload);
      if (attempt.current?.payload !== serialized)
        attempt.current = { payload: serialized, key: crypto.randomUUID() };
      const body = savedRedemptionInput.parse({
        ...payload,
        idempotency_key: attempt.current!.key,
      });
      const result = await requestJson<MoneyRequest>("/api/rewards/redemptions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setRequests((v) => [result, ...v.filter((r) => r.id !== result.id)]);
      setSuccess(result);
      setConfirm(false);
      router.refresh();
      void refreshAccount();
      try {
        await reload();
      } catch {
        setError("Yêu cầu đã gửi. Hãy cập nhật trạng thái để xem lại số dư.");
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Không gửi được yêu cầu. Hãy thử lại để kiểm tra cùng mã yêu cầu.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function summaryRows(quote = { coins, value, fee }) {
    return (
      <dl className="redemption-breakdown">
        <div>
          <dt>Số xu sử dụng</dt>
          <dd>{quote.coins.toLocaleString("vi-VN")} xu</dd>
        </div>
        <div>
          <dt>Giá trị quy đổi</dt>
          <dd>{formatMoney(quote.value)}</dd>
        </div>
        <div>
          <dt>Phí xử lý ({snapshot.fee_bps / 100}%)</dt>
          <dd>{formatMoney(quote.fee)}</dd>
        </div>
        <div className="redemption-net">
          <dt>Thực nhận</dt>
          <dd>{formatMoney(Math.max(0, quote.value - quote.fee))}</dd>
        </div>
      </dl>
    );
  }
  return (
    <>
      <div className="redemption-heading">
        <PageHeader title="Đổi thưởng" back="/rewards" />
      </div>
      <div className="content redemption-page">
        <section className="redemption-wallet" aria-label="Số dư đổi thưởng">
          <div className="redemption-wallet-main">
            <span>
              <Coin small />
              Xu khả dụng
            </span>
            <strong>
              {snapshot.available.toLocaleString("vi-VN")} <small>xu</small>
            </strong>
            <p>Tương đương {formatMoney(availableVnd)}</p>
          </div>
          <div className="redemption-wallet-pending">
            <span>Xu đang chờ đổi</span>
            <strong>{snapshot.reserved.toLocaleString("vi-VN")} xu</strong>
            <p>1 xu = 1 VNĐ</p>
          </div>
        </section>
        {success ? (
          <section className="redemption-panel redemption-success" role="status">
            <CheckCircle2 size={36} aria-hidden="true" />
            <h2>Đã gửi yêu cầu đổi thưởng</h2>
            <span className={"money-status " + success.status.toLowerCase()}>
              {moneyStatus(success.kind, success.status)}
            </span>
            <p>
              Thực nhận {formatMoney(success.amount - success.fee)} · {success.bank_name}{" "}
              {success.bank_account_number}
            </p>

            <div className="redemption-success-actions">
              <Link href="/rewards" className="button secondary">
                Về Phần thưởng
              </Link>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setSuccess(null);
                  setSelectedAmount(null);
                  setAmountInput("");
                  setCustomAmount(false);
                  setError("");
                  attempt.current = null;
                }}
              >
                Đổi thưởng tiếp
              </button>
            </div>
          </section>
        ) : (
          <div className="redemption-layout">
            <div className="redemption-steps">
              <section className="redemption-panel">
                <div className="redemption-section-title">
                  <span>1</span>
                  <h2>Chọn số tiền</h2>
                </div>
                <div className="redemption-amounts" role="group" aria-label="Mốc đổi thưởng">
                  {WITHDRAWAL_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      aria-pressed={!customAmount && selectedAmount === preset}
                      disabled={
                        busy ||
                        preset < snapshot.min_vnd ||
                        preset > snapshot.max_vnd ||
                        preset > availableVnd
                      }
                      onClick={() => {
                        setCustomAmount(false);
                        setSelectedAmount(preset);
                        setError("");
                      }}
                    >
                      {formatMoney(preset)}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={customAmount}
                    onClick={() => {
                      setCustomAmount(true);
                      setSelectedAmount(null);
                      setError("");
                    }}
                  >
                    Số tiền khác
                  </button>
                </div>
                {customAmount ? (
                  <div className="redemption-custom-field">
                    <label className="field-label" htmlFor="redemption-amount">
                      Số tiền muốn đổi (VNĐ)
                    </label>
                    <input
                      id="redemption-amount"
                      className="field"
                      inputMode="numeric"
                      autoComplete="off"
                      value={amountInput}
                      disabled={busy}
                      onChange={(e) => setAmountInput(e.target.value)}
                      placeholder="Lớn hơn 110.000"
                      aria-describedby="redemption-amount-hint"
                      aria-invalid={!!amountInput && !validAmount}
                    />
                    <p
                      id="redemption-amount-hint"
                      className={
                        amountInput && !validAmount ? "redemption-error" : "redemption-hint"
                      }
                    >
                      {amountInput && !validAmount
                        ? "Nhập số nguyên lớn hơn 110.000đ trong số xu khả dụng và hạn mức hiện hành."
                        : "Số tiền tùy chỉnh phải lớn hơn 110.000đ."}
                    </p>
                  </div>
                ) : null}
                {availableVnd < snapshot.min_vnd ? (
                  <p className="redemption-hint">
                    Cần tối thiểu {formatMoney(snapshot.min_vnd)} để đổi thưởng.
                  </p>
                ) : null}
              </section>
              <section className="redemption-panel">
                <div className="redemption-section-title">
                  <span>2</span>
                  <h2>Ngân hàng nhận tiền</h2>
                </div>
                <BankAccountManager
                  accounts={accounts}
                  selectedId={bankId}
                  onChange={updateAccounts}
                  onSelect={setBankId}
                  disabled={busy}
                />
              </section>
            </div>
            <aside className="redemption-panel redemption-summary">
              <div className="redemption-section-title">
                <span>3</span>
                <h2>Chi tiết đổi thưởng</h2>
              </div>
              {summaryRows()}
              {bank ? (
                <div className="redemption-recipient">
                  <span>Chuyển đến</span>
                  <BankCard account={bank} />
                </div>
              ) : (
                <p className="redemption-hint">Chọn ngân hàng nhận tiền để tiếp tục.</p>
              )}
              <button
                type="button"
                className="button primary wide"
                disabled={!canSubmit}
                onClick={() => {
                  if (!bank) return;
                  setReview({ coins, value, fee, bank });
                  setError("");
                  setConfirm(true);
                }}
              >
                Xác nhận đổi thưởng
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              <p className="redemption-security">
                <ShieldCheck size={16} aria-hidden="true" />
                Xu được tạm giữ khi gửi yêu cầu.
              </p>
            </aside>
          </div>
        )}
        {error && !confirm ? (
          <p className="redemption-error" role="alert">
            {error}
          </p>
        ) : null}
        <section className="redemption-panel redemption-history">
          <div className="redemption-history-toolbar">
            <h2>Lịch sử đổi thưởng</h2>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              aria-busy={busy}
              onClick={refresh}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {busy ? "Đang cập nhật…" : "Cập nhật"}
            </button>
          </div>
          <RequestHistory requests={requests} title="Các yêu cầu đã gửi" />
        </section>
      </div>
      {confirm && review ? (
        <Modal
          title="Xác nhận yêu cầu đổi thưởng"
          className="redemption-modal"
          onClose={() => {
            if (!inFlight.current) setConfirm(false);
          }}
        >
          {summaryRows(review)}
          <div className="redemption-recipient">
            <span>Ngân hàng nhận tiền</span>
            <BankCard account={review.bank} />
          </div>
          <p className="redemption-hint">Kiểm tra thông tin nhận tiền trước khi gửi yêu cầu.</p>
          {error ? (
            <p className="redemption-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="bank-form-actions">
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Quay lại
            </button>
            <button
              className="button primary"
              type="button"
              disabled={
                busy ||
                review.coins > snapshot.available ||
                review.value < snapshot.min_vnd ||
                review.value > snapshot.max_vnd
              }
              aria-busy={busy}
              onClick={() => void submit()}
            >
              {busy ? "Đang gửi…" : "Gửi yêu cầu"}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
