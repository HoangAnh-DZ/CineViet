"use client";
import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronRight, Plus, Pencil, Trash2, Star, Search } from "lucide-react";
import { Modal } from "@/components/ui";
import { requestJson } from "@/services/client";
import { bankAccountInput, type SavedBankAccount, type BankOption } from "@/domain/bank-accounts";

export function BankCard({ account }: { account: SavedBankAccount }) {
  return (
    <div className="linked-bank-card">
      <span className="linked-bank-icon">
        <Building2 size={22} aria-hidden="true" />
      </span>
      <div className="linked-bank-copy">
        <strong>{account.nickname || account.bank_name}</strong>
        <span>
          {account.nickname ? account.bank_name + " · " : ""}
          {account.account_number_masked}
        </span>
        <span>{account.account_holder_name}</span>
      </div>
      {account.is_default ? (
        <span className="bank-default">
          <Star size={12} aria-hidden="true" />
          Mặc định
        </span>
      ) : null}
    </div>
  );
}
export function BankAccountManager({
  accounts,
  selectedId,
  onChange,
  onSelect,
  disabled = false,
}: {
  accounts: SavedBankAccount[];
  selectedId: string;
  onChange: (accounts: SavedBankAccount[], preferredId?: string) => void;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const selected = accounts.find((a) => a.id === selectedId);
  const [mode, setMode] = useState<"closed" | "list" | "form" | "delete">("closed");
  const [editing, setEditing] = useState<SavedBankAccount | null>(null);
  const [deleting, setDeleting] = useState<SavedBankAccount | null>(null);
  const [options, setOptions] = useState<BankOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  const [nickname, setNickname] = useState("");
  const [retry, setRetry] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    if (mode !== "form" || options.length) return;
    let active = true;
    setLoading(true);
    requestJson<BankOption[]>("/api/money/banks")
      .then((data) => {
        if (active) setOptions(data);
      })
      .catch(() => {
        if (active) setError("Chưa tải được danh sách ngân hàng. Vui lòng thử lại.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, options.length, retry]);
  function close() {
    if (!inFlight.current) {
      setMode("closed");
      setError("");
    }
  }
  function form(account: SavedBankAccount | null) {
    setEditing(account);
    setCode(account?.bank_code || "");
    setNumber("");
    setHolder(account?.account_holder_name || "");
    setNickname(account?.nickname || "");
    setSearch("");
    setError("");
    setMode("form");
  }
  async function mutate(
    action: () => Promise<unknown>,
    preferred?: (result: unknown) => string | undefined,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await action();
      const next = await requestJson<SavedBankAccount[]>("/api/account/banks");
      onChange(next, preferred?.(result));
      setMode("list");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được thay đổi. Hãy tải lại danh sách.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function refreshList() {
    await mutate(() => Promise.resolve());
  }
  const filtered = options.filter((o) =>
    (o.name + " " + o.label + " " + o.code)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .includes(
        search
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase(),
      ),
  );
  const option = options.find((o) => o.code === code);
  return (
    <>
      {selected ? (
        <div className="selected-linked-bank">
          <BankCard account={selected} />
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() => {
              setError("");
              setMode("list");
            }}
          >
            Thay đổi
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="linked-bank-empty">
          <span className="linked-bank-icon">
            <Building2 size={24} aria-hidden="true" />
          </span>
          <strong>Bạn chưa liên kết tài khoản ngân hàng</strong>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() => form(null)}
          >
            <Plus size={17} aria-hidden="true" />
            Thêm tài khoản ngân hàng
          </button>
        </div>
      )}
      {mode !== "closed" ? (
        <Modal
          title={
            mode === "form"
              ? editing
                ? "Sửa tài khoản ngân hàng"
                : "Thêm tài khoản ngân hàng"
              : mode === "delete"
                ? "Xóa tài khoản ngân hàng?"
                : "Ngân hàng nhận tiền"
          }
          onClose={close}
          className="redemption-modal bank-manager"
        >
          {mode === "list" ? (
            <>
              <div className="bank-list" aria-label="Tài khoản ngân hàng đã lưu">
                {accounts.length ? (
                  accounts.map((a) => (
                    <article
                      className={"bank-list-item" + (selectedId === a.id ? " selected" : "")}
                      key={a.id}
                    >
                      <button
                        type="button"
                        className="bank-select"
                        disabled={busy}
                        aria-pressed={selectedId === a.id}
                        onClick={() => {
                          onSelect(a.id);
                          close();
                        }}
                      >
                        <BankCard account={a} />
                        <span className="bank-select-mark">
                          {selectedId === a.id ? <Check size={18} aria-hidden="true" /> : null}
                        </span>
                      </button>
                      <div className="bank-management-actions">
                        {!a.is_default ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void mutate(() =>
                                requestJson("/api/account/banks/" + a.id, {
                                  method: "PATCH",
                                  body: JSON.stringify({ action: "default" }),
                                }),
                              )
                            }
                          >
                            <Star size={14} aria-hidden="true" />
                            Đặt mặc định
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => form(a)}
                          aria-label={"Sửa " + a.bank_name + " " + a.account_number_masked}
                        >
                          <Pencil size={14} aria-hidden="true" />
                          Sửa
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setDeleting(a);
                            setError("");
                            setMode("delete");
                          }}
                          aria-label={"Xóa " + a.bank_name + " " + a.account_number_masked}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          Xóa
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="redemption-hint">Bạn chưa liên kết tài khoản ngân hàng.</p>
                )}
              </div>
              <div className="bank-list-footer">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || accounts.length >= 10}
                  onClick={() => form(null)}
                >
                  <Plus size={17} aria-hidden="true" />
                  Thêm tài khoản ngân hàng
                </button>
                <button
                  type="button"
                  className="bank-inline-button"
                  disabled={busy}
                  onClick={() => void refreshList()}
                >
                  Tải lại danh sách
                </button>
              </div>
            </>
          ) : mode === "form" ? (
            <form
              className="linked-bank-form"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = bankAccountInput.safeParse({
                  bank_code: code,
                  account_number: number,
                  account_holder_name: holder,
                  nickname,
                });
                if (!parsed.success) {
                  setError(parsed.error.issues[0].message);
                  return;
                }
                void mutate(
                  () =>
                    requestJson<SavedBankAccount>(
                      "/api/account/banks" + (editing ? "/" + editing.id : ""),
                      {
                        method: editing ? "PATCH" : "POST",
                        body: JSON.stringify(
                          editing ? { action: "update", account: parsed.data } : parsed.data,
                        ),
                      },
                    ),
                  (r) => (r as SavedBankAccount).id,
                );
              }}
            >
              <fieldset disabled={busy}>
                <label className="field-label" htmlFor="linked-bank-search">
                  Ngân hàng
                </label>
                <div className="bank-search">
                  <Search size={18} aria-hidden="true" />
                  <input
                    id="linked-bank-search"
                    className="field"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm tên hoặc mã ngân hàng"
                    autoComplete="off"
                  />
                </div>
                {loading ? (
                  <p role="status" className="redemption-hint">
                    Đang tải ngân hàng…
                  </p>
                ) : options.length ? (
                  <div className="bank-options" role="group" aria-label="Chọn ngân hàng">
                    {filtered.map((o) => (
                      <button
                        type="button"
                        key={o.code}
                        aria-pressed={code === o.code}
                        onClick={() => {
                          setCode(o.code);
                          setSearch("");
                        }}
                      >
                        <span>
                          <strong>{o.name}</strong>
                          <small>{o.label}</small>
                        </span>
                        {code === o.code ? <Check size={17} aria-hidden="true" /> : null}
                      </button>
                    ))}
                    {!filtered.length ? (
                      <p className="redemption-hint">Không tìm thấy ngân hàng.</p>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setError("");
                      setRetry((v) => v + 1);
                    }}
                  >
                    Tải lại ngân hàng
                  </button>
                )}
                {option ? (
                  <p className="bank-selection-hint">
                    Đã chọn: <strong>{option.name}</strong>
                  </p>
                ) : null}
                <label className="field-label" htmlFor="linked-bank-number">
                  Số tài khoản
                </label>
                <input
                  id="linked-bank-number"
                  className="field"
                  inputMode="numeric"
                  autoComplete="off"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  required
                  maxLength={60}
                  placeholder={editing ? "Nhập lại số tài khoản để xác nhận" : "Nhập số tài khoản"}
                />
                <label className="field-label" htmlFor="linked-bank-holder">
                  Tên chủ tài khoản
                </label>
                <input
                  id="linked-bank-holder"
                  className="field"
                  autoComplete="off"
                  value={holder}
                  onChange={(e) => setHolder(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="Tên chủ tài khoản ngân hàng"
                />
                <label className="field-label" htmlFor="linked-bank-nickname">
                  Tên gợi nhớ <span>(không bắt buộc)</span>
                </label>
                <input
                  id="linked-bank-nickname"
                  className="field"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={60}
                  placeholder="Ví dụ: Tài khoản nhận thưởng"
                />
                <p className="redemption-hint">
                  Thông tin do bạn cung cấp, chưa xác minh chủ tài khoản.
                  {editing ? " Thay đổi chỉ dùng cho các yêu cầu mới." : ""}
                </p>
                <div className="bank-form-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setMode("list");
                      setError("");
                    }}
                  >
                    Quay lại
                  </button>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={!code || loading || !number.trim() || !holder.trim()}
                    aria-busy={busy}
                  >
                    {busy ? "Đang lưu…" : editing ? "Xác nhận thay đổi" : "Lưu tài khoản"}
                  </button>
                </div>
              </fieldset>
            </form>
          ) : deleting ? (
            <>
              <BankCard account={deleting} />
              <p className="redemption-hint">
                Tài khoản này sẽ không còn dùng cho yêu cầu mới. Thông tin của các yêu cầu đã gửi
                được giữ nguyên.
                {deleting.is_default && accounts.length > 1
                  ? " Tài khoản được lưu sớm nhất còn lại sẽ làm mặc định."
                  : ""}
              </p>
              <div className="bank-form-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setMode("list")}
                >
                  Giữ lại
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() =>
                    void mutate(() =>
                      requestJson("/api/account/banks/" + deleting.id, { method: "DELETE" }),
                    )
                  }
                >
                  {busy ? "Đang xóa…" : "Xác nhận xóa"}
                </button>
              </div>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="redemption-error">
              {error}
            </p>
          ) : null}
          {busy ? (
            <span className="sr-only" role="status">
              Đang lưu thay đổi ngân hàng
            </span>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
