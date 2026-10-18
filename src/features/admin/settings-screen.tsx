"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, CreditCard, Landmark, Save, Settings2 } from "lucide-react";
import { DashboardHeading } from "./dashboard-screen";
import { requestJson } from "@/services/client";
import type { MoneyConfig } from "@/server/money-config";
import { formatMoney } from "@/lib/format";

type AmountSetting = "min_deposit" | "min_withdrawal" | "max_amount" | "withdrawal_fee";
type StatusSetting = "deposit_enabled" | "withdrawal_enabled";

export function SettingsScreen({ initial }: { initial: MoneyConfig }) {
  const [settings, setSettings] = useState(initial);
  const [savedSettings, setSavedSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const hasChanges = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  function update(key: AmountSetting | StatusSetting, value: string | number | boolean) {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage("");
    setError("");
  }

  function reset() {
    setSettings(savedSettings);
    setMessage("");
    setError("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const {
        deposit_enabled,
        withdrawal_enabled,
        min_deposit,
        min_withdrawal,
        max_amount,
        withdrawal_fee_bps,
      } = settings;
      const editable = {
        deposit_enabled,
        withdrawal_enabled,
        min_deposit,
        min_withdrawal,
        max_amount,
        withdrawal_fee_bps,
      };
      const updated = await requestJson<MoneyConfig>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(editable),
      });
      setSettings(updated);
      setSavedSettings(updated);
      setMessage("Đã lưu cấu hình.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được cấu hình.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DashboardHeading
        title="Cấu hình hệ thống"
        description="Thông tin thanh toán, hạn mức và trạng thái nạp rút."
      />
      <form className="admin-settings-form" onSubmit={save} aria-busy={saving}>
        <fieldset
          className="admin-form-fieldset"
          disabled={saving}
          aria-label="Cấu hình thanh toán"
        >
          <section
            className="dashboard-panel admin-settings-panel"
            aria-labelledby="withdrawal-settings-title"
          >
            <div className="dashboard-panel-heading">
              <div className="admin-form-section-heading">
                <span className="admin-form-section-icon">
                  <CreditCard size={21} aria-hidden="true" />
                </span>
                <div>
                  <h2 id="withdrawal-settings-title">Hạn mức và phí</h2>
                  <p>Áp dụng cho lệnh nạp, rút mới.</p>
                </div>
              </div>
            </div>
            <div className="admin-settings-fields admin-form-grid">
              <label className="admin-form-field">
                <span>Nạp tối thiểu (đ)</span>
                <input
                  className="field"
                  type="number"
                  required
                  min={1}
                  max={1000000000}
                  value={settings.min_deposit}
                  onChange={(e) => update("min_deposit", Number(e.target.value))}
                />
              </label>
              <label className="admin-form-field" htmlFor="settings-min-withdrawal">
                <span>Rút tối thiểu (đ)</span>
                <input
                  id="settings-min-withdrawal"
                  className="field"
                  type="number"
                  required
                  min={1}
                  max={1000000000}
                  step={1}
                  value={settings.min_withdrawal}
                  onChange={(event) => update("min_withdrawal", Number(event.target.value))}
                />
              </label>
              <label className="admin-form-field" htmlFor="settings-max-amount">
                <span>Hạn mức mỗi lệnh (đ)</span>
                <input
                  id="settings-max-amount"
                  className="field"
                  type="number"
                  required
                  min={Math.max(1, settings.min_withdrawal)}
                  max={10000000000}
                  step={1}
                  value={settings.max_amount}
                  onChange={(event) => update("max_amount", Number(event.target.value))}
                />
              </label>
              <div className="admin-settings-preview">
                <span>Phí lệnh rút mới</span>
                <strong>4%</strong>
                <small>Làm tròn lên 1đ; phí được trừ trong số tiền yêu cầu rút.</small>
              </div>
              <div className="admin-settings-preview">
                <span>Ví dụ rút 35.000đ</span>
                <strong>Thực nhận 33.600đ</strong>
                <small>Lệnh đã tạo giữ nguyên phí được ghi nhận.</small>
              </div>
            </div>
          </section>

          <section
            className="dashboard-panel admin-settings-panel"
            aria-labelledby="operation-settings-title"
          >
            <div className="dashboard-panel-heading">
              <div className="admin-form-section-heading">
                <span className="admin-form-section-icon">
                  <Settings2 size={21} aria-hidden="true" />
                </span>
                <div>
                  <h2 id="operation-settings-title">Trạng thái vận hành</h2>
                  <p>Bật hoặc tạm dừng tiếp nhận lệnh mới.</p>
                </div>
              </div>
            </div>
            <div className="admin-maintenance-grid">
              <label className="admin-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Cho phép nạp tiền"
                  checked={settings.deposit_enabled}
                  onChange={(event) => update("deposit_enabled", event.target.checked)}
                />
                <span>
                  <b>Cho phép nạp tiền</b>
                  <small>
                    {settings.deposit_enabled ? "Đang tiếp nhận lệnh nạp" : "Tạm dừng lệnh nạp mới"}
                  </small>
                </span>
                <span
                  className={`admin-state-badge ${settings.deposit_enabled ? "is-enabled" : "is-paused"}`}
                  aria-hidden="true"
                >
                  {settings.deposit_enabled ? "Đang mở" : "Bảo trì"}
                </span>
              </label>
              <label className="admin-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Cho phép rút tiền"
                  checked={settings.withdrawal_enabled}
                  onChange={(event) => update("withdrawal_enabled", event.target.checked)}
                />
                <span>
                  <b>Cho phép rút tiền</b>
                  <small>
                    {settings.withdrawal_enabled
                      ? "Đang tiếp nhận lệnh rút"
                      : "Tạm dừng lệnh rút mới"}
                  </small>
                </span>
                <span
                  className={`admin-state-badge ${settings.withdrawal_enabled ? "is-enabled" : "is-paused"}`}
                  aria-hidden="true"
                >
                  {settings.withdrawal_enabled ? "Đang mở" : "Bảo trì"}
                </span>
              </label>
            </div>
          </section>
        </fieldset>

        {error ? (
          <div className="admin-feedback is-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
        {message ? (
          <div className="admin-feedback is-success" role="status">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>{message}</span>
          </div>
        ) : null}
        <footer className="admin-form-footer">
          <span className="admin-form-save-state">
            {hasChanges ? "Có thay đổi chưa lưu" : "Cấu hình đã được lưu"}
          </span>
          <div className="admin-form-actions">
            <button
              className="button secondary"
              type="button"
              onClick={reset}
              disabled={saving || !hasChanges}
            >
              Hủy thay đổi
            </button>
            <button
              className="button primary admin-save-settings"
              type="submit"
              disabled={saving || !hasChanges}
            >
              <Save size={17} aria-hidden="true" />
              {saving ? "Đang lưu…" : "Lưu cấu hình"}
            </button>
          </div>
        </footer>
      </form>
    </>
  );
}
